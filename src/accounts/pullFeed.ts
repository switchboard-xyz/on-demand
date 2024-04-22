import { SLOT_HASHES_SYSVAR_ID } from "../constants.js";
import type { FeedEvalResponse } from "../oracle-interfaces/gateway.js";

import { RecentSlotHashes } from "./../sysvars/recentSlothashes.js";
import { Queue } from "./queue.js";
import { State } from "./state.js";
import type { Program } from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import type {
  AccountMeta,
  Connection,
  TransactionInstruction,
} from "@solana/web3.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import type { OracleJob } from "@switchboard-xyz/common";
import Big from "big.js";

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

  /**
   *  Initializes a pull feed account.
   *
   *  @param program The Anchor program instance.
   *  @param queue The queue account public key.
   *  @param feedHash The hash of the feed as a `Uint8Array`.
   *  @returns A promise that resolves to a tuple containing the pull feed instance and the transaction signature.
   */
  initIx(params: {
    queue: PublicKey;
    feedHash: Buffer;
    maxVariance: number;
    minResponses: number;
  }): TransactionInstruction {
    const payer = (this.program.provider as any).wallet.payer;
    const maxVariance = Math.floor(params.maxVariance * 1e9);
    const ix = this.program.instruction.pullFeedInit(
      {
        feedHash: params.feedHash,
        maxVariance: new anchor.BN(maxVariance),
        minResponses: params.minResponses,
      },
      {
        accounts: {
          pullFeed: this.pubkey,
          queue: params.queue,
          payer: payer.publicKey,
          authority: payer.publicKey,
          systemProgram: SystemProgram.programId,
          programState: State.keyFromSeed(this.program),
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            spl.NATIVE_MINT,
            this.pubkey
          ),
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          wrappedSolMint: spl.NATIVE_MINT,
        },
      }
    );
    return ix;
  }

  /**
   * Set configurations for the feed.
   *
   * @param params
   *        - feedHash: The hash of the feed as a `Uint8Array`. Only results signed with this hash will be accepted
   *        - authority: The authority of the feed.
   *        - maxVariance: The maximum variance allowed for the feed.
   *        - minResponses: The minimum number of responses required.
   * @returns A promise that resolves to the transaction instruction to set feed configs.
   */
  async setConfigsIx(params: {
    feedHash?: Uint8Array;
    authority?: PublicKey;
    maxVariance?: number;
    minResponses?: number;
  }): Promise<TransactionInstruction> {
    const data = await this.loadData();
    const payer = (this.program.provider as any).wallet.payer;
    const signers = [payer];
    if (params.authority) {
      signers.push(params.authority);
    }
    const ix = this.program.instruction.pullFeedSetConfigs(
      {
        feedHash: params.feedHash ?? null,
        authority: params.authority ?? null,
        maxVariance: params.maxVariance ?? null,
        minResponses: params.minResponses ?? null,
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

  async solanaFetchUpdateIx(
    params_: {
      gateway?: string;
      queue: PublicKey;
      jobs: OracleJob[];
      numSignatures: number;
      maxVariance: number;
      minResponses: number;
    },
    recentSlothashes?: Array<[anchor.BN, string]>,
    priceSignatures?: FeedEvalResponse[]
  ): Promise<TransactionInstruction> {
    const params = {
      feed: this.pubkey,
      ...params_,
    };
    return await PullFeed.solanaFetchUpdateIx(this.program, params);
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
  static async solanaFetchUpdateIx(
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
    priceSignatures?: FeedEvalResponse[]
  ): Promise<TransactionInstruction> {
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
    params.feedHash = Buffer.from(
      priceSignatures[0].feed_hash.toString(),
      "hex"
    );
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
    return await feed.solanaSubmitSignaturesIx(
      priceSignatures,
      offsets,
      slotHashes[0][0]
    );
  }

  /**
   *  Compiles a transaction instruction to submit oracle signatures for a given feed.
   *
   *  @param resps The oracle responses. This may be obtained from the `Gateway` class.
   *  @param slot The slot at which the oracles signed the feed with the current slothash.
   *  @returns A promise that resolves to the transaction instruction.
   */
  async solanaSubmitSignaturesIx(
    resps: FeedEvalResponse[],
    offsets: number[],
    slot: anchor.BN
  ): Promise<TransactionInstruction> {
    const program = this.program;
    const payer = (program.provider as any).wallet.payer;
    const queue = new PublicKey(
      Buffer.from(resps[0].queue_pubkey.toString(), "hex")
    );
    const oracles = resps.map(
      (x) => new PublicKey(Buffer.from(x.oracle_pubkey.toString(), "hex"))
    );
    const oracleFeedStats = oracles.map(
      (oracle) =>
        PublicKey.findProgramAddressSync(
          [
            Buffer.from("OracleFeedStats"),
            this.pubkey.toBuffer(),
            oracle.toBuffer(),
          ],
          program.programId
        )[0]
    );
    const submissions = resps.map((resp, idx) => ({
      value: new anchor.BN(resp.success_value.toString()),
      signature: resp.signature,
      recoveryId: resp.recovery_id,
      slotOffset: offsets[idx],
    }));
    const instructionData = {
      slot: new anchor.BN(slot),
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
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
      feedRewardEscrow: spl.getAssociatedTokenAddressSync(
        spl.NATIVE_MINT,
        this.pubkey
      ),
      tokenProgram: spl.TOKEN_PROGRAM_ID,
      wrappedSolMint: spl.NATIVE_MINT,
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
              // console.log(`submission: ${JSON.stringify(x)}`);
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
}