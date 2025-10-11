import {
  SOL_NATIVE_MINT,
  SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
  SPL_SYSVAR_SLOT_HASHES_ID,
  SPL_TOKEN_PROGRAM_ID,
} from '../constants.js';
import { InstructionUtils } from '../instruction-utils/InstructionUtils.js';
import { Gateway } from '../oracle-interfaces/gateway.js';
import * as spl from '../utils/index.js';
import { getLutKey, getLutSigner } from '../utils/lookupTable.js';

import { Oracle, OracleAccountData } from './oracle.js';
import { Queue } from './queue.js';
import { State } from './state.js';

import type { Program } from '@coral-xyz/anchor-31';
import { BN, web3 } from '@coral-xyz/anchor-31';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

function isNonSolana(queue: web3.PublicKey): boolean {
  return (
    queue.equals(spl.ON_DEMAND_MAINNET_QUEUE_PDA) ||
    queue.equals(spl.ON_DEMAND_DEVNET_QUEUE_PDA)
  );
}

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
  private static getPayer(
    program: Program,
    payer?: web3.PublicKey
  ): web3.PublicKey {
    return payer ?? program.provider.publicKey ?? web3.PublicKey.default;
  }

  /**
   * Constructs a `Randomness` instance.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {web3.PublicKey} pubkey - The public key of the randomness account.
   */
  constructor(
    readonly program: Program,
    readonly pubkey: web3.PublicKey
  ) {}

  /**
   * Loads the randomness data for this {@linkcode Randomness} account from on chain.
   *
   * @returns {Promise<any>} A promise that resolves to the randomness data.
   * @throws Will throw an error if the randomness account does not exist.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadData(): Promise<any> {
    return await this.program.account['randomnessAccountData'].fetch(
      this.pubkey
    );
  }

  /**
   * Creates a new `Randomness` account.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {web3.Keypair} kp - The keypair of the new `Randomness` account.
   * @param {web3.PublicKey} queue - The queue account to associate with the new `Randomness` account.
   * @param {web3.PublicKey} [payer_] - The payer for the transaction. If not provided, the default payer from the program provider is used.
   * @returns {Promise<[Randomness, web3.TransactionInstruction]>} A promise that resolves to a tuple containing the new `Randomness` account and the transaction instruction.
   */
  static async create(
    program: Program,
    kp: web3.Keypair,
    queue: web3.PublicKey,
    payer_?: web3.PublicKey
  ): Promise<[Randomness, web3.TransactionInstruction]> {
    const payer = Randomness.getPayer(program, payer_);

    const lutSigner = getLutSigner(program.programId, kp.publicKey);
    const recentSlot = await program.provider.connection.getSlot('finalized');
    const lutKey = getLutKey(lutSigner, recentSlot);
    const ix = program.instruction.randomnessInit(
      {
        recentSlot: new BN(recentSlot.toString()),
      },
      {
        accounts: {
          randomness: kp.publicKey,
          queue,
          authority: payer,
          payer: payer,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            SOL_NATIVE_MINT,
            kp.publicKey
          ),
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
          wrappedSolMint: SOL_NATIVE_MINT,
          programState: State.keyFromSeed(program),
          lutSigner: lutSigner,
          lut: lutKey,
          addressLookupTableProgram: web3.AddressLookupTableProgram.programId,
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
    queue: web3.PublicKey,
    authority_?: web3.PublicKey,
    oracle_?: web3.PublicKey
  ): Promise<web3.TransactionInstruction> {
    const queueAccount = new Queue(this.program, queue);
    let oracle: web3.PublicKey;

    // If we're on a non-Solana SVM network - we'll need the oracle address as a PDA on the target chain
    if (oracle_) {
      oracle = oracle_;
    } else if (isNonSolana(queue)) {
      const isMainnet = queue.equals(spl.ON_DEMAND_MAINNET_QUEUE_PDA);
      const solanaQueue = await spl.getQueue({
        program: this.program,
        queueAddress: spl.getDefaultQueueAddress(isMainnet),
      });
      const solanaOracle = await solanaQueue.fetchFreshOracle();
      [oracle] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from('Oracle'), queue.toBuffer(), solanaOracle.toBuffer()],
        spl.ON_DEMAND_MAINNET_PID
      );
    } else {
      oracle = await queueAccount.fetchFreshOracle();
    }

    const authority = authority_ ?? (await this.loadData()).authority;
    const ix = this.program.instruction.randomnessCommit(
      {},
      {
        accounts: {
          randomness: this.pubkey,
          queue,
          oracle,
          recentSlothashes: SPL_SYSVAR_SLOT_HASHES_ID,
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
   * @returns {Promise<web3.TransactionInstruction>} A promise that resolves to the transaction instruction.
   */
  async revealIx(
    payer_?: web3.PublicKey
  ): Promise<web3.TransactionInstruction> {
    await new Promise(f => setTimeout(f, 3000));
    const payer = Randomness.getPayer(this.program, payer_);
    const data = await this.loadData();

    let oracleData: OracleAccountData;

    // if non-Solana SVM network - we'll need to get the solana oracle address from the oracle PDA
    if (isNonSolana(data.queue)) {
      const solanaOracle = await new Oracle(
        this.program,
        data.oracle
      ).findSolanaOracleFromPDA();
      oracleData = solanaOracle.oracleData;
    } else {
      const oracle = new Oracle(this.program, data.oracle);
      oracleData = await oracle.loadData();
    }

    const gatewayUrl = String.fromCharCode(...oracleData.gatewayUri).replace(
      /\0+$/,
      ''
    );

    const gateway = new Gateway(this.program, gatewayUrl);
    const gatewayRevealResponse = await gateway.fetchRandomnessReveal({
      randomnessAccount: this.pubkey,
      slothash: bs58.encode(data.seedSlothash),
      slot: data.seedSlot.toNumber(),
      rpc: this.program.provider.connection.rpcEndpoint,
    });
    const stats = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('OracleRandomnessStats'), data.oracle.toBuffer()],
      this.program.programId
    )[0];
    const ix = this.program.instruction.randomnessReveal(
      {
        signature: Buffer.from(gatewayRevealResponse.signature, 'base64'),
        recoveryId: gatewayRevealResponse.recovery_id,
        value: gatewayRevealResponse.value,
      },
      {
        accounts: {
          randomness: this.pubkey,
          oracle: data.oracle,
          queue: data.queue,
          stats,
          authority: data.authority,
          payer,
          recentSlothashes: SPL_SYSVAR_SLOT_HASHES_ID,
          systemProgram: web3.SystemProgram.programId,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            SOL_NATIVE_MINT,
            this.pubkey
          ),
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
          wrappedSolMint: SOL_NATIVE_MINT,
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
    callback: web3.TransactionInstruction[],
    signers: web3.Keypair[],
    queue: web3.PublicKey,
    configs?: {
      computeUnitPrice?: number;
      computeUnitLimit?: number;
    },
    debug?: boolean
  ): Promise<void> {
    // In this function (because its 2 back to back transactions) we need to use the payer from the
    // provider as the authority for the commit transaction.
    const authority = spl.getNodePayer(this.program);
    const computeUnitPrice = configs?.computeUnitPrice ?? 50_000;
    const computeUnitLimit = configs?.computeUnitLimit ?? 200_000;
    const connection = this.program.provider.connection;
    for (;;) {
      const data = await this.loadData();
      if (data.seedSlot.toNumber() !== 0) {
        if (debug) {
          console.log('Randomness slot already committed. Jumping to reveal.');
        }
        break;
      }
      const tx = await InstructionUtils.asV0TxWithComputeIxs({
        connection,
        ixs: [
          web3.ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: computeUnitPrice,
          }),
          await this.commitIx(queue, data.authority),
        ],
      });
      tx.sign([authority]);
      const sim = await connection.simulateTransaction(tx, {
        commitment: 'processed',
      });
      if (sim.value.err !== null) {
        if (debug) {
          console.log('Logs', sim.value.logs);
        }
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
      if (debug) {
        console.log(`Commit transaction sent: ${sig}`);
      }
      try {
        await connection.confirmTransaction(sig);
        if (debug) {
          console.log(`Commit transaction confirmed: ${sig}`);
        }
        break;
      } catch {
        if (debug) {
          console.log('Failed to confirm commit transaction. Retrying...');
        }
        await new Promise(f => setTimeout(f, 1000));
        continue;
      }
    }
    await new Promise(f => setTimeout(f, 1000));
    for (;;) {
      const data = await this.loadData();
      if (data.revealSlot.toNumber() !== 0) {
        break;
      }
      let revealIx: web3.TransactionInstruction | undefined = undefined;
      try {
        revealIx = await this.revealIx(authority.publicKey);
      } catch (e) {
        if (debug) {
          console.log(e);
          console.log('Failed to grab reveal signature. Retrying...');
        }
        await new Promise(f => setTimeout(f, 1000));
        continue;
      }
      const tx = await InstructionUtils.asV0TxWithComputeIxs({
        connection: this.program.provider.connection,
        ixs: [
          web3.ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: computeUnitPrice,
          }),
          web3.ComputeBudgetProgram.setComputeUnitLimit({
            units: computeUnitLimit,
          }),
          revealIx!,
          ...callback,
        ],
      });

      tx.sign([authority, ...signers]);
      const sim = await connection.simulateTransaction(tx, {
        commitment: 'processed',
      });
      if (sim.value.err !== null) {
        if (debug) {
          console.log('Logs', sim.value.logs);
        }
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
      if (debug) {
        console.log(`RevealAndCallback transaction sent: ${sig}`);
      }
      await connection.confirmTransaction(sig);
      if (debug) {
        console.log(`RevealAndCallback transaction confirmed: ${sig}`);
      }
    }
  }

  /**
   * Creates a new `Randomness` account and prepares a commit transaction instruction.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {web3.PublicKey} queue - The queue account to associate with the new `Randomness` account.
   * @returns {Promise<[Randomness, web3.Keypair, web3.TransactionInstruction[]]>} A promise that resolves to a tuple containing the new `Randomness` instance, the keypair, and an array of transaction instructions.
   */
  static async createAndCommitIxs(
    program: Program,
    queue: web3.PublicKey,
    payer_?: web3.PublicKey
  ): Promise<[Randomness, web3.Keypair, web3.TransactionInstruction[]]> {
    const payer = Randomness.getPayer(program, payer_);
    const accountKeypair = web3.Keypair.generate();
    const [account, creationIx] = await Randomness.create(
      /* program= */ program,
      /* kp= */ accountKeypair,
      /* queue= */ queue,
      /* payer= */ payer
    );
    const commitIx = await account.commitIx(
      /* queue= */ queue,
      /* authority= */ payer
    );

    // TODO: Why do we return the account keypair? The authority is already set to the payer right?
    return [account, accountKeypair, [creationIx, commitIx]];
  }

  /**
   * Generate a randomness `close` solana transaction instruction.
   * This will close the randomness account and return the rent to the authority.
   *
   * @returns {Promise<web3.TransactionInstruction>} A promise that resolves to the transaction instruction.
   */
  async closeIx(): Promise<web3.TransactionInstruction> {
    const data = await this.loadData();
    const lutSigner = getLutSigner(this.program.programId, this.pubkey);
    const lutKey = getLutKey(lutSigner, data.lutSlot);

    const ix = this.program.instruction.randomnessClose(
      {},
      {
        accounts: {
          randomness: this.pubkey,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            SOL_NATIVE_MINT,
            this.pubkey
          ),
          authority: data.authority,
          programState: State.keyFromSeed(this.program),
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          wrappedSolMint: SOL_NATIVE_MINT,
          lut: lutKey,
          lutSigner: lutSigner,
          addressLookupTableProgram: web3.AddressLookupTableProgram.programId,
        },
      }
    );
    return ix;
  }
}
