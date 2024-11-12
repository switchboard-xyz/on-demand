import { SLOT_HASHES_SYSVAR_ID } from "../constants.js";
import type {
  FeedEvalResponse,
  FetchSignaturesMultiResponse,
} from "../oracle-interfaces/gateway.js";

import { InstructionUtils } from "./../instruction-utils/InstructionUtils.js";
import { RecentSlotHashes } from "./../sysvars/recentSlothashes.js";
import * as spl from "./../utils/index.js";
import {
  getDefaultDevnetQueue,
  getDefaultQueue,
  loadLookupTables,
} from "./../utils/index.js";
import { Oracle } from "./oracle.js";
import { Queue } from "./queue.js";
import { State } from "./state.js";

import { TTLCache } from "@brokerloop/ttlcache";
import type { Program } from "@coral-xyz/anchor-30";
import { BorshAccountsCoder } from "@coral-xyz/anchor-30";
import * as anchor from "@coral-xyz/anchor-30";
import { BN } from "@coral-xyz/anchor-30";
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
import type { IOracleJob } from "@switchboard-xyz/common";
import { OracleJob } from "@switchboard-xyz/common";
import { CrossbarClient, FeedHash } from "@switchboard-xyz/common";
import { bs58 } from "@switchboard-xyz/common";
import Big from "big.js";

const QUEUE_CACHE = new TTLCache<string, Queue>({
  ttl: 60 * 1000,
  max: 50,
  clock: Date,
});

const PRECISION = 18;

export interface CurrentResult {
  value: BN;
  stdDev: BN;
  mean: BN;
  range: BN;
  minValue: BN;
  maxValue: BN;
  slot: BN;
  minSlot: BN;
  maxSlot: BN;
}

export interface CompactResult {
  stdDev: number;
  mean: number;
  slot: BN;
}

export interface OracleSubmission {
  oracle: PublicKey;
  slot: BN;
  value: BN;
}

export interface PullFeedAccountData {
  submissions: OracleSubmission[];
  authority: PublicKey;
  queue: PublicKey;
  feedHash: Uint8Array;
  initializedAt: BN;
  permissions: BN;
  maxVariance: BN;
  minResponses: number;
  name: Uint8Array;
  sampleSize: number;
  lastUpdateTimestamp: BN;
  lutSlot: BN;
  result: CurrentResult;
  maxStaleness: number;
  minSampleSize: number;
  historicalResultIdx: number;
  historicalResults: CompactResult[];
}

export type MultiSubmission = {
  values: anchor.BN[];
  signature: Buffer; // TODO: Does this need to be made a Uint8Array too?
  recoveryId: number;
};

export class OracleResponse {
  constructor(
    readonly oracle: Oracle,
    readonly value: Big | null,
    readonly error: string
  ) {}

  shortError(): string | undefined {
    if (this.error === "[]") {
      return undefined;
    }
    const parts = this.error.split("\n");
    return parts[0];
  }
}

export type FeedRequest = {
  maxVariance: number;
  minResponses: number;
  jobs: OracleJob[];
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
  gatewayUrl: string;
  pubkey: PublicKey;
  configs: {
    queue: PublicKey;
    maxVariance: number;
    minResponses: number;
    feedHash: Buffer;
    minSampleSize: number;
  } | null;
  jobs: IOracleJob[] | null;
  lut: AddressLookupTableAccount | null;

  /**
   * Constructs a `PullFeed` instance.
   *
   * @param program - The Anchor program instance.
   * @param pubkey - The public key of the pull feed account.
   */
  constructor(readonly program: Program, pubkey: PublicKey | string) {
    this.gatewayUrl = "";
    this.pubkey = new PublicKey(pubkey);
    this.configs = null;
    this.jobs = null;
  }

  static generate(program: Program): [PullFeed, Keypair] {
    const keypair = Keypair.generate();
    const feed = new PullFeed(program, keypair.publicKey);
    return [feed, keypair];
  }

  static async initTx(
    program: Program,
    params: {
      name: string;
      queue: PublicKey;
      maxVariance: number;
      minResponses: number;
      minSampleSize: number;
      maxStaleness: number;
      payer?: PublicKey;
    } & ({ feedHash: Buffer } | { jobs: IOracleJob[] })
  ): Promise<[PullFeed, VersionedTransaction]> {
    const [pullFeed, keypair] = PullFeed.generate(program);
    const ix = await pullFeed.initIx(params);
    const tx = await InstructionUtils.asV0TxWithComputeIxs({
      connection: program.provider.connection,
      ixs: [ix],
    });
    tx.sign([keypair]);
    return [pullFeed, tx];
  }

  private getPayer(payer?: PublicKey): PublicKey {
    return payer ?? this.program.provider.publicKey ?? PublicKey.default;
  }

  /**
   *  Calls to initialize a pull feed account and to update the configuration account need to
   *  compute the feed hash for the account (if one is not specified).
   */
  private static feedHashFromParams(params: {
    queue: PublicKey;
    feedHash?: Buffer;
    jobs?: IOracleJob[];
  }): Buffer {
    const hash = (() => {
      if (params.feedHash) {
        // If the feed hash is provided, use it.
        return params.feedHash;
      } else if (params.jobs?.length) {
        // Else if jobs are provided, compute the feed hash from the queue and jobs.
        return FeedHash.compute(params.queue.toBuffer(), params.jobs);
      }
      throw new Error('Either "feedHash" or "jobs" must be provided.');
    })();
    if (hash.byteLength === 32) return hash;
    throw new Error("Feed hash must be 32 bytes");
  }

  /**
   * Initializes a pull feed account.
   *
   * @param {anchor.Program} program - The Anchor program instance.
   * @param {PublicKey} queue - The queue account public key.
   * @param {Array<OracleJob>} jobs - The oracle jobs to execute.
   * @param {number} maxVariance - The maximum variance allowed for the feed.
   * @param {number} minResponses - The minimum number of job responses required.
   * @param {number} minSampleSize - The minimum number of samples required for setting feed value.
   * @param {number} maxStaleness - The maximum number of slots that can pass before a feed value is considered stale.
   * @returns {Promise<[PullFeed, string]>} A promise that resolves to a tuple containing the pull feed instance and the transaction signature.
   */
  async initIx(
    params: {
      name: string;
      queue: PublicKey;
      maxVariance: number;
      minResponses: number;
      payer?: PublicKey;
      minSampleSize: number;
      maxStaleness: number;
    } & ({ feedHash: Buffer } | { jobs: IOracleJob[] })
  ): Promise<TransactionInstruction> {
    const feedHash = PullFeed.feedHashFromParams({
      queue: params.queue,
      feedHash: "feedHash" in params ? params.feedHash : undefined,
      jobs: "jobs" in params ? params.jobs : undefined,
    });
    const payerPublicKey = this.getPayer(params.payer);
    const maxVariance = Math.floor(params.maxVariance * 1e9);
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
        ipfsHash: new Uint8Array(32), // Deprecated.
        minSampleSize: params.minSampleSize,
        maxStaleness: params.maxStaleness,
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

  async closeIx(params: {
    payer?: PublicKey;
  }): Promise<TransactionInstruction> {
    const payerPublicKey = this.getPayer(params.payer);
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
        this.program.programId
      )
    )[0];
    const data = await this.loadData();
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: payerPublicKey,
      recentSlot: BigInt(data.lutSlot.toString()),
    });
    const ix = this.program.instruction.pullFeedClose(
      {},
      {
        accounts: {
          pullFeed: this.pubkey,
          authority: data.authority,
          payer: payerPublicKey,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            spl.NATIVE_MINT,
            this.pubkey
          ),
          lutSigner,
          lut,
          state: State.keyFromSeed(this.program),
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
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
   * @param params.feedHash - The hash of the feed as a `Uint8Array` or hexadecimal `string`. Only results signed with this hash will be accepted.
   * @param params.authority - The authority of the feed.
   * @param params.maxVariance - The maximum variance allowed for the feed.
   * @param params.minResponses - The minimum number of responses required.
   * @param params.minSampleSize - The minimum number of samples required for setting feed value.
   * @param params.maxStaleness - The maximum number of slots that can pass before a feed value is considered stale.
   * @returns A promise that resolves to the transaction instruction to set feed configs.
   */
  async setConfigsIx(params: {
    name?: string;
    authority?: PublicKey;
    maxVariance?: number;
    minResponses?: number;
    feedHash?: Buffer;
    jobs?: IOracleJob[];
    minSampleSize?: number;
    maxStaleness?: number;
  }): Promise<TransactionInstruction> {
    const data = await this.loadData();
    const name =
      params.name !== undefined
        ? Buffer.from(padStringWithNullBytes(params.name))
        : null;
    const feedHash =
      params.feedHash || params.jobs
        ? PullFeed.feedHashFromParams({
            queue: data.queue,
            feedHash: params.feedHash,
            jobs: params.jobs,
          })
        : null;

    const ix = this.program.instruction.pullFeedSetConfigs(
      {
        name: name,
        feedHash: feedHash,
        authority: params.authority ?? null,
        maxVariance:
          params.maxVariance !== undefined
            ? new anchor.BN(Math.floor(params.maxVariance * 1e9))
            : null,
        minResponses: params.minResponses ?? null,
        minSampleSize: params.minSampleSize ?? null,
        maxStaleness: params.maxStaleness ?? null,
        ipfsHash: null, // Deprecated.
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

  /**
   * Fetch updates for the feed.
   *
   * @param {object} params_ - The parameters object.
   * @param {string} [params_.gateway] - Optionally specify the gateway to use. If not specified, the gateway is automatically fetched.
   * @param {number} [params_.numSignatures] - Number of signatures to fetch.
   * @param {FeedRequest} [params_.feedConfigs] - Optionally specify the feed configs. If not specified, the feed configs are automatically fetched.
   * @param {IOracleJob[]} [params_.jobs] - An array of `IOracleJob` representing the jobs to be executed.
   * @param {CrossbarClient} [params_.crossbarClient] - Optionally specify the CrossbarClient to use.
   * @param {Array<[anchor.BN, string]>} [recentSlothashes] - An optional array of recent slothashes as `[anchor.BN, string]` tuples.
   * @param {FeedEvalResponse[]} [priceSignatures] - An optional array of `FeedEvalResponse` representing the price signatures.
   * @param {boolean} [debug=false] - A boolean flag to enable or disable debug mode. Defaults to `false`.
   * @returns {Promise<[TransactionInstruction | undefined, OracleResponse[], number, any[]]>} A promise that resolves to a tuple containing:
   * - The transaction instruction to fetch updates, or `undefined` if not applicable.
   * - An array of `OracleResponse` objects.
   * - A number representing the successful responses.
   * - An array containing usable lookup tables.
   */
  async fetchUpdateIx(
    params_?: {
      // Optionally specify the gateway to use. Else, the gateway is automatically fetched.
      gateway?: string;
      // Number of signatures to fetch.
      numSignatures?: number;
      jobs?: IOracleJob[];
      crossbarClient?: CrossbarClient;
      retries?: number;
      chain?: string;
      network?: "mainnet" | "mainnet-beta" | "testnet" | "devnet";
      solanaRpcUrl?: string;
    },
    recentSlothashes?: Array<[anchor.BN, string]>,
    priceSignatures?: FeedEvalResponse[],
    debug: boolean = false,
    payer?: PublicKey
  ): Promise<
    [
      TransactionInstruction | undefined,
      OracleResponse[],
      number,
      AddressLookupTableAccount[],
      string[]
    ]
  > {
    const payerPublicKey = this.getPayer(payer);
    if (this.configs === null) {
      this.configs = await this.loadConfigs();
    }

    params_ = params_ ?? {};
    params_.retries = params_.retries ?? 3;
    const feedConfigs = this.configs;
    const numSignatures =
      params_?.numSignatures ??
      feedConfigs.minSampleSize + Math.ceil(feedConfigs.minSampleSize / 3);
    const isSolana =
      params_?.chain === undefined || params_?.chain === "solana";
    const isMainnet =
      params_?.network === "mainnet" || params_?.network === "mainnet-beta";

    let queueAccount = new Queue(this.program, feedConfigs.queue);

    if (!isSolana) {
      // TODO: cache this
      queueAccount = isMainnet
        ? await getDefaultQueue(params_?.solanaRpcUrl)
        : await getDefaultDevnetQueue(params_?.solanaRpcUrl);
    }

    if (this.gatewayUrl === "") {
      this.gatewayUrl =
        params_?.gateway ??
        (await queueAccount.fetchAllGateways())[0].gatewayUrl;
    }
    let jobs = params_?.jobs ?? this.jobs;
    if (!jobs?.length) {
      const data = await this.loadData();
      jobs = await (params_?.crossbarClient ?? CrossbarClient.default())
        .fetch(Buffer.from(data.feedHash).toString("hex"))
        .then((resp) => {
          return resp.jobs;
        });
      this.jobs = jobs;
    }
    const params = {
      feed: this.pubkey,
      gateway: this.gatewayUrl,
      ...feedConfigs,
      ...params_,
      numSignatures,
      jobs: jobs,
    };
    let err = null;
    for (let i = 0; i < params.retries; i++) {
      try {
        const ix = await PullFeed.fetchUpdateIx(
          this.program,
          params,
          recentSlothashes,
          priceSignatures,
          debug,
          payerPublicKey
        );
        return ix;
      } catch (err_: any) {
        err = err_;
      }
    }
    throw err;
  }

  /**
   * Loads the feed configurations for this {@linkcode PullFeed} account from on chain.
   * @returns A promise that resolves to the feed configurations.
   * @throws if the feed account does not exist.
   */
  async loadConfigs(): Promise<{
    queue: PublicKey;
    maxVariance: number;
    minResponses: number;
    feedHash: Buffer;
    minSampleSize: number;
  }> {
    const data = await this.loadData();
    const maxVariance = data.maxVariance.toNumber() / 1e9;
    return {
      queue: data.queue,
      maxVariance: maxVariance,
      minResponses: data.minResponses,
      feedHash: Buffer.from(data.feedHash),
      minSampleSize: data.minSampleSize,
    };
  }

  /**
   * Fetch updates for the feed.
   *
   * @param params_ - The parameters object.
   * @param params_.gateway - Optionally specify the gateway to use. If not specified, the gateway is automatically fetched.
   * @param params._chain - Optionally specify the chain to use. If not specified, Solana is used.
   * @param params_.numSignatures - Number of signatures to fetch.
   * @param params_.feedConfigs - Optionally specify the feed configs. If not specified, the feed configs are automatically fetched.
   * @param params_.jobs - An array of `IOracleJob` representing the jobs to be executed.
   * @param params_.crossbarClient - Optionally specify the CrossbarClient to use.
   * @param recentSlothashes - An optional array of recent slothashes as `[anchor.BN, string]` tuples.
   * @param priceSignatures - An optional array of `FeedEvalResponse` representing the price signatures.
   * @param debug - A boolean flag to enable or disable debug mode. Defaults to `false`.
   * @param payer - Optionally specify the payer public key.
   * @returns A promise that resolves to a tuple containing:
   * - The transaction instruction to fetch updates, or `undefined` if not applicable.
   * - An array of `OracleResponse` objects.
   * - A number representing the successful responses.
   * - An array containing usable lookup tables.
   */
  static async fetchUpdateIx(
    program: Program,
    params_: {
      gateway?: string;
      chain?: string;
      network?: "mainnet" | "mainnet-beta" | "testnet" | "devnet";
      solanaRpcUrl?: string;
      queue: PublicKey;
      feed: PublicKey;
      numSignatures: number;
      maxVariance: number;
      minResponses: number;
      jobs: IOracleJob[];
      crossbarClient?: CrossbarClient;
    },
    recentSlothashes?: Array<[anchor.BN, string]>,
    priceSignatures?: FeedEvalResponse[],
    debug: boolean = false,
    payer?: PublicKey
  ): Promise<
    [
      TransactionInstruction | undefined,
      OracleResponse[],
      number,
      AddressLookupTableAccount[],
      string[]
    ]
  > {
    let slotHashes = recentSlothashes;
    if (slotHashes === undefined) {
      slotHashes = await RecentSlotHashes.fetchLatestNSlothashes(
        program.provider.connection,
        30
      );
    }
    const feed = new PullFeed(program, params_.feed);
    const params = params_;
    const jobs = params.jobs;
    const isSolana = params.chain === undefined || params.chain === "solana";
    const isMainnet =
      params.network === "mainnet" || params.network === "mainnet-beta";
    let queue = params.queue;

    let failures_: string[] = [];
    if (priceSignatures === undefined || priceSignatures === null) {
      let solanaProgram = program;

      // get the queue
      if (!isSolana) {
        // TODO: cache this
        const defaultQueue = isMainnet
          ? await getDefaultQueue(params.solanaRpcUrl)
          : await getDefaultDevnetQueue(params.solanaRpcUrl);

        queue = defaultQueue.pubkey;
        solanaProgram = defaultQueue.program;
      }

      const { responses, failures } = await Queue.fetchSignatures(
        solanaProgram,
        {
          ...params,
          queue,
          jobs: jobs!.map((x) => OracleJob.fromObject(x)),
          recentHash: slotHashes[0][1],
        }
      );
      priceSignatures = responses;
      failures_ = failures;
    }

    let numSuccesses = 0;
    if (!priceSignatures) {
      return [undefined, [], 0, [], []];
    }
    const oracleResponses = priceSignatures.map((x) => {
      const oldDP = Big.DP;
      Big.DP = 40;
      const value = x.success_value ? new Big(x.success_value).div(1e18) : null;
      if (value !== null) {
        numSuccesses += 1;
      }
      Big.DP = oldDP;
      let oracle = new PublicKey(Buffer.from(x.oracle_pubkey, "hex"));
      if (!isSolana) {
        [oracle] = PublicKey.findProgramAddressSync(
          [Buffer.from("Oracle"), params.queue.toBuffer(), oracle.toBuffer()],
          program.programId
        );
      }
      return new OracleResponse(
        new Oracle(program, oracle),
        value,
        x.failure_error
      );
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
      submitSignaturesIx = feed.getSolanaSubmitSignaturesIx({
        resps: priceSignatures,
        offsets: offsets,
        slot: slotHashes[0][0],
        payer,
        chain: params.chain,
      });
    }

    const lutOwners = [...oracleResponses.map((x) => x.oracle), feed];
    const luts = await loadLookupTables(lutOwners);
    if (!numSuccesses) {
      throw new Error(
        `PullFeed.fetchUpdateIx Failure: ${oracleResponses.map((x) => x.error)}`
      );
    }
    return [submitSignaturesIx, oracleResponses, numSuccesses, luts, failures_];
  }

  /**
   * Fetches updates for multiple feeds at once into SEPARATE intructions (one for each)
   *
   * @param program - The Anchor program instance.
   * @param params_ - The parameters object.
   * @param params_.gateway - The gateway URL to use. If not provided, the gateway is automatically fetched.
   * @param params_.feeds - An array of feed account public keys.
   * @param params_.numSignatures - The number of signatures to fetch.
   * @param params_.crossbarClient - Optionally specify the CrossbarClient to use.
   * @param recentSlothashes - An optional array of recent slothashes as `[anchor.BN, string]` tuples.
   * @param debug - A boolean flag to enable or disable debug mode. Defaults to `false`.
   * @param payer - Optionally specify the payer public key.
   * @returns A promise that resolves to a tuple containing:
   * - The transaction instruction for fetching updates.
   * - An array of `AddressLookupTableAccount` to use.
   * - The raw response data.
   */
  static async fetchUpdateManyIxs(
    program: Program,
    params_: {
      gateway?: string;
      feeds: PublicKey[];
      numSignatures: number;
      crossbarClient?: CrossbarClient;
      payer?: PublicKey;
    },
    recentSlothashes?: Array<[anchor.BN, string]>,
    debug: boolean = false,
    payer?: PublicKey
  ): Promise<{
    successes: {
      submitSignaturesIx: TransactionInstruction;
      oracleResponses: {
        value: Big.Big;
        error: string;
        oracle: Oracle;
      };
      numSuccesses: number;
      luts: AddressLookupTableAccount[];
      failures: string[];
    }[];
    failures: {
      feed: PublicKey;
      error: string;
    }[];
  }> {
    const slotHashes =
      recentSlothashes ??
      (await RecentSlotHashes.fetchLatestNSlothashes(
        program.provider.connection,
        30
      ));
    const feeds = params_.feeds.map((feed) => new PullFeed(program, feed));
    const params = params_;
    const feedConfigs: {
      maxVariance: number;
      minResponses: number;
      jobs: any;
    }[] = [];
    let queue: PublicKey | undefined = undefined;

    // Map from feed hash to feed - this will help in mapping the responses to the feeds
    const feedToFeedHash = new Map<string, string>();

    // Map from feed hash to responses
    const feedHashToResponses = new Map<string, FeedEvalResponse[]>();

    // Iterate over all feeds to fetch the feed configs
    for (const feed of feeds) {
      // Load the feed from Solana
      const data = await feed.loadData();
      if (queue !== undefined && !queue.equals(data.queue)) {
        throw new Error(
          "fetchUpdateManyIx: All feeds must have the same queue"
        );
      }
      queue = data.queue;
      const maxVariance = data.maxVariance.toNumber() / 1e9;
      const minResponses = data.minResponses;
      const feedHash = Buffer.from(data.feedHash).toString("hex");

      // Store the feed in a map for later use
      feedToFeedHash.set(feed.pubkey.toString(), feedHash);

      // Add an entry for the feed in the response map
      feedHashToResponses.set(feedHash, []);

      // Pull the job definitions
      const jobs = await (params_.crossbarClient ?? CrossbarClient.default())
        .fetch(feedHash)
        .then((resp) => {
          return resp.jobs;
        });

      // Collect the feed config
      feedConfigs.push({
        maxVariance,
        minResponses,
        jobs,
      });
    }

    // Fetch the responses from the oracle(s)
    const response = await Queue.fetchSignaturesBatch(program, {
      ...params,
      recentHash: slotHashes[0][1],
      feedConfigs,
      queue: queue!,
    });

    const oracles: PublicKey[] = [];

    // Assemble the responses
    for (const oracleResponse of response.oracle_responses) {
      // Get the oracle public key
      const oraclePubkey = new PublicKey(
        Buffer.from(oracleResponse.feed_responses[0].oracle_pubkey, "hex")
      );

      // Add it to the list of oracles
      oracles.push(oraclePubkey);

      // Map the responses to the feed
      for (const feedResponse of oracleResponse.feed_responses) {
        const feedHash = feedResponse.feed_hash;
        feedHashToResponses.get(feedHash)?.push(feedResponse);
      }
    }

    // loop over the feeds and create the instructions
    const successes = [];
    const failures = [];

    for (const feed of feeds) {
      const feedHash = feedToFeedHash.get(feed.pubkey.toString());

      // Get registered responses for this feed
      const responses = feedHashToResponses.get(feedHash) ?? [];

      // If there are no responses for this feed, skip
      if (responses.length === 0) {
        failures.push({
          feed: feed.pubkey,
          error: `No responses found for feed hash: ${feedHash}. Skipping.`,
        });
        continue;
      }

      const oracleResponses = responses.map((x) => {
        const oldDP = Big.DP;
        Big.DP = 40;
        const value = x.success_value
          ? new Big(x.success_value).div(1e18)
          : null;
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

      // offsets currently deprecated
      const offsets: number[] = Array(responses.length).fill(0);

      if (debug) {
        console.log("priceSignatures", responses);
      }

      let submitSignaturesIx: TransactionInstruction | undefined = undefined;
      let numSuccesses = 0;
      if (responses.length > 0) {
        const validResponses = responses.filter(
          (x) => (x.signature ?? "").length > 0
        );
        numSuccesses = validResponses.length;
        if (numSuccesses > 0) {
          submitSignaturesIx = feed.getSolanaSubmitSignaturesIx({
            resps: validResponses,
            offsets: offsets,
            slot: slotHashes[0][0],
            payer: params.payer ?? program.provider.publicKey,
          });
        }
      }

      // Bounce if there are no successes
      if (!numSuccesses) {
        const failure = {
          feed: feed.pubkey,
          error: `PullFeed.fetchUpdateIx Failure: ${oracleResponses.map(
            (x) => x.error
          )}`,
        };
        failures.push(failure);
        continue;
      }

      // Get lookup tables for the oracles
      const lutOwners = [...oracleResponses.map((x) => x.oracle), feed];
      const luts = await loadLookupTables(lutOwners);

      // Add the result to the successes array
      successes.push({
        feed: feed.pubkey,
        submitSignaturesIx,
        oracleResponses,
        numSuccesses,
        luts,
        failures: responses.map((x) => x.failure_error),
      });
    }

    return {
      successes,
      failures,
    };
  }

  /**
   * Prefetch all lookup tables needed for the feed and queue.
   * @returns A promise that resolves to an array of lookup tables.
   * @throws if the lookup tables cannot be loaded.
   */
  async preHeatLuts(): Promise<AddressLookupTableAccount[]> {
    const data = await this.loadData();
    const queue = new Queue(this.program, data.queue);
    const oracleKeys = await queue.fetchOracleKeys();
    const oracles = oracleKeys.map((k) => new Oracle(this.program, k));
    const lutOwners = [...oracles, queue, this];
    const luts = await loadLookupTables(lutOwners);
    return luts;
  }

  /**
   * Fetches updates for multiple feeds at once into a SINGLE tightly packed intruction
   *
   * @param program - The Anchor program instance.
   * @param params_ - The parameters object.
   * @param params_.gateway - The gateway URL to use. If not provided, the gateway is automatically fetched.
   * @param params_.feeds - An array of feed account public keys.
   * @param params_.numSignatures - The number of signatures to fetch.
   * @param params_.crossbarClient - Optionally specify the CrossbarClient to use.
   * @param recentSlothashes - An optional array of recent slothashes as `[anchor.BN, string]` tuples.
   * @param debug - A boolean flag to enable or disable debug mode. Defaults to `false`.
   * @returns A promise that resolves to a tuple containing:
   * - The transaction instruction for fetching updates.
   * - An array of `AddressLookupTableAccount` to use.
   * - The raw response data.
   */
  static async fetchUpdateManyIx(
    program: Program,
    params_: {
      gateway?: string;
      feeds: PublicKey[];
      numSignatures: number;
      crossbarClient?: CrossbarClient;
      payer?: PublicKey;
    },
    recentSlothashes?: Array<[anchor.BN, string]>,
    debug: boolean = false
  ): Promise<
    [
      TransactionInstruction,
      AddressLookupTableAccount[],
      FetchSignaturesMultiResponse
    ]
  > {
    const slotHashes =
      recentSlothashes ??
      (await RecentSlotHashes.fetchLatestNSlothashes(
        program.provider.connection,
        30
      ));
    const feeds = params_.feeds.map((feed) => new PullFeed(program, feed));
    const params = params_;
    const feedConfigs: {
      maxVariance: number;
      minResponses: number;
      jobs: any;
    }[] = [];
    let queue: PublicKey | undefined = undefined;
    for (const feed of feeds) {
      const data = await feed.loadData();
      if (queue !== undefined && !queue.equals(data.queue)) {
        throw new Error(
          "fetchUpdateManyIx: All feeds must have the same queue"
        );
      }
      queue = data.queue;
      const maxVariance = data.maxVariance.toNumber() / 1e9;
      const minResponses = data.minResponses;
      const jobs = await (params_.crossbarClient ?? CrossbarClient.default())
        .fetch(Buffer.from(data.feedHash).toString("hex"))
        .then((resp) => resp.jobs);
      feedConfigs.push({
        maxVariance,
        minResponses,
        jobs,
      });
    }
    const response = await Queue.fetchSignaturesMulti(program, {
      ...params,
      recentHash: slotHashes[0][1],
      feedConfigs,
      queue: queue!,
    });
    const oracles: PublicKey[] = [];
    const submissions: any[] = [];
    const maxI128 = new BN(2).pow(new BN(127)).sub(new BN(1));
    for (let i = 0; i < response.oracle_responses.length; i++) {
      oracles.push(
        new PublicKey(
          Buffer.from(
            response.oracle_responses[i].feed_responses[0].oracle_pubkey,
            "hex"
          )
        )
      );
      const oracleResponse = response.oracle_responses[i];
      const feedResponses = oracleResponse.feed_responses;
      const multisSubmission = {
        values: feedResponses.map((x: any) => {
          if ((x.success_value ?? "") === "") {
            return maxI128;
          }
          return new anchor.BN(x.success_value);
        }),
        signature: Buffer.from(oracleResponse.signature, "base64"),
        recoveryId: oracleResponse.recovery_id,
      };
      submissions.push(multisSubmission);
    }

    const payerPublicKey =
      params.payer ?? program.provider.publicKey ?? PublicKey.default;
    const oracleFeedStats = oracles.map(
      (oracle) =>
        PublicKey.findProgramAddressSync(
          [Buffer.from("OracleStats"), oracle.toBuffer()],
          program.programId
        )[0]
    );
    const instructionData = {
      slot: new anchor.BN(slotHashes[0][0]),
      submissions,
    };

    const accounts = {
      queue: queue!,
      programState: State.keyFromSeed(program),
      recentSlothashes: SLOT_HASHES_SYSVAR_ID,
      payer: payerPublicKey,
      systemProgram: SystemProgram.programId,
      rewardVault: spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, queue!),
      tokenProgram: spl.TOKEN_PROGRAM_ID,
      tokenMint: spl.NATIVE_MINT,
    };
    const remainingAccounts: AccountMeta[] = [
      ...feeds.map((k) => ({
        pubkey: k.pubkey,
        isSigner: false,
        isWritable: true,
      })),
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
    const lutLoaders: any[] = [];
    for (const feed of feeds) {
      lutLoaders.push(feed.loadLookupTable());
    }
    for (const oracleKey of oracles) {
      const oracle = new Oracle(program, oracleKey);
      lutLoaders.push(oracle.loadLookupTable());
    }
    const luts = await Promise.all(lutLoaders);
    const ix = program.instruction.pullFeedSubmitResponseMany(instructionData, {
      accounts,
      remainingAccounts,
    });
    return [ix, luts, response];
  }

  /**
   *  Compiles a transaction instruction to submit oracle signatures for a given feed.
   *
   *  @param resps The oracle responses. This may be obtained from the `Gateway` class.
   *  @param slot The slot at which the oracles signed the feed with the current slothash.
   *  @returns A promise that resolves to the transaction instruction.
   */
  getSolanaSubmitSignaturesIx(params: {
    resps: FeedEvalResponse[];
    offsets: number[];
    slot: anchor.BN;
    payer?: PublicKey;
    chain?: string;
  }): TransactionInstruction {
    const program = this.program;
    const payerPublicKey =
      params.payer ?? program.provider.publicKey ?? PublicKey.default;
    const resps = params.resps.filter((x) => (x.signature ?? "").length > 0);
    const isSolana = params.chain === "solana" || params.chain === undefined;

    let queue = new PublicKey(
      Buffer.from(resps[0].queue_pubkey.toString(), "hex")
    );
    const sourceQueueKey = new PublicKey(
      Buffer.from(resps[0].queue_pubkey.toString(), "hex")
    );
    let queueBump = 0;

    if (!isSolana) {
      [queue, queueBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("Queue"), queue.toBuffer()],
        program.programId
      );
    }

    const oracles = resps.map((x) => {
      const sourceOracleKey = new PublicKey(
        Buffer.from(x.oracle_pubkey.toString(), "hex")
      );
      if (isSolana) {
        return sourceOracleKey;
      } else {
        const [oraclePDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("Oracle"), queue.toBuffer(), sourceOracleKey.toBuffer()],
          program.programId
        );
        return oraclePDA;
      }
    });

    const oracleFeedStats = oracles.map(
      (oracle) =>
        PublicKey.findProgramAddressSync(
          [Buffer.from("OracleStats"), oracle.toBuffer()],
          program.programId
        )[0]
    );

    const submissions = resps.map((resp, idx) => ({
      value: new anchor.BN(resp.success_value.toString()),
      signature: resp.signature,
      recoveryId: resp.recovery_id,

      // offsets aren't used in the non-solana endpoint
      slotOffset: isSolana ? params.offsets[idx] : undefined,
    }));

    const instructionData = {
      slot: new anchor.BN(params.slot),
      submissions: submissions.map((x: any) => {
        x.signature = Buffer.from(x.signature, "base64");
        return x;
      }),
      sourceQueueKey: isSolana ? undefined : sourceQueueKey,
      queueBump: isSolana ? undefined : queueBump,
    };

    const accounts = {
      feed: this.pubkey,
      queue: queue,
      programState: State.keyFromSeed(program),
      recentSlothashes: SLOT_HASHES_SYSVAR_ID,
      payer: payerPublicKey,
      systemProgram: SystemProgram.programId,
      rewardVault: spl.getAssociatedTokenAddressSync(
        spl.NATIVE_MINT,
        queue,
        !isSolana
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

    if (isSolana) {
      return program.instruction.pullFeedSubmitResponse(instructionData, {
        accounts,
        remainingAccounts,
      });
    } else {
      return program.instruction.pullFeedSubmitResponseSvm(instructionData, {
        accounts,
        remainingAccounts,
      });
    }
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
  async loadData(): Promise<PullFeedAccountData> {
    return await this.program.account["pullFeedAccountData"].fetch(this.pubkey);
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
          slot: new BN(x.slot.toString()),
          oracle: new PublicKey(x.oracle),
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
        const feed = coder.decode("pullFeedAccountData", accountInfo.data);
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
          const feed = coder.decode("pullFeedAccountData", accountInfo.data);
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

  public lookupTableKey(data: any): PublicKey {
    const lutSigner = PublicKey.findProgramAddressSync(
      [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
      this.program.programId
    )[0];

    const [_, lutKey] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: PublicKey.default,
      recentSlot: data.lutSlot,
    });
    return lutKey;
  }

  async loadLookupTable(): Promise<AddressLookupTableAccount> {
    if (this.lut !== null && this.lut !== undefined) {
      return this.lut;
    }
    const data = await this.loadData();
    const lutKey = this.lookupTableKey(data);
    const accnt = await this.program.provider.connection.getAddressLookupTable(
      lutKey
    );
    this.lut = accnt.value!;
    return this.lut!;
  }

  async loadHistoricalValuesCompact(
    data_?: PullFeedAccountData
  ): Promise<CompactResult[]> {
    const data = data_ ?? (await this.loadData());
    const values = data.historicalResults
      .filter((x) => x.slot.gt(new BN(0)))
      .sort((a, b) => a.slot.cmp(b.slot));
    return values;
  }
}
