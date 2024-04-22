import type * as anchor from "@coral-xyz/anchor";
import type {
  AddressLookupTableAccount,
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
   * @param program: The anchor program
   * @param ixs: The transaction instructions
   * @param lookupTables: The address lookup tables
   * @returns The versioned transaction
   * */
  static async asV0Tx(
    program: anchor.Program,
    ixs: Array<TransactionInstruction>,
    lookupTables: Array<AddressLookupTableAccount> = []
  ): Promise<VersionedTransaction> {
    const messageV0 = new TransactionMessage({
      recentBlockhash: (await program.provider.connection.getLatestBlockhash())
        .blockhash,
      instructions: ixs,
      payerKey: program.provider.publicKey!,
    }).compileToV0Message(lookupTables);
    return new VersionedTransaction(messageV0);
  }

  /*
   * Function to convert transaction instructions to a versioned transaction
   * @param program: The anchor program
   * @param ixs: The transaction instructions
   * @param computeUnitCapMultiple: The compute units to cap the tx as a multiple of the simulated units consumed (e.g. 1.25x)
   * @param computeUnitPrice: The price per compute unit in microlamports
   * @param lookupTables: The address lookup tables
   * @returns The versioned transaction
   * */
  static async asV0TxWithComputeIxs(
    program: anchor.Program,
    ixs: Array<TransactionInstruction>,
    computeUnitLimitMultiple: number,
    computeUnitPrice: number,
    lookupTables: Array<AddressLookupTableAccount> = []
  ): Promise<VersionedTransaction> {
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: computeUnitPrice,
    });
    const simulationComputeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000, // 1.4M compute units
    });
    const recentBlockhash = (
      await program.provider.connection.getLatestBlockhash()
    ).blockhash;
    const simulateMessageV0 = new TransactionMessage({
      recentBlockhash,
      instructions: [priorityFeeIx, simulationComputeLimitIx, ...ixs],
      payerKey: program.provider.publicKey!,
    }).compileToV0Message(lookupTables);
    const simulationResult =
      await program.provider.connection.simulateTransaction(
        new VersionedTransaction(simulateMessageV0),
        {
          commitment: "processed",
          sigVerify: false,
        }
      );
    const simulationUnitsConsumed = simulationResult.value.unitsConsumed!;
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: Math.floor(simulationUnitsConsumed * computeUnitLimitMultiple),
    });
    const messageV0 = new TransactionMessage({
      recentBlockhash,
      instructions: [priorityFeeIx, computeLimitIx, ...ixs],
      payerKey: program.provider.publicKey!,
    }).compileToV0Message(lookupTables);
    return new VersionedTransaction(messageV0);
  }
}
