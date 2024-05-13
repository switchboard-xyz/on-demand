import { SLOT_HASHES_SYSVAR_ID } from "../constants.js";
import type { FeedEvalResponse } from "../oracle-interfaces/gateway.js";

import { InstructionUtils } from "./../instruction-utils/InstructionUtils.js";
import { RecentSlotHashes } from "./../sysvars/recentSlothashes.js";
import { Oracle } from "./oracle.js";
import { Queue } from "./queue.js";
import { State } from "./state.js";

import type { Program } from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import type {
  AccountMeta,
  AddressLookupTableAccount,
  Connection,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import type { IOracleJob, OracleJob } from "@switchboard-xyz/common";
import { FeedHash } from "@switchboard-xyz/common";
import Big from "big.js";
const crypto = require("crypto");

type OracleResponse = {
  oracle: Oracle;
  value: Big | null;
  error: string;
};

function padStringWithNullBytes(
  input: string,
  desiredLength: number = 32
): string {
  const nullByte = "\0";
  while (input.length < desiredLength) {
    input += nullByte;
  }
  return input;
}

export type FeedSubmission = { value: Big; slot: anchor.BN; oracle: PublicKey };

export function toFeedValue(
  submissions: FeedSubmission[],
  onlyAfter: anchor.BN
): FeedSubmission | null {
  let values = submissions.filter((x) => x.slot.gt(onlyAfter));
  if (values.length === 0) {
    return null;
  }
  values = values.sort((x, y) => (x.value.lt(y.value) ? -1 : 1));
  return values[Math.floor(values.length / 2)];
}

/**
 *  Checks if the pull feed account needs to be initialized.
 *
 *  @param connection The connection to use.
 *  @param programId The program ID.
 *  @param pubkey The public key of the pull feed account.
 *  @returns A promise that resolves to a boolean indicating if the account needs to be initialized.
 */
async function checkNeedsInit(
  connection: Connection,
  programId: PublicKey,
  pubkey: PublicKey
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(pubkey);
  if (accountInfo === null) return true;

  const owner = accountInfo.owner;
  if (!owner.equals(programId)) return true;

  return false;
}

/**
 *  Abstraction around the Switchboard-On-Demand Feed account
 *
 *  This account is used to store the feed data and the oracle responses
 *  for a given feed.
 */
export class PullFeed {
  /**
   *  Constructs a `PullFeed` instance.
   *
   *  @param program The Anchor program instance.
   *  @param pubkey The public key of the pull feed account.
   */
  constructor(readonly program: Program, readonly pubkey: PublicKey) {}

  static generate(program: Program): [PullFeed, Keypair] {
    const keypair = Keypair.generate();
    const feed = new PullFeed(program, keypair.publicKey);
    return [feed, keypair];
  }

  async initTx(
    program: Program,
    params: {
      name: string;
      queue: PublicKey;
      jobs: IOracleJob[];
      maxVariance: number;
      minResponses: number;
      payer?: PublicKey;
    }
  ): Promise<VersionedTransaction> {
    const ix = await this.initIx(params);
    const tx = await InstructionUtils.asV0Tx(program, [ix]);
    return tx;
  }

  /**
   *  Initializes a pull feed account.
   *
   *  @param program The Anchor program instance.
   *  @param queue The queue account public key.
   *  @param jobs The oracle jobs to execute.
   *  @returns A promise that resolves to a tuple containing the pull feed instance and the transaction signature.
   */
  async initIx(params: {
    name: string;
    queue: PublicKey;
    jobs: IOracleJob[];
    maxVariance: number;
    minResponses: number;
    ipfsHash?: string;
    payer?: PublicKey;
  }): Promise<TransactionInstruction> {
    const ipfsHash = params.ipfsHash ?? new Uint8Array(32);
    const payerPublicKey =
      params.payer ?? (this.program.provider as any).wallet.payer.publicKey;
    const maxVariance = Math.floor(params.maxVariance * 1e9);
    const jobs = params.jobs;
    const feedHash = FeedHash.compute(params.queue.toBuffer(), jobs);
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
        this.program.programId
      )
    )[0];
    const recentSlot = await this.program.provider.connection.getSlot(
      "finalized"
    );
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: payerPublicKey,
      recentSlot,
    });
    const ix = this.program.instruction.pullFeedInit(
      {
        feedHash: feedHash,
        maxVariance: new anchor.BN(maxVariance),
        minResponses: params.minResponses,
        name: Buffer.from(padStringWithNullBytes(params.name)),
        recentSlot: new anchor.BN(recentSlot),
        ipfsHash: new Uint8Array(32),
      },
      {
        accounts: {
          pullFeed: this.pubkey,
          queue: params.queue,
          authority: payerPublicKey,
          payer: payerPublicKey,
          systemProgram: SystemProgram.programId,
          programState: State.keyFromSeed(this.program),
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            spl.NATIVE_MINT,
            this.pubkey
          ),
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          wrappedSolMint: spl.NATIVE_MINT,
          lutSigner,
          lut,
          addressLookupTableProgram: AddressLookupTableProgram.programId,
        },
      }
    );
    return ix;
  }

  /**
   * Set configurations for the feed.
   *
   * @param params
   *        - feedHash: The hash of the feed as a `Uint8Array` or hexadecimal `string`. Only results
   *          signed with this hash will be accepted.
   *        - authority: The authority of the feed.
   *        - maxVariance: The maximum variance allowed for the feed.
   *        - minResponses: The minimum number of responses required.
   * @returns A promise that resolves to the transaction instruction to set feed configs.
   */
  async setConfigsIx(params: {
    name?: string;
    jobs?: IOracleJob[];
    authority?: PublicKey;
    maxVariance?: number;
    minResponses?: number;
  }): Promise<TransactionInstruction> {
    const data = await this.loadData();
    const jobs = params.jobs;
    const feedHash = jobs?.length
      ? FeedHash.compute(data.queue.toBuffer(), jobs)
      : null;
    const name =
      params.name !== undefined
        ? Buffer.from(padStringWithNullBytes(params.name))
        : null;
    const ix = this.program.instruction.pullFeedSetConfigs(
      {
        name,
        feedHash,
        authority: params.authority ?? null,
        maxVariance: params.maxVariance ?? null,
        minResponses: params.minResponses ?? null,
        ipfs_hash: null,
      },
      {
        accounts: {
          pullFeed: this.pubkey,
          authority: data.authority,
        },
      }
    );
    return ix;
  }

  async fetchUpdateIx(
    params_: {
      gateway?: string;
      queue: PublicKey;
      jobs: OracleJob[];
      numSignatures: number;
      maxVariance: number;
      minResponses: number;
    },
    recentSlothashes?: Array<[anchor.BN, string]>,
    priceSignatures?: FeedEvalResponse[],
    debug: boolean = false
  ): Promise<[TransactionInstruction | undefined, OracleResponse[], number]> {
    const params = {
      feed: this.pubkey,
      ...params_,
    };
    return await PullFeed.fetchUpdateIx(
      this.program,
      params,
      recentSlothashes,
      priceSignatures,
      debug
    );
  }

  /**
   * Given an oracle job, this call allow the user to query the oracle(s)
   * for signed vlaues given any of the blockhashes provided.
   *
   * @param program The Anchor program instance.
   * @param params_ The parameters for the oracle query.
   *        - gateway: The gateway url to use. If not provided,
   *                   the gateway is automatically fetched.
   *        - queue: The queue account public key.
   *        - feed: The feed account public key.
   *        - jobs: The oracle jobs to execute.
   *        - numSignatures: The number of signatures to fetch.
   *        - maxVariance: The maximum variance allowed for the feed.
   *        - minResponses: The minimum number of responses required.
   * @returns A promise that resolves to the transaction instruction.
   */
  static async fetchUpdateIx(
    program: Program,
    params_: {
      gateway?: string;
      queue: PublicKey;
      feed: PublicKey;
      jobs: OracleJob[];
      numSignatures: number;
      maxVariance: number;
      minResponses: number;
    },
    recentSlothashes?: Array<[anchor.BN, string]>,
    priceSignatures?: FeedEvalResponse[],
    debug: boolean = false,
    payer?: PublicKey
  ): Promise<[TransactionInstruction | undefined, OracleResponse[], number]> {
    const slotHashes =
      recentSlothashes ??
      (await RecentSlotHashes.fetchLatestNSlothashes(
        program.provider.connection,
        30
      ));
    const params = params_ as any;
    params.recentHash = slotHashes[0][1];
    const feed = new PullFeed(program, params.feed);
    priceSignatures =
      priceSignatures ?? (await Queue.fetchSignatures(program, params));
    let numSuccesses = 0;
    const oracleResponses = priceSignatures.map((x) => {
      const oldDP = Big.DP;
      Big.DP = 40;
      const value = x.success_value ? new Big(x.success_value).div(1e18) : null;
      if (value !== null) {
        numSuccesses += 1;
      }
      Big.DP = oldDP;
      return {
        value,
        error: x.failure_error,
        oracle: new Oracle(
          program,
          new PublicKey(Buffer.from(x.oracle_pubkey, "hex"))
        ),
      };
    });

    const offsets: number[] = new Array(priceSignatures.length).fill(0);
    for (let i = 0; i < priceSignatures.length; i++) {
      if (priceSignatures[i].failure_error.length > 0) {
        let validResp = false;
        for (const recentSignature of priceSignatures[i]
          .recent_successes_if_failed) {
          for (let offset = 0; offset < slotHashes.length; offset++) {
            const slotHash = slotHashes[offset];
            if (slotHash[1] === recentSignature.recent_hash) {
              priceSignatures[i] = recentSignature;
              offsets[i] = offset;
              validResp = true;
              break;
            }
          }
          if (validResp) {
            break;
          }
        }
      }
    }
    if (debug) {
      console.log("priceSignatures", priceSignatures);
    }
    let submitSignaturesIx: TransactionInstruction | undefined = undefined;
    if (numSuccesses > 0) {
      submitSignaturesIx = await feed.solanaSubmitSignaturesIx({
        resps: priceSignatures,
        offsets: offsets,
        slot: slotHashes[0][0],
        payer,
      });
    }
    return [submitSignaturesIx, oracleResponses, numSuccesses];
  }

  /**
   *  Compiles a transaction instruction to submit oracle signatures for a given feed.
   *
   *  @param resps The oracle responses. This may be obtained from the `Gateway` class.
   *  @param slot The slot at which the oracles signed the feed with the current slothash.
   *  @returns A promise that resolves to the transaction instruction.
   */
  async solanaSubmitSignaturesIx(params: {
    resps: FeedEvalResponse[];
    offsets: number[];
    slot: anchor.BN;
    payer?: PublicKey;
  }): Promise<TransactionInstruction> {
    const program = this.program;
    const payerPublicKey =
      params.payer ?? (program.provider as any).wallet.payer.publicKey;
    const queue = new PublicKey(
      Buffer.from(params.resps[0].queue_pubkey.toString(), "hex")
    );
    const oracles = params.resps.map(
      (x) => new PublicKey(Buffer.from(x.oracle_pubkey.toString(), "hex"))
    );
    const oracleFeedStats = oracles.map(
      (oracle) =>
        PublicKey.findProgramAddressSync(
          [Buffer.from("OracleStats"), oracle.toBuffer()],
          program.programId
        )[0]
    );
    const submissions = params.resps.map((resp, idx) => ({
      value: new anchor.BN(resp.success_value.toString()),
      signature: resp.signature,
      recoveryId: resp.recovery_id,
      slotOffset: params.offsets[idx],
    }));
    const instructionData = {
      slot: new anchor.BN(params.slot),
      submissions: submissions.map((x: any) => {
        x.signature = Buffer.from(x.signature, "base64");
        return x;
      }),
    };

    const accounts = {
      feed: this.pubkey,
      queue: queue,
      programState: State.keyFromSeed(program),
      recentSlothashes: SLOT_HASHES_SYSVAR_ID,
      payer: payerPublicKey,
      systemProgram: SystemProgram.programId,
      feedRewardEscrow: spl.getAssociatedTokenAddressSync(
        spl.NATIVE_MINT,
        this.pubkey
      ),
      tokenProgram: spl.TOKEN_PROGRAM_ID,
      tokenMint: spl.NATIVE_MINT,
    };
    const remainingAccounts: AccountMeta[] = [
      ...oracles.map((k) => ({
        pubkey: k,
        isSigner: false,
        isWritable: false,
      })),
      ...oracleFeedStats.map((k) => ({
        pubkey: k,
        isSigner: false,
        isWritable: true,
      })),
    ];
    const ix = await program.instruction.pullFeedSubmitResponse(
      instructionData,
      { accounts, remainingAccounts }
    );
    return ix;
  }

  /**
   *  Checks if the pull feed account has been initialized.
   *
   *  @returns A promise that resolves to a boolean indicating if the account has been initialized.
   */
  async isInitializedAsync(): Promise<boolean> {
    return !(await checkNeedsInit(
      this.program.provider.connection,
      this.program.programId,
      this.pubkey
    ));
  }

  /**
   *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
   *
   *  @returns A promise that resolves to the feed data.
   *  @throws if the feed account does not exist.
   */
  async loadData(): Promise<any> {
    return await this.program.account.pullFeedAccountData.fetch(this.pubkey);
  }

  /**
   *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
   *
   *  @returns A promise that resolves to the values currently stored in the feed.
   *  @throws if the feed account does not exist.
   */
  async loadValues(): Promise<
    Array<{ value: Big; slot: anchor.BN; oracle: PublicKey }>
  > {
    const data = await this.loadData();
    return data.submissions
      .filter((x: any) => !x.oracle.equals(PublicKey.default))
      .map((x: any) => {
        Big.DP = 40;
        return {
          value: new Big(x.value.toString()).div(1e18),
          slot: new Big(x.slot.toString()),
          oracle: x.oracle,
        };
      });
  }

  /**
   *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
   *
   *  @param onlyAfter Call will ignore data signed before this slot.
   *  @returns A promise that resolves to the observed value as it would be
   *           seen on-chain.
   */
  async loadObservedValue(onlyAfter: anchor.BN): Promise<{
    value: Big;
    slot: anchor.BN;
    oracle: PublicKey;
  } | null> {
    const values = await this.loadValues();
    return toFeedValue(values, onlyAfter);
  }

  /**
   * Watches for any on-chain updates to the feed data.
   *
   * @param callback The callback to call when the feed data is updated.
   * @returns A promise that resolves to a subscription ID.
   */
  async subscribeToValueChanges(callback: any): Promise<number> {
    const coder = new BorshAccountsCoder(this.program.idl);
    const subscriptionId = this.program.provider.connection.onAccountChange(
      this.pubkey,
      async (accountInfo, context) => {
        const feed = coder.decode("PullFeedAccountData", accountInfo.data);
        await callback(
          feed.submissions
            .filter((x: any) => !x.oracle.equals(PublicKey.default))
            .map((x: any) => {
              Big.DP = 40;
              return {
                value: new Big(x.value.toString()).div(1e18),
                slot: new anchor.BN(x.slot.toString()),
                oracle: new PublicKey(x.oracle),
              };
            })
        );
      },
      "processed"
    );
    return subscriptionId;
  }

  /**
   * Watches for any on-chain updates to any data feed.
   *
   * @param program The Anchor program instance.
   * @param callback The callback to call when the feed data is updated.
   * @returns A promise that resolves to a subscription ID.
   */
  static async subscribeToAllUpdates(
    program: Program,
    callback: (
      event: [number, { pubkey: PublicKey; submissions: FeedSubmission[] }]
    ) => Promise<void>
  ): Promise<number> {
    const coder = new BorshAccountsCoder(program.idl);
    const subscriptionId = program.provider.connection.onProgramAccountChange(
      program.programId,
      async (keyedAccountInfo, ctx) => {
        const { accountId, accountInfo } = keyedAccountInfo;
        try {
          const feed = coder.decode("PullFeedAccountData", accountInfo.data);
          await callback([
            ctx.slot,
            {
              pubkey: accountId,
              submissions: feed.submissions
                .filter((x) => !x.oracle.equals(PublicKey.default))
                .map((x) => {
                  Big.DP = 40;
                  return {
                    value: new Big(x.value.toString()).div(1e18),
                    slot: new anchor.BN(x.slot.toString()),
                    oracle: new PublicKey(x.oracle),
                  };
                }),
            },
          ]);
        } catch (e) {
          console.log(`ParseFailure: ${e}`);
        }
      },
      "processed",
      [
        {
          memcmp: {
            bytes: "ZoV7s83c7bd",
            offset: 0,
          },
        },
      ]
    );
    return subscriptionId;
  }

  async loadLookupTable(): Promise<AddressLookupTableAccount> {
    const data = await this.loadData();
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
        this.program.programId
      )
    )[0];
    const [_, lutKey] = await AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: PublicKey.default,
      recentSlot: data.lutSlot,
    });
    const accnt = await this.program.provider.connection.getAddressLookupTable(
      lutKey
    );
    return accnt.value!;
  }
}
