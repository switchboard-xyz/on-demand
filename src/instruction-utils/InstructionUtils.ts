import * as anchor from "@coral-xyz/anchor-30";
import type {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";

/*
 * Utilities namespace for instruction related functions
 * */
export class InstructionUtils {
  /*
   * Function to convert transaction instructions to a versioned transaction
   * @param connection: The connection to use
   * @param ixs: The transaction instructions
   * @param payer: The payer for the transaction
   * @param computeUnitCapMultiple: The compute units to cap the tx as a multiple of the simulated units consumed (e.g. 1.25x)
   * @param computeUnitPrice: The price per compute unit in microlamports
   * @param lookupTables: The address lookup tables
   * @param signers: The signers for the transaction
   * @returns The versioned transaction
   * */
  static async asV0TxWithComputeIxs(params: {
    connection: Connection;
    ixs: TransactionInstruction[];
    payer?: PublicKey;
    computeUnitLimitMultiple?: number;
    computeUnitPrice?: number;
    lookupTables?: AddressLookupTableAccount[];
    signers?: Signer[];
  }): Promise<VersionedTransaction> {
    let payer = params.payer;
    if (payer === undefined && (params.signers ?? []).length === 0) {
      throw new Error("Payer not provided");
    }
    if (payer === undefined) {
      payer = params.signers![0].publicKey;
    }
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: params.computeUnitPrice ?? 0,
    });
    const simulationComputeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000, // 1.4M compute units
    });
    const recentBlockhash = (await params.connection.getLatestBlockhash())
      .blockhash;

    const simulateMessageV0 = new TransactionMessage({
      recentBlockhash,
      instructions: [priorityFeeIx, simulationComputeLimitIx, ...params.ixs],
      payerKey: payer,
    }).compileToV0Message(params.lookupTables ?? []);
    const simulateTx = new VersionedTransaction(simulateMessageV0);
    try {
      simulateTx.serialize();
    } catch (e: any) {
      if (e instanceof RangeError) {
        throw new Error(
          "Transaction failed to serialize: Transaction too large"
        );
      }
      throw e;
    }
    const simulationResult = await params.connection.simulateTransaction(
      simulateTx,
      {
        commitment: "processed",
        sigVerify: false,
      }
    );
    const simulationUnitsConsumed = simulationResult.value.unitsConsumed!;
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: Math.floor(
        simulationUnitsConsumed * (params.computeUnitLimitMultiple ?? 1)
      ),
    });
    const messageV0 = new TransactionMessage({
      recentBlockhash,
      instructions: [priorityFeeIx, computeLimitIx, ...params.ixs],
      payerKey: payer,
    }).compileToV0Message(params.lookupTables ?? []);
    const tx = new VersionedTransaction(messageV0);
    tx.sign(params.signers ?? []);
    return tx;
  }
}
