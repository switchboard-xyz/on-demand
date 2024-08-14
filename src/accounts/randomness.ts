import { SLOT_HASHES_SYSVAR_ID } from "../constants.js";
import type { RandomnessRevealResponse } from "../oracle-interfaces/gateway.js";
import { Gateway } from "../oracle-interfaces/gateway.js";

import { InstructionUtils } from "./../instruction-utils/InstructionUtils.js";
import { RecentSlotHashes } from "./../sysvars/recentSlothashes.js";
import * as spl from "./../utils/index.js";
import { Oracle } from "./oracle.js";
import { Queue } from "./queue.js";
import { State } from "./state.js";

import {
  BN,
  BorshAccountsCoder,
  type Program,
  utils,
} from "@coral-xyz/anchor-30";
import * as anchor from "@coral-xyz/anchor-30";
import type { TransactionInstruction } from "@solana/web3.js";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { sendTxWithJito } from "@solworks/soltoolkit-sdk/build/modules/TransactionWrapper.js";
import * as bs58 from "bs58";
import * as fs from "fs";

/**
 * Switchboard commit-reveal randomness.
 * This account type controls commit-reveal style randomness employing
 * Intel SGX enclaves as a randomness security mechanism.
 * For this flow, a user must commit to a future slot that would be unknown
 * to all parties at the time of commitment. The user must then reveal the
 * randomness by then sending the future slot hash to the oracle which can
 * then be signed by the secret key secured within the Trusted Execution Environment.
 *
 * In this manner, the only way for one to predict the randomness is to:
 * 1. Have access to the randomness oracle
 * 2. have control of the solana network slot leader at the time of commit
 * 3. Have an unpatched Intel SGX vulnerability/advisory that the Switchboard
 *   protocol failed to auto-prune.
 */
export class Randomness {
  /**
   * Constructs a `Randomness` instance.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {PublicKey} pubkey - The public key of the randomness account.
   */
  constructor(readonly program: Program, readonly pubkey: PublicKey) {}

  /**
   * Loads the randomness data for this {@linkcode Randomness} account from on chain.
   *
   * @returns {Promise<any>} A promise that resolves to the randomness data.
   * @throws Will throw an error if the randomness account does not exist.
   */
  async loadData(): Promise<any> {
    return await this.program.account["randomnessAccountData"].fetch(
      this.pubkey
    );
  }

  /**
   * Creates a new `Randomness` account.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {Keypair} kp - The keypair of the new `Randomness` account.
   * @param {PublicKey} queue - The queue account to associate with the new `Randomness` account.
   * @param {PublicKey} [payer_] - The payer for the transaction. If not provided, the default payer from the program provider is used.
   * @returns {Promise<[Randomness, TransactionInstruction]>} A promise that resolves to a tuple containing the new `Randomness` account and the transaction instruction.
   */
  static async create(
    program: Program,
    kp: Keypair,
    queue: PublicKey,
    payer_?: PublicKey
  ): Promise<[Randomness, TransactionInstruction]> {
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), kp.publicKey.toBuffer()],
        program.programId
      )
    )[0];
    const recentSlot = await program.provider.connection.getSlot("finalized");
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: PublicKey.default,
      recentSlot,
    });
    const ix = program.instruction.randomnessInit(
      {
        recentSlot: new anchor.BN(recentSlot.toString()),
      },
      {
        accounts: {
          randomness: kp.publicKey,
          queue,
          authority: program.provider.publicKey!,
          payer: program.provider.publicKey!,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            spl.NATIVE_MINT,
            kp.publicKey
          ),
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          wrappedSolMint: spl.NATIVE_MINT,
          programState: State.keyFromSeed(program),
          lutSigner,
          lut,
          addressLookupTableProgram: AddressLookupTableProgram.programId,
        },
      }
    );
    return [new Randomness(program, kp.publicKey), ix];
  }

  /**
   * Generate a randomness `commit` solana transaction instruction.
   * This will commit the randomness account to use currentSlot + 1 slothash
   * as the non-repeating randomness seed.
   *
   * @param {PublicKey} queue - The queue public key for the commit instruction.
   * @param {PublicKey} [authority_] - The optional authority public key.
   * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
   */
  async commitIx(
    queue: PublicKey,
    authority_?: PublicKey
  ): Promise<TransactionInstruction> {
    const queueAccount = new Queue(this.program, queue);
    const oracle = await queueAccount.fetchFreshOracle();
    const authority = authority_ ?? (await this.loadData()).authority;
    const ix = await this.program.instruction.randomnessCommit(
      {},
      {
        accounts: {
          randomness: this.pubkey,
          queue: queue,
          oracle: oracle,
          recentSlothashes: SLOT_HASHES_SYSVAR_ID,
          authority,
        },
      }
    );
    return ix;
  }

  /**
   * Generate a randomness `reveal` solana transaction instruction.
   * This will reveal the randomness using the assigned oracle.
   *
   * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
   */
  async revealIx(): Promise<TransactionInstruction> {
    const data = await this.loadData();
    const oracleKey = data.oracle;
    const oracle = new Oracle(this.program, oracleKey);
    const oracleData = await oracle.loadData();
    const gatewayUrl = String.fromCharCode(...oracleData.gatewayUri).replace(
      /\0+$/,
      ""
    );

    const gateway = new Gateway(this.program, gatewayUrl);
    const gatewayRevealResponse = await gateway.fetchRandomnessReveal({
      randomnessAccount: this.pubkey,
      slothash: bs58.encode(data.seedSlothash),
      slot: data.seedSlot.toNumber(),
    });
    const stats = PublicKey.findProgramAddressSync(
      [Buffer.from("OracleRandomnessStats"), oracleKey.toBuffer()],
      this.program.programId
    )[0];
    const ix = await this.program.instruction.randomnessReveal(
      {
        signature: Buffer.from(gatewayRevealResponse.signature, "base64"),
        recoveryId: gatewayRevealResponse.recovery_id,
        value: gatewayRevealResponse.value,
      },
      {
        accounts: {
          randomness: this.pubkey,
          oracle: oracleKey,
          queue: data.queue,
          stats,
          authority: data.authority,
          payer: this.program.provider.publicKey!,
          recentSlothashes: SLOT_HASHES_SYSVAR_ID,
          systemProgram: SystemProgram.programId,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            spl.NATIVE_MINT,
            this.pubkey
          ),
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          wrappedSolMint: spl.NATIVE_MINT,
          programState: State.keyFromSeed(this.program),
        },
      }
    );
    return ix;
  }

  /**
   * Commit and reveal randomness in a single transaction.
   *
   * @param {TransactionInstruction[]} callback - The callback to execute after the reveal in the same transaction.
   * @param {Keypair[]} signers - The signers to sign the transaction.
   * @param {PublicKey} queue - The queue public key.
   * @param {object} [configs] - The configuration options.
   * @param {number} [configs.computeUnitPrice] - The price per compute unit in microlamports.
   * @param {number} [configs.computeUnitLimit] - The compute unit limit.
   * @returns {Promise<void>} A promise that resolves when the transaction is confirmed.
   */
  async commitAndReveal(
    callback: TransactionInstruction[],
    signers: Keypair[],
    queue: PublicKey,
    configs?: {
      computeUnitPrice?: number;
      computeUnitLimit?: number;
    }
  ): Promise<void> {
    const queueAccount = new Queue(this.program, queue);
    const oracle = await queueAccount.fetchFreshOracle();
    const computeUnitPrice = configs?.computeUnitPrice ?? 1;
    const computeUnitLimit = configs?.computeUnitLimit ?? 200_000;
    const connection = this.program.provider.connection;
    const payer = (this.program.provider as any).wallet.payer;
    for (;;) {
      const data = await this.loadData();
      if (data.seedSlot.toNumber() !== 0) {
        console.log("Randomness slot already committed. Jumping to reveal.");
        break;
      }
      const tx = await InstructionUtils.asV0TxWithComputeIxs({
        connection: this.program.provider.connection,
        ixs: [
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: computeUnitPrice,
          }),
          await this.commitIx(oracle, data.authority),
        ],
      });
      tx.sign([payer]);
      const sim = await connection.simulateTransaction(tx, {
        commitment: "processed",
      });
      if (sim.value.err !== null) {
        console.log(sim.value.logs);
        throw new Error(
          `Failed to simulate commit transaction: ${JSON.stringify(
            sim.value.err
          )}`
        );
      }
      const sig = await connection.sendTransaction(tx, {
        maxRetries: 2,
        skipPreflight: true,
      });
      console.log(`Commit transaction sent: ${sig}`);
      try {
        await sendTxWithJito({
          serialisedTx: tx.serialize(),
          sendOptions: {},
          region: "mainnet",
        });
      } catch (e) {
        // console.log("Skipping Jito send");
      }
      try {
        await connection.confirmTransaction(sig);
        console.log(`Commit transaction confirmed: ${sig}`);
        break;
      } catch (e) {
        console.log("Failed to confirm commit transaction. Retrying...");
        await new Promise((f) => setTimeout(f, 1000));
        continue;
      }
    }
    await new Promise((f) => setTimeout(f, 1000));
    for (;;) {
      const data = await this.loadData();
      if (data.revealSlot.toNumber() !== 0) {
        break;
      }
      let revealIx: TransactionInstruction | undefined = undefined;
      try {
        revealIx = await this.revealIx();
      } catch (e) {
        console.log(e);
        console.log("Failed to grab reveal signature. Retrying...");
        await new Promise((f) => setTimeout(f, 1000));
        continue;
      }
      const tx = await InstructionUtils.asV0TxWithComputeIxs({
        connection: this.program.provider.connection,
        ixs: [
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: computeUnitPrice,
          }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
          revealIx!,
          ...callback,
        ],
      });

      tx.sign(signers);
      const sim = await connection.simulateTransaction(tx, {
        commitment: "processed",
      });
      if (sim.value.err !== null) {
        console.log(sim.value.logs);
        throw new Error(
          `Failed to simulate commit transaction: ${JSON.stringify(
            sim.value.err
          )}`
        );
      }
      const sig = await connection.sendTransaction(tx, {
        maxRetries: 2,
        skipPreflight: true,
      });
      console.log(`RevealAndCallback transaction sent: ${sig}`);
      try {
        await sendTxWithJito({
          serialisedTx: tx.serialize(),
          sendOptions: {},
          region: "mainnet",
        });
      } catch (e) {
        // console.log("Skipping Jito send");
      }
      await connection.confirmTransaction(sig);
      console.log(`RevealAndCallback transaction confirmed: ${sig}`);
    }
  }

  /**
   * Serialize ix to file.
   *
   * @param {TransactionInstruction[]} revealIxs - The reveal instruction of a transaction.
   * @param {string} [fileName="serializedIx.bin"] - The name of the file to save the serialized IX to.
   * @throws Will throw an error if the request fails.
   * @returns {Promise<void>} A promise that resolves when the file has been written.
   */
  async serializeIxToFile(
    revealIxs: TransactionInstruction[],
    fileName: string = "serializedIx.bin"
  ): Promise<void> {
    const tx = await InstructionUtils.asV0TxWithComputeIxs({
      connection: this.program.provider.connection,
      ixs: revealIxs,
      payer: PublicKey.default,
    });

    fs.writeFile(fileName, tx.serialize(), (err) => {
      if (err) {
        console.error("Failed to write to file:", err);
        throw err;
      }
    });
  }

  /**
   * Creates a new `Randomness` account and prepares a commit transaction instruction.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {PublicKey} queue - The queue account to associate with the new `Randomness` account.
   * @returns {Promise<[Randomness, Keypair, TransactionInstruction[]]>} A promise that resolves to a tuple containing the new `Randomness` instance, the keypair, and an array of transaction instructions.
   */
  static async createAndCommitIxs(
    program: Program,
    queue: PublicKey
  ): Promise<[Randomness, Keypair, TransactionInstruction[]]> {
    const kp = Keypair.generate();
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), kp.publicKey.toBuffer()],
        program.programId
      )
    )[0];
    const recentSlot = await program.provider.connection.getSlot("finalized");
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: PublicKey.default,
      recentSlot,
    });
    const queueAccount = new Queue(program, queue);
    const oracle = await queueAccount.fetchFreshOracle();
    const creationIx = program.instruction.randomnessInit(
      {},
      {
        accounts: {
          randomness: kp.publicKey,
          queue,
          authority: program.provider.publicKey!,
          payer: program.provider.publicKey!,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            spl.NATIVE_MINT,
            kp.publicKey
          ),
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          wrappedSolMint: spl.NATIVE_MINT,
          programState: State.keyFromSeed(program),
          lutSigner,
          lut,
          addressLookupTableProgram: AddressLookupTableProgram.programId,
        },
      }
    );
    const newRandomness = new Randomness(program, kp.publicKey);
    const commitIx = await newRandomness.commitIx(
      oracle,
      program.provider.publicKey!
    );

    return [newRandomness, kp, [creationIx, commitIx]];
  }
}
