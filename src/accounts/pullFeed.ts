import { AnchorUtils } from '../anchor-utils/AnchorUtils.js';
import {
  SOL_NATIVE_MINT,
  SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
  SPL_SYSVAR_INSTRUCTIONS_ID,
  SPL_SYSVAR_SLOT_HASHES_ID,
  SPL_TOKEN_PROGRAM_ID,
} from '../constants.js';
import { InstructionUtils } from '../instruction-utils/InstructionUtils.js';
import {
  Secp256k1InstructionUtils,
  type Secp256k1Signature,
} from '../instruction-utils/Secp256k1InstructionUtils.js';
import type {
  FeedEvalResponse,
  FeedRequest,
  FetchSignaturesConsensusResponse,
  FetchSignaturesMultiResponse,
} from '../oracle-interfaces/gateway.js';
import { RecentSlotHashes } from '../sysvars/recentSlothashes.js';
import * as spl from '../utils/index.js';
import { loadLookupTables } from '../utils/index.js';
import { getLutKey, getLutSigner } from '../utils/lookupTable.js';

import { Oracle } from './oracle.js';
import { Queue } from './queue.js';
import { State } from './state.js';

import type { Program } from '@coral-xyz/anchor-31';
import * as anchor from '@coral-xyz/anchor-31';
import { BN, BorshAccountsCoder, web3 } from '@coral-xyz/anchor-31';
import type { IOracleJob } from '@switchboard-xyz/common';
import {
  Big,
  CrossbarClient,
  FeedHash,
  NonEmptyArrayUtils,
} from '@switchboard-xyz/common';
import { Buffer } from 'buffer';

const {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY: SLOT_HASHES_SYSVAR_ID,
} = web3;
type PublicKey = web3.PublicKey;
type TransactionInstruction = web3.TransactionInstruction;
type AddressLookupTableAccount = web3.AddressLookupTableAccount;
type AccountMeta = web3.AccountMeta;

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
  oracle: web3.PublicKey;
  slot: BN;
  value: BN;
}

export interface PullFeedAccountData {
  submissions: OracleSubmission[];
  authority: web3.PublicKey;
  queue: web3.PublicKey;
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
  values: BN[];
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
    if (this.error === '[]') {
      return undefined;
    }
    const parts = this.error.split('\n');
    return parts[0];
  }
}

function padStringWithNullBytes(
  input: string,
  desiredLength: number = 32
): string {
  const nullByte = '\0';
  while (input.length < desiredLength) {
    input += nullByte;
  }
  return input;
}

export type FeedSubmission = { value: Big; slot: BN; oracle: web3.PublicKey };

export function toFeedValue(
  submissions: FeedSubmission[],
  onlyAfter: BN
): FeedSubmission | null {
  let values = submissions.filter(x => x.slot.gt(onlyAfter));
  if (values.length === 0) {
    return null;
  }
  values = values.sort((x, y) => (x.value.lt(y.value) ? -1 : 1));
  return values[Math.floor(values.length / 2)];
}

function getIsSolana(chain?: string) {
  return chain === undefined || chain === 'solana';
}

function getIsMainnet(network?: string) {
  return network === 'mainnet' || network === 'mainnet-beta';
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
  connection: web3.Connection,
  programId: web3.PublicKey,
  pubkey: web3.PublicKey
): Promise<boolean> {
  const accountInfo = await connection.getAccountInfo(pubkey);
  if (accountInfo === null) return true;

  const owner = accountInfo.owner;
  if (!owner.equals(programId)) return true;

  return false;
}

/**
 * PullFeed account management for persistent price feeds
 *
 * The PullFeed class manages on-chain feed accounts that store price
 * history and configuration. While the quote approach is more efficient
 * for most use cases, feeds are useful when you need:
 *
 * - Persistent price history on-chain
 * - Standardized addresses for multiple consumers
 * - Price archives and analytics
 * - Compatibility with programs expecting traditional feeds
 *
 * ## Key Features
 *
 * - **Price History**: Stores historical price data on-chain
 * - **Job Management**: Configure data sources via IPFS-stored jobs
 * - **Update Control**: Fine-grained control over update parameters
 * - **LUT Integration**: Automatic lookup table management
 *
 * @example
 * ```typescript
 * // Create a new feed
 * const [pullFeed, feedKp] = PullFeed.generate(program);
 * await pullFeed.initIx({
 *   name: "BTC/USD",
 *   queue: queuePubkey,
 *   maxVariance: 1.0,
 *   minResponses: 3,
 *   feedHash: jobHash,
 * });
 *
 * // Update the feed
 * const [updateIx, responses] = await pullFeed.fetchUpdateIx();
 * ```
 *
 * @class PullFeed
 */
export class PullFeed {
  gatewayUrl: string;
  pubkey: web3.PublicKey;
  configs: {
    queue: web3.PublicKey;
    maxVariance: number;
    minResponses: number;
    feedHash: Buffer;
    minSampleSize: number;
  } | null;
  data: PullFeedAccountData | null;
  jobs: IOracleJob[] | null;
  lut: web3.AddressLookupTableAccount | null;

  /**
   * Constructs a `PullFeed` instance.
   *
   * @param program - The Anchor program instance.
   * @param pubkey - The public key of the pull feed account.
   */
  constructor(
    readonly program: Program,
    pubkey: web3.PublicKey | string
  ) {
    this.gatewayUrl = '';
    this.pubkey = new web3.PublicKey(pubkey);
    this.configs = null;
    this.jobs = null;
  }

  static generate(program: Program): [PullFeed, web3.Keypair] {
    const keypair = web3.Keypair.generate();
    const feed = new PullFeed(program, keypair.publicKey);
    return [feed, keypair];
  }

  async lookupTableKey(data?: PullFeedAccountData): Promise<web3.PublicKey> {
    const lutSigner = getLutSigner(this.program.programId, this.pubkey);
    const { lutSlot } = data ?? (await this.loadData());
    return getLutKey(lutSigner, lutSlot);
  }

  /**
   * Prefetch all lookup tables needed for the feed and queue.
   * @returns A promise that resolves to an array of lookup tables.
   * @throws if the lookup tables cannot be loaded.
   */
  async preHeatLuts(): Promise<web3.AddressLookupTableAccount[]> {
    const data = await this.loadData();
    const queue = new Queue(this.program, data.queue);
    const oracleKeys = await queue.fetchOracleKeys();
    const oracles = oracleKeys.map(k => new Oracle(this.program, k));
    const lutOwners = [...oracles, queue, this];
    const luts = await loadLookupTables(lutOwners);
    return luts;
  }

  static async initTx(
    program: Program,
    params: {
      name: string;
      queue: web3.PublicKey;
      maxVariance: number;
      minResponses: number;
      minSampleSize: number;
      maxStaleness: number;
      permitWriteByAuthority?: boolean;
      payer?: web3.PublicKey;
    } & ({ feedHash: Buffer } | { jobs: IOracleJob[] })
  ): Promise<[PullFeed, web3.VersionedTransaction]> {
    const [pullFeed, keypair] = PullFeed.generate(program);
    const ix = await pullFeed.initIx(params);
    const tx = await InstructionUtils.asV0TxWithComputeIxs({
      connection: program.provider.connection,
      ixs: [ix],
    });
    tx.sign([keypair]);
    return [pullFeed, tx];
  }

  private static getPayer(
    program: Program,
    payer?: web3.PublicKey
  ): web3.PublicKey {
    return payer ?? program.provider.publicKey ?? web3.PublicKey.default;
  }

  private getPayer(payer?: web3.PublicKey): web3.PublicKey {
    return PullFeed.getPayer(this.program, payer);
  }

  /**
   *  Calls to initialize a pull feed account and to update the configuration account need to
   *  compute the feed hash for the account (if one is not specified).
   */
  private static feedHashFromParams(params: {
    queue: web3.PublicKey;
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
    throw new Error('Feed hash must be 32 bytes');
  }

  async fetchQueue(): Promise<Queue> {
    const data = await this.loadData();
    return new Queue(this.program, data.queue);
  }

  async fetchGatewayUrl(crossbarClient_?: CrossbarClient): Promise<string> {
    const crossbarClient = crossbarClient_ ?? CrossbarClient.default();

    // Start parallel tasks
    const loadConfigsPromise = this.loadConfigs();
    const preHeatPromise = this.preHeatLuts();
    const fetchQueuePromise = this.fetchQueue();

    // Wait for all in parallel
    await Promise.all([loadConfigsPromise, preHeatPromise, fetchQueuePromise]);
    const queue = await fetchQueuePromise;

    // Fetch gateway and load jobs in parallel
    const [gw] = await Promise.all([
      queue.fetchGateway(),
      this.loadJobs(crossbarClient),
    ]);

    return gw.gatewayUrl;
  }

  async preHeatFeed(crossbarClient: CrossbarClient = CrossbarClient.default()) {
    const loadConfigsPromise = this.loadConfigs();
    const preHeatPromise = this.preHeatLuts();
    const fetchQueuePromise = this.fetchQueue();

    // Wait for all in parallel
    await Promise.all([loadConfigsPromise, preHeatPromise, fetchQueuePromise]);

    // Fetch gateway and load jobs in parallel
    await this.loadJobs(crossbarClient);
  }

  async loadJobs(
    crossbarClient: CrossbarClient = CrossbarClient.default()
  ): Promise<IOracleJob[]> {
    if (this.jobs) {
      return this.jobs!;
    }
    const configs = await this.loadConfigs();
    const feedHash = Buffer.from(configs.feedHash);
    this.jobs = await crossbarClient
      .fetch(feedHash.toString('hex'))
      .then(resp => resp.jobs);
    return this.jobs!;
  }

  /**
   * Initializes a pull feed account.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {PublicKey} queue - The queue account public key.
   * @param {Array<IOracleJob>} jobs - The oracle jobs to execute.
   * @param {number} maxVariance - The maximum variance allowed for the feed.
   * @param {number} minResponses - The minimum number of job responses required.
   * @param {number} minSampleSize - The minimum number of samples required for setting feed value.
   * @param {number} maxStaleness - The maximum number of slots that can pass before a feed value is considered stale.
   * @returns {Promise<web3.TransactionInstruction>} A promise that resolves to the transaction instruction.
   */
  async initIx(
    params: {
      name: string;
      queue: web3.PublicKey;
      maxVariance: number;
      minResponses: number;
      payer?: web3.PublicKey;
      minSampleSize: number;
      maxStaleness: number;
      permitWriteByAuthority?: boolean;
    } & ({ feedHash: Buffer } | { jobs: IOracleJob[] })
  ): Promise<web3.TransactionInstruction> {
    const program = this.program;
    const feedHash = PullFeed.feedHashFromParams({
      queue: params.queue,
      feedHash: 'feedHash' in params ? params.feedHash : undefined,
      jobs: 'jobs' in params ? params.jobs : undefined,
    });
    const payerPublicKey = this.getPayer(params.payer);
    const maxVariance = Math.floor(params.maxVariance * 1e9);
    const lutSigner = getLutSigner(program.programId, this.pubkey);
    const recentSlot = await program.provider.connection.getSlot('finalized');
    const lutKey = getLutKey(lutSigner, recentSlot);
    const ix = program.instruction.pullFeedInit(
      {
        feedHash: feedHash,
        maxVariance: new BN(maxVariance),
        minResponses: params.minResponses,
        name: Buffer.from(padStringWithNullBytes(params.name)),
        recentSlot: new BN(recentSlot),
        ipfsHash: new Uint8Array(32), // Deprecated.
        minSampleSize: params.minSampleSize,
        maxStaleness: params.maxStaleness,
        permitWriteByAuthority: params.permitWriteByAuthority ?? null,
      },
      {
        accounts: {
          pullFeed: this.pubkey,
          queue: params.queue,
          authority: payerPublicKey,
          payer: payerPublicKey,
          systemProgram: web3.SystemProgram.programId,
          programState: State.keyFromSeed(program),
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            SOL_NATIVE_MINT,
            this.pubkey
          ),
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
          wrappedSolMint: SOL_NATIVE_MINT,
          lutSigner: lutSigner,
          lut: lutKey,
          addressLookupTableProgram: web3.AddressLookupTableProgram.programId,
        },
      }
    );
    return ix;
  }

  async closeIx(params: {
    payer?: web3.PublicKey;
  }): Promise<web3.TransactionInstruction> {
    const payerPublicKey = this.getPayer(params.payer);
    const lutSigner = getLutSigner(this.program.programId, this.pubkey);
    const data = await this.loadData();
    const lutKey = getLutKey(lutSigner, data.lutSlot);
    const ix = this.program.instruction.pullFeedClose(
      {},
      {
        accounts: {
          pullFeed: this.pubkey,
          authority: data.authority,
          payer: payerPublicKey,
          rewardEscrow: spl.getAssociatedTokenAddressSync(
            SOL_NATIVE_MINT,
            this.pubkey
          ),
          lutSigner: lutSigner,
          lut: lutKey,
          state: State.keyFromSeed(this.program),
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
          addressLookupTableProgram: web3.AddressLookupTableProgram.programId,
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
    authority?: web3.PublicKey;
    maxVariance?: number;
    minResponses?: number;
    feedHash?: Buffer;
    jobs?: IOracleJob[];
    minSampleSize?: number;
    maxStaleness?: number;
    permitWriteByAuthority?: boolean;
  }): Promise<web3.TransactionInstruction> {
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
            ? new BN(Math.floor(params.maxVariance * 1e9))
            : null,
        minResponses: params.minResponses ?? null,
        minSampleSize: params.minSampleSize ?? null,
        maxStaleness: params.maxStaleness ?? null,
        permitWriteByAuthority: params.permitWriteByAuthority ?? null,
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
   * @param {Array<[BN, string]>} [recentSlothashes] - An optional array of recent slothashes as `[BN, string]` tuples.
   * @param {FeedEvalResponse[]} [priceSignatures] - An optional array of `FeedEvalResponse` representing the price signatures.
   * @param {boolean} [debug=false] - A boolean flag to enable or disable debug mode. Defaults to `false`.
   * @returns {Promise<[TransactionInstruction | undefined, OracleResponse[], number, any[]]>} A promise that resolves to a tuple containing:
   * - The transaction instruction to fetch updates, or `undefined` if not applicable.
   * - An array of `OracleResponse` objects.
   * - A number representing the successful responses.
   * - An array containing usable lookup tables.
   */
  /**
   * Fetches update instructions for this feed
   *
   * Retrieves fresh oracle data and creates the instructions to update
   * the on-chain feed account. This method handles all the complexity
   * of oracle communication and signature verification.
   *
   * @param {Object} params - Update parameters
   * @param {string} params.gateway - Gateway URL for oracle communication
   * @param {number} params.numSignatures - Number of oracle signatures (defaults to minSampleSize + 33%)
   * @param {IOracleJob[]} params.jobs - Optional job overrides
   * @param {CrossbarClient} params.crossbarClient - Optional Crossbar client
   * @param {number} params.retries - Number of retry attempts
   * @param {string} params.chain - Chain identifier
   * @param {string} params.network - Network (mainnet/devnet)
   * @param {string} params.solanaRpcUrl - Optional RPC URL override
   * @param {Record<string, string>} params.variableOverrides - Optional variable overrides for task execution
   * @param {boolean} debug - Enable debug logging
   * @param {web3.PublicKey} payer - Optional payer override
   * @returns {Promise<[instructions, responses, success, luts, logs]>} Update transaction components
   *
   * @example
   * ```typescript
   * const [pullIx, responses, success, luts] = await pullFeed.fetchUpdateIx({
   *   gateway: 'https://gateway.switchboard.xyz',
   *   numSignatures: 3,
   * });
   *
   * if (pullIx) {
   *   const tx = await asV0Tx({
   *     connection,
   *     ixs: pullIx,
   *     signers: [payer],
   *     lookupTables: luts,
   *   });
   * }
   * ```
   */
  async fetchUpdateIx(
    params: {
      gateway: string;
      // Number of signatures to fetch.
      numSignatures?: number;
      jobs?: IOracleJob[];
      crossbarClient?: CrossbarClient;
      retries?: number;
      chain?: string;
      network?: 'mainnet' | 'mainnet-beta' | 'testnet' | 'devnet';
      solanaRpcUrl?: string;
      variableOverrides?: Record<string, string>;
    },
    debug: boolean = false,
    payer?: web3.PublicKey
  ): Promise<
    [
      web3.TransactionInstruction[] | undefined,
      OracleResponse[],
      number,
      web3.AddressLookupTableAccount[],
      string[],
    ]
  > {
    const feedConfigs = await this.loadConfigs();
    const numSignatures =
      params.numSignatures ??
      feedConfigs.minSampleSize + Math.ceil(feedConfigs.minSampleSize / 3);

    return await PullFeed.fetchUpdateIx(
      /* params= */ {
        pullFeed: this,
        gateway: params.gateway,
        chain: params.chain,
        network: params.network,
        numSignatures: numSignatures,
        crossbarClient: params.crossbarClient,
        solanaRpcUrl: params.solanaRpcUrl,
        variableOverrides: params.variableOverrides,
      },
      debug,
      payer
    );
  }
  /**
   * Loads the feed configurations (if not already cached) for this {@linkcode PullFeed} account from on chain.
   * @returns A promise that resolves to the feed configurations.
   * @throws if the feed account does not exist.
   */
  async loadConfigs(force?: boolean): Promise<{
    queue: web3.PublicKey;
    maxVariance: number;
    minResponses: number;
    feedHash: Buffer;
    minSampleSize: number;
  }> {
    // If forcing a reload or configs are not already cached, load the configs.
    if (force || !this.configs) {
      this.configs = await (async () => {
        const data = await this.loadData();
        const maxVariance = data.maxVariance.toNumber() / 1e9;
        return {
          queue: data.queue,
          maxVariance: maxVariance,
          minResponses: data.minResponses,
          feedHash: Buffer.from(data.feedHash),
          minSampleSize: data.minSampleSize,
        };
      })();
    }
    return this.configs;
  }

  /**
   * Fetches updates for a feed, returning instructions that must be executed in order at the front
   * of the transaction.
   *
   * @param program - The Anchor program instance
   * @param params - The parameters object
   * @param params.feed - PullFeed address to fetch updates for
   * @param params.gateway - gateway URL to use for fetching updates
   * @param params.chain - Optional chain identifier (defaults to "solana")
   * @param params.network - Optional network identifier ("mainnet", "mainnet-beta", "testnet", "devnet")
   * @param params.numSignatures - Number of signatures to fetch
   * @param params.crossbarClient - Optional CrossbarClient instance to use
   * @param recentSlothashes - Optional array of recent slothashes as [BN, string] tuples
   * @param debug - Enable debug logging (default: false)
   * @param payer - Optional transaction payer public key
   * @returns Promise resolving to:
   * - instructions: Array of instructions that must be executed in order:
   *   [0] = Ed25519 program verification instruction
   *   [1] = feed update instruction
   * - oracleResponses: Array of responses from oracles
   * - numSuccesses: Number of successful responses
   * - luts: Array of AddressLookupTableAccount to include
   * - failures: Array of errors that occurred during the fetch
   */
  static async fetchUpdateIx(
    params: {
      pullFeed: PullFeed;
      gateway: string;
      chain?: string;
      network?: 'mainnet' | 'mainnet-beta' | 'testnet' | 'devnet';
      numSignatures: number;
      crossbarClient?: CrossbarClient;
      solanaRpcUrl?: string;
      variableOverrides?: Record<string, string>;
    },
    debug?: boolean,
    payer?: web3.PublicKey
  ): Promise<
    [
      web3.TransactionInstruction[] | undefined,
      OracleResponse[],
      number,
      web3.AddressLookupTableAccount[],
      string[],
    ]
  > {
    const isSolana = getIsSolana(params.chain);
    const { queue } = await params.pullFeed.loadConfigs(false);

    // SVM chains that arent solana should use the older `fetchUpdateIxSvm` function
    if (!isSolana) {
      return this.fetchUpdateIxSvm(params, debug, payer);
    }

    // Fetch the update using the `fetchUpdateManyIx` function
    const [ixns, luts, report] = await PullFeed.fetchUpdateManyIx(
      params.pullFeed.program,
      {
        feeds: [params.pullFeed],
        chain: params.chain,
        network: params.network,
        gateway: params.gateway,
        numSignatures: params.numSignatures,
        crossbarClient: params.crossbarClient,
        payer: payer,
        variableOverrides: params.variableOverrides,
      },
      debug
    );

    // Generate an OracleResponse for each oracle response in the returned report.
    const oracleResponses = report.oracle_responses.map(x => {
      // Because we only requested a single feed response, we can use the first one.
      const feedResponse = x.feed_responses[0];

      // The returned oracle_pubkey is a hex string, so we need to convert it to a PublicKey.
      const oraclePubkeyBytes = Buffer.from(x.oracle_pubkey, 'hex');
      const oraclePubkey = isSolana
        ? new web3.PublicKey(oraclePubkeyBytes)
        : web3.PublicKey.findProgramAddressSync(
            [Buffer.from('Oracle'), queue.toBuffer(), oraclePubkeyBytes],
            params.pullFeed.program.programId
          )[0];

      const oracle = new Oracle(params.pullFeed.program, oraclePubkey);
      const error = feedResponse.failure_error;

      const oldDP = Big.DP;
      Big.DP = 40;
      const value = feedResponse.success_value
        ? new Big(feedResponse.success_value).div(1e18)
        : null;
      Big.DP = oldDP;

      return new OracleResponse(oracle, value, error);
    });

    // Find the number of successful responses.
    const numSuccesses = oracleResponses.filter(({ value }) => value).length;

    return [
      /* instructions= */ numSuccesses ? ixns : undefined,
      /* oracleResponses= */ oracleResponses,
      /* numSuccesses= */ numSuccesses,
      /* luts= */ luts,
      /* failures= */ oracleResponses.map(x => x.error),
    ];
  }

  static async fetchUpdateIxSvm(
    params: {
      pullFeed: PullFeed;
      gateway: string;
      chain?: string;
      network?: 'mainnet' | 'mainnet-beta' | 'testnet' | 'devnet';
      numSignatures: number;
      crossbarClient?: CrossbarClient;
      solanaRpcUrl?: string;
      recentSlothashes?: Array<[BN, string]>;
      variableOverrides?: Record<string, string>;
    },
    debug?: boolean,
    payer?: web3.PublicKey
  ): Promise<
    [
      web3.TransactionInstruction[] | undefined,
      OracleResponse[],
      number,
      web3.AddressLookupTableAccount[],
      string[],
    ]
  > {
    const isSolana = getIsSolana(params.chain);
    const isMainnet = getIsMainnet(params.network);

    // Get the feed data for this feed.
    const feed = params.pullFeed;
    const feedData = await feed.loadData();

    // If we are using Solana, we can use the queue that the feed is on. Otherwise, we need to
    // load the default queue for the specified network.
    const solanaQueuePubkey = isSolana
      ? feedData.queue
      : spl.getDefaultQueueAddress(isMainnet);
    if (debug) console.log(`Using queue ${solanaQueuePubkey.toBase58()}`);
    const connection = feed.program.provider.connection;
    const slotHashes = await RecentSlotHashes.fetchLatestNSlothashes(
      connection,
      30
    );
    const solanaProgram = isSolana
      ? // If Solana, the feed's program can be used.
        feed.program
      : // If not Solana, load a Switchboard Solana program.
        await (async () => {
          const cluster: web3.Cluster = isMainnet ? 'mainnet-beta' : 'devnet';
          const rpc = params.solanaRpcUrl ?? web3.clusterApiUrl(cluster);
          const connection = new web3.Connection(rpc);
          return AnchorUtils.loadProgramFromConnection(connection);
        })();

    const crossbarClient = params.crossbarClient ?? CrossbarClient.default();
    const jobs = await params.pullFeed.loadJobs(crossbarClient);

    const { responses, failures } = await Queue.fetchSignatures(solanaProgram, {
      gateway: params.gateway,
      numSignatures: params.numSignatures,
      jobs: jobs,
      queue: solanaQueuePubkey,
      variableOverrides: params.variableOverrides,
    });

    const oracleResponses = responses.map(resp => {
      // The returned oracle_pubkey is a hex string, so we need to convert it to a PublicKey.
      const oraclePubkeyBytes = Buffer.from(resp.oracle_pubkey, 'hex');
      const oraclePubkey = isSolana
        ? new web3.PublicKey(oraclePubkeyBytes)
        : web3.PublicKey.findProgramAddressSync(
            [
              Buffer.from('Oracle'),
              feedData.queue.toBuffer(),
              oraclePubkeyBytes,
            ],
            params.pullFeed.program.programId
          )[0];

      const oracle = new Oracle(params.pullFeed.program, oraclePubkey);
      const error = resp.failure_error;

      const oldDP = Big.DP;
      Big.DP = 40;
      const value = resp.success_value
        ? new Big(resp.success_value).div(1e18)
        : null;
      Big.DP = oldDP;

      return new OracleResponse(oracle, value, error);
    });
    // Find the number of successful responses.
    const numSuccesses = oracleResponses.filter(({ value }) => value).length;
    if (!numSuccesses) {
      throw new Error(
        `PullFeed.fetchUpdateIx Failure: ${oracleResponses.map(x => x.error)}`
      );
    }

    if (debug) console.log('responses', responses);

    const submitSignaturesIx = feed.getSolanaSubmitSignaturesIx({
      resps: responses,
      // NOTE: offsets are deprecated.
      offsets: Array(responses.length).fill(0),
      slot: slotHashes[0][0],
      payer,
      chain: params.chain,
    });

    const loadLookupTables = spl.createLoadLookupTables();
    const luts = await loadLookupTables([
      feed,
      ...oracleResponses.map(({ oracle }) => oracle),
    ]);

    return [
      [submitSignaturesIx],
      oracleResponses,
      numSuccesses,
      luts,
      failures,
    ];
  }

  /**
   * Fetches updates for multiple feeds at once into a SINGLE tightly packed instruction.
   * Returns instructions that must be executed in order, with the Ed25519 verification
   * instruction placed at the front of the transaction.
   *
   * @param program - The Anchor program instance.
   * @param params_ - The parameters object.
   * @param params_.feeds - An array of PullFeed account public keys.
   * @param params_.gateway - The gateway URL to use
   * @param params_.recentSlothashes - The recent slothashes to use. If not provided, the latest 30 slothashes are fetched.
   * @param params_.numSignatures - The number of signatures to fetch.
   * @param params_.crossbarClient - Optionally specify the CrossbarClient to use.
   * @param params_.payer - The payer of the transaction. If not provided, the payer is automatically fetched.
   * @param debug - A boolean flag to enable or disable debug mode. Defaults to `false`.
   * @returns A promise that resolves to a tuple containing:
   * - An array of transaction instructions that must be executed in order:
   *   [0] = Ed25519 program verification instruction
   *   [1] = feed update instruction
   * - An array of `AddressLookupTableAccount` to use.
   * - The raw response data.
   */
  static async fetchUpdateManyIx(
    program: Program,
    params: {
      feeds: PullFeed[];
      chain?: string;
      network?: 'mainnet' | 'mainnet-beta' | 'testnet' | 'devnet';
      gateway: string;
      numSignatures: number;
      crossbarClient?: CrossbarClient;
      payer?: web3.PublicKey;
      variableOverrides?: Record<string, string>;
      signatureInstructionIdx?: number; // position of the secp256k1 instruction in the transaction
    },
    debug: boolean = false
  ): Promise<
    [
      web3.TransactionInstruction[],
      web3.AddressLookupTableAccount[],
      FetchSignaturesConsensusResponse,
    ]
  > {
    const isSolana = getIsSolana(params.chain);
    const isMainnet = getIsMainnet(params.network);

    const feeds = (() => {
      if (NonEmptyArrayUtils.safeValidate(params.feeds)) return params.feeds;
      throw new Error('Invalid `feeds` array: cannot be empty');
    })();
    const crossbarClient = params.crossbarClient ?? CrossbarClient.default();

    // Validate that (1) all of the feeds specified exist and (2) all of the feeds are on the same
    // queue. Assuming that these conditions are met, we can map the feeds' data to their configs to
    // request signatures from a gateway.
    const needFetch = feeds.some(feed => !feed.data);
    const feedDatas: (PullFeedAccountData | null)[] = needFetch
      ? await PullFeed.loadMany(program, feeds)
      : feeds.map(feed => feed.data);

    const queue: web3.PublicKey = feedDatas[0]?.queue ?? web3.PublicKey.default;
    const feedConfigs: FeedRequest[] = [];
    for (let idx = 0; idx < feedDatas.length; idx++) {
      const data = feedDatas[idx];
      if (!data) {
        const feed = feeds[idx];
        throw new Error(`No feed found at ${feed.pubkey.toBase58()}}`);
      } else if (!queue.equals(data.queue)) {
        throw new Error('All feeds must be on the same queue');
      }
      feedConfigs.push({
        maxVariance: data.maxVariance.toNumber() / 1e9,
        minResponses: data.minResponses,
        jobs: await crossbarClient
          .fetch(Buffer.from(data.feedHash).toString('hex'))
          .then(resp => resp.jobs),
      });
    }

    // If we are using Solana, we can use the queue that the feeds are on. Otherwise, we need to
    // load the default queue for the specified network.
    const solanaQueue = isSolana
      ? queue
      : spl.getDefaultQueueAddress(isMainnet);
    if (debug) console.log(`Using queue ${solanaQueue.toBase58()}`);

    const response = await Queue.fetchSignaturesConsensus(
      /* program= */ program,
      /* params= */ {
        queue: solanaQueue,
        gateway: params.gateway,
        feedConfigs,
        numSignatures: params.numSignatures,
        // useEd25519 will default to false (secp256k1) for backward compatibility
      }
    );

    // Check if we have any valid oracle responses
    if (!response.oracle_responses || response.oracle_responses.length === 0) {
      throw new Error('No oracle responses received from gateway');
    }

    // Collect error messages from any oracles that failed
    const oracleErrors: string[] = [];
    response.oracle_responses.forEach((oracleResponse, idx) => {
      if (oracleResponse.errors && oracleResponse.errors.length > 0) {
        oracleErrors.push(
          `Oracle ${idx} (${oracleResponse.oracle_pubkey}): ${oracleResponse.errors.join('; ')}`
        );
      }
    });

    const secpSignatures: Secp256k1Signature[] =
      response.oracle_responses.map<Secp256k1Signature>(
        (oracleResponse, responseIdx) => {
          return {
            ethAddress: Buffer.from(oracleResponse.eth_address, 'hex'),
            signature: Buffer.from(oracleResponse.signature, 'base64'),
            message: Buffer.from(oracleResponse.checksum, 'base64'),
            recoveryId: oracleResponse.recovery_id,
            oracleIdx: responseIdx,
          };
        }
      );

    // Check if we have any valid signatures before calling buildSecp256k1Instruction
    if (secpSignatures.length === 0) {
      const errorMessage =
        oracleErrors.length > 0
          ? `No valid oracle signatures received. Oracle errors:\n${oracleErrors.join('\n')}`
          : 'No valid oracle signatures received. All oracles failed to provide signatures.';
      throw new Error(errorMessage);
    }

    const secpInstruction = Secp256k1InstructionUtils.buildSecp256k1Instruction(
      secpSignatures,
      params.signatureInstructionIdx ?? 0
    );

    // Prepare the instruction data for the `pullFeedSubmitResponseManySecp` instruction.
    const instructionData = {
      slot: new BN(response.slot),
      values: response.median_responses.map(({ value }) => new BN(value)),
    };

    // Prepare the accounts for the `pullFeedSubmitResponseManySecp` instruction.
    const accounts = {
      queue: queue!,
      programState: State.keyFromSeed(program),
      recentSlothashes: SPL_SYSVAR_SLOT_HASHES_ID,
      payer: PullFeed.getPayer(program, params.payer),
      systemProgram: web3.SystemProgram.programId,
      rewardVault: spl.getAssociatedTokenAddressSync(
        SOL_NATIVE_MINT,
        queue,
        !isSolana // TODO: Review this.
      ),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      tokenMint: SOL_NATIVE_MINT,
      ixSysvar: SPL_SYSVAR_INSTRUCTIONS_ID,
    };

    //
    // Prepare the remaining accounts for the `pullFeedSubmitResponseManySecp` instruction.
    //

    // We only want to include feeds that have succcessful responses returned.
    const feedPubkeys = response.median_responses.map(median_response => {
      // For each successful 'median' response, locate a feed that has the same corresponding feed hash.
      const feedIndex = feedDatas.findIndex(data => {
        const feedHashHex = Buffer.from(data!.feedHash).toString('hex');
        return feedHashHex === median_response.feed_hash;
      });
      if (feedIndex >= 0) return feeds[feedIndex].pubkey;
      if (debug) {
        console.warn(`Feed not found for hash: ${median_response.feed_hash}`);
      }
      return web3.PublicKey.default;
    });
    // For each oracle response, create the oracle and oracle stats accounts.
    const oraclePubkeys = response.oracle_responses.map(response => {
      return new web3.PublicKey(Buffer.from(response.oracle_pubkey, 'hex'));
    });
    const oracleFeedStatsPubkeys = oraclePubkeys.map(
      oracle =>
        web3.PublicKey.findProgramAddressSync(
          [Buffer.from('OracleStats'), oracle.toBuffer()],
          program.programId
        )[0]
    );
    const remainingAccounts: web3.AccountMeta[] = [
      ...feedPubkeys.map(feedPubkey => ({
        pubkey: feedPubkey,
        isSigner: false,
        isWritable: true,
      })),
      ...oraclePubkeys.map(oraclePubkey => ({
        pubkey: oraclePubkey,
        isSigner: false,
        isWritable: false,
      })),
      ...oracleFeedStatsPubkeys.map(oracleFeedStatsPubkey => ({
        pubkey: oracleFeedStatsPubkey,
        isSigner: false,
        isWritable: true,
      })),
    ];

    const submitResponseIx =
      program.instruction.pullFeedSubmitResponseConsensus(instructionData, {
        accounts,
        remainingAccounts,
      });

    // Load the lookup tables for the feeds and oracles.
    const loadLookupTables = spl.createLoadLookupTables();
    const luts = await loadLookupTables([
      ...feedPubkeys.map(pubkey => new PullFeed(program, pubkey)),
      ...oraclePubkeys.map(pubkey => new Oracle(program, pubkey)),
    ]);

    return [[secpInstruction, submitResponseIx], luts, response];
  }

  static async fetchUpdateManyLightIx(
    program: Program,
    params: {
      feeds: PullFeed[];
      chain?: string;
      network?: 'mainnet' | 'mainnet-beta' | 'testnet' | 'devnet';
      gateway: string;
      recentSlothashes?: Array<[BN, string]>;
      numSignatures: number;
      crossbarClient?: CrossbarClient;
      payer?: web3.PublicKey;
      variableOverrides?: Record<string, string>;
    },
    debug: boolean = false
  ): Promise<
    [
      web3.TransactionInstruction[],
      web3.AddressLookupTableAccount[],
      FetchSignaturesConsensusResponse,
    ]
  > {
    const isSolana = getIsSolana(params.chain);
    const isMainnet = getIsMainnet(params.network);

    const feeds = (() => {
      if (NonEmptyArrayUtils.safeValidate(params.feeds)) return params.feeds;
      throw new Error('Invalid `feeds` array: cannot be empty');
    })();
    const crossbarClient = params.crossbarClient ?? CrossbarClient.default();

    // Validate that (1) all of the feeds specified exist and (2) all of the feeds are on the same
    // queue. Assuming that these conditions are met, we can map the feeds' data to their configs to
    // request signatures from a gateway.
    const feedDatas = await PullFeed.loadMany(program, params.feeds);
    const queue: web3.PublicKey = feedDatas[0]?.queue ?? web3.PublicKey.default;
    const feedConfigs: FeedRequest[] = [];
    for (let idx = 0; idx < feedDatas.length; idx++) {
      const data = feedDatas[idx];
      if (!data) {
        const feed = feeds[idx];
        throw new Error(`No feed found at ${feed.pubkey.toBase58()}}`);
      } else if (!queue.equals(data.queue)) {
        throw new Error('All feeds must be on the same queue');
      }
      feedConfigs.push({
        maxVariance: data.maxVariance.toNumber() / 1e9,
        minResponses: data.minResponses,
        jobs: await params.feeds[idx].loadJobs(crossbarClient),
      });
    }

    // If we are using Solana, we can use the queue that the feeds are on. Otherwise, we need to
    // load the default queue for the specified network.
    const solanaQueue = isSolana
      ? queue
      : spl.getDefaultQueueAddress(isMainnet);
    if (debug) console.log(`Using queue ${solanaQueue.toBase58()}`);

    const response = await Queue.fetchSignaturesConsensus(
      /* program= */ program,
      /* params= */ {
        queue: solanaQueue,
        gateway: params.gateway,
        feedConfigs,
        numSignatures: params.numSignatures,
        variableOverrides: params.variableOverrides,
        // useEd25519 will default to false (secp256k1) for backward compatibility
      }
    );

    // Check if we have any valid oracle responses
    if (!response.oracle_responses || response.oracle_responses.length === 0) {
      throw new Error('No oracle responses received from gateway');
    }

    // Collect error messages from any oracles that failed
    const oracleErrors: string[] = [];
    response.oracle_responses.forEach((oracleResponse, idx) => {
      if (oracleResponse.errors && oracleResponse.errors.length > 0) {
        oracleErrors.push(
          `Oracle ${idx} (${oracleResponse.oracle_pubkey}): ${oracleResponse.errors.join('; ')}`
        );
      }
    });

    const secpSignatures: Secp256k1Signature[] =
      response.oracle_responses.map<Secp256k1Signature>(
        (oracleResponse, responseIdx) => {
          return {
            ethAddress: Buffer.from(oracleResponse.eth_address, 'hex'),
            signature: Buffer.from(oracleResponse.signature, 'base64'),
            message: Buffer.from(oracleResponse.checksum, 'base64'),
            recoveryId: oracleResponse.recovery_id,
            oracleIdx: responseIdx,
          };
        }
      );

    // Check if we have any valid signatures before calling buildSecp256k1Instruction
    if (secpSignatures.length === 0) {
      const errorMessage =
        oracleErrors.length > 0
          ? `No valid oracle signatures received. Oracle errors:\n${oracleErrors.join('\n')}`
          : 'No valid oracle signatures received. All oracles failed to provide signatures.';
      throw new Error(errorMessage);
    }

    const secpInstruction = Secp256k1InstructionUtils.buildSecp256k1Instruction(
      secpSignatures,
      0
    );

    // Prepare the instruction data for the `pullFeedSubmitResponseManySecp` instruction.
    const instructionData = {
      slot: new BN(response.slot),
      values: response.median_responses.map(({ value }) => new BN(value)),
    };

    // Prepare the accounts for the `pullFeedSubmitResponseManySecp` instruction.
    const accounts = {
      queue: queue!,
      programState: State.keyFromSeed(program),
      recentSlothashes: SPL_SYSVAR_SLOT_HASHES_ID,
      payer: PullFeed.getPayer(program, params.payer),
      systemProgram: web3.SystemProgram.programId,
      rewardVault: spl.getAssociatedTokenAddressSync(
        SOL_NATIVE_MINT,
        queue,
        !isSolana // TODO: Review this.
      ),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      tokenMint: SOL_NATIVE_MINT,
      ixSysvar: SPL_SYSVAR_INSTRUCTIONS_ID,
    };

    //
    // Prepare the remaining accounts for the `pullFeedSubmitResponseManySecp` instruction.
    //

    // We only want to include feeds that have succcessful responses returned.
    const feedPubkeys: web3.PublicKey[] = response.median_responses.map(
      median_response => {
        // For each successful 'median' response, locate a feed that has the same corresponding feed hash.
        const feedIndex = feedDatas.findIndex(data => {
          const feedHashHex = Buffer.from(data!.feedHash).toString('hex');
          return feedHashHex === median_response.feed_hash;
        });
        if (feedIndex >= 0) return params.feeds[feedIndex].pubkey;
        if (debug) {
          console.warn(`Feed not found for hash: ${median_response.feed_hash}`);
        }
        return web3.PublicKey.default;
      }
    );
    // For each oracle response, create the oracle and oracle stats accounts.
    const oraclePubkeys = response.oracle_responses.map(response => {
      return new web3.PublicKey(Buffer.from(response.oracle_pubkey, 'hex'));
    });
    const remainingAccounts: web3.AccountMeta[] = [
      ...feedPubkeys.map(feedPubkey => ({
        pubkey: feedPubkey,
        isSigner: false,
        isWritable: true,
      })),
      ...oraclePubkeys.map(oraclePubkey => ({
        pubkey: oraclePubkey,
        isSigner: false,
        isWritable: false,
      })),
    ];

    const submitResponseIx =
      program.instruction.pullFeedSubmitResponseConsensusLight(
        instructionData,
        {
          accounts,
          remainingAccounts,
        }
      );

    // Load the lookup tables for the feeds and oracles.
    const loadLookupTables = spl.createLoadLookupTables();
    const luts = await loadLookupTables([
      ...feedPubkeys.map(pubkey => new PullFeed(program, pubkey)),
      ...oraclePubkeys.map(pubkey => new Oracle(program, pubkey)),
    ]);

    return [[secpInstruction, submitResponseIx], luts, response];
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
    slot: BN;
    payer?: web3.PublicKey;
    chain?: string;
  }): web3.TransactionInstruction {
    const program = this.program;
    const payerPublicKey = PullFeed.getPayer(program, params.payer);
    const resps = params.resps.filter(x => (x.signature ?? '').length > 0);
    const isSolana = getIsSolana(params.chain);

    let queue = new web3.PublicKey(
      Buffer.from(resps[0].queue_pubkey.toString(), 'hex')
    );
    const sourceQueueKey = new web3.PublicKey(
      Buffer.from(resps[0].queue_pubkey.toString(), 'hex')
    );
    let queueBump = 0;

    if (!isSolana) {
      [queue, queueBump] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from('Queue'), queue.toBuffer()],
        program.programId
      );
    }

    const oracles = resps.map(x => {
      const sourceOracleKey = new web3.PublicKey(
        Buffer.from(x.oracle_pubkey.toString(), 'hex')
      );
      if (isSolana) {
        return sourceOracleKey;
      } else {
        const [oraclePDA] = web3.PublicKey.findProgramAddressSync(
          [Buffer.from('Oracle'), queue.toBuffer(), sourceOracleKey.toBuffer()],
          program.programId
        );
        return oraclePDA;
      }
    });

    const oracleFeedStats = oracles.map(
      oracle =>
        web3.PublicKey.findProgramAddressSync(
          [Buffer.from('OracleStats'), oracle.toBuffer()],
          program.programId
        )[0]
    );

    const submissions = resps.map((resp, idx) => ({
      value: new BN(resp.success_value.toString()),
      signature: resp.signature,
      recoveryId: resp.recovery_id,
      // NOTE: offsets aren't used in the non-solana endpoint.
      slotOffset: isSolana ? params.offsets[idx] : undefined,
    }));

    const instructionData = {
      slot: new BN(params.slot),
      submissions: submissions.map(x => ({
        ...x,
        signature: Buffer.from(x.signature, 'base64'),
      })),
      sourceQueueKey: isSolana ? undefined : sourceQueueKey,
      queueBump: isSolana ? undefined : queueBump,
    };

    const accounts = {
      feed: this.pubkey,
      queue: queue,
      programState: State.keyFromSeed(program),
      recentSlothashes: SPL_SYSVAR_SLOT_HASHES_ID,
      payer: payerPublicKey,
      systemProgram: web3.SystemProgram.programId,
      rewardVault: spl.getAssociatedTokenAddressSync(
        SOL_NATIVE_MINT,
        queue,
        !isSolana
      ),
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      tokenMint: SOL_NATIVE_MINT,
    };

    const remainingAccounts: web3.AccountMeta[] = [
      ...oracles.map(k => ({
        pubkey: k,
        isSigner: false,
        isWritable: false,
      })),
      ...oracleFeedStats.map(k => ({
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
    if (this.data) return this.data;
    this.data = await this.program.account['pullFeedAccountData'].fetch(
      this.pubkey
    );
    return this.data!;
  }

  /**
   *  Loads the feed data for multiple feeds at once.
   *
   *  @param program The program instance.
   *  @param pubkeys The public keys of the feeds to load.
   *  @returns A promise that resolves to an array of feed data (or null if the feed account does not exist)
   */
  static async loadMany(
    program: Program,
    feeds: PullFeed[]
  ): Promise<(PullFeedAccountData | null)[]> {
    const datas = await program.account['pullFeedAccountData'].fetchMultiple(
      feeds.map(f => f.pubkey)
    );
    for (let i = 0; i < datas.length; i++) {
      feeds[i].data = datas[i];
    }
    return datas;
  }

  /**
   *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
   *
   *  @returns A promise that resolves to the values currently stored in the feed.
   *  @throws if the feed account does not exist.
   */
  async loadValues(): Promise<FeedSubmission[]> {
    const data = await this.loadData();
    return PullFeed.mapFeedSubmissions(data);
  }

  /**
   *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
   *
   *  @param onlyAfter Call will ignore data signed before this slot.
   *  @returns A promise that resolves to the observed value as it would be
   *           seen on-chain.
   */
  async loadObservedValue(onlyAfter: BN): Promise<{
    value: Big;
    slot: BN;
    oracle: web3.PublicKey;
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
  async subscribeToValueChanges(
    callback: (feed: FeedSubmission[]) => Promise<unknown>
  ): Promise<number> {
    const coder = new BorshAccountsCoder(this.program.idl);
    const subscriptionId = this.program.provider.connection.onAccountChange(
      this.pubkey,
      async accountInfo => {
        const feed = coder.decode('pullFeedAccountData', accountInfo.data);
        await callback(PullFeed.mapFeedSubmissions(feed));
      },
      { commitment: 'processed' }
    );
    return subscriptionId;
  }

  static mapFeedSubmissions(data: PullFeedAccountData): FeedSubmission[] {
    const oldDP = Big.DP;
    Big.DP = 40;
    const submissions = data.submissions
      .filter(x => !x.oracle.equals(web3.PublicKey.default))
      .map(x => ({
        value: new Big(x.value.toString()).div(1e18),
        slot: new BN(x.slot.toString()),
        oracle: new web3.PublicKey(x.oracle),
      }));
    Big.DP = oldDP;
    return submissions;
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
      event: [number, { pubkey: web3.PublicKey; submissions: FeedSubmission[] }]
    ) => Promise<void>
  ): Promise<number> {
    const coder = new BorshAccountsCoder(program.idl);
    const subscriptionId = program.provider.connection.onProgramAccountChange(
      program.programId,
      async (keyedAccountInfo, ctx) => {
        const { accountId, accountInfo } = keyedAccountInfo;
        try {
          const feed = coder.decode('pullFeedAccountData', accountInfo.data);
          await callback([
            ctx.slot,
            {
              pubkey: accountId,
              submissions: feed.submissions
                .filter(x => !x.oracle.equals(web3.PublicKey.default))
                .map(x => {
                  Big.DP = 40;
                  return {
                    value: new Big(x.value.toString()).div(1e18),
                    slot: new BN(x.slot.toString()),
                    oracle: new web3.PublicKey(x.oracle),
                  };
                }),
            },
          ]);
        } catch (e) {
          console.log(`ParseFailure: ${e}`);
        }
      },
      'processed',
      [
        {
          memcmp: {
            bytes: 'ZoV7s83c7bd',
            offset: 0,
          },
        },
      ]
    );
    return subscriptionId;
  }

  async loadLookupTable(): Promise<web3.AddressLookupTableAccount> {
    // If the lookup table is already loaded, return it
    if (this.lut) return this.lut;

    const lutKey = await this.lookupTableKey();
    const accnt =
      await this.program.provider.connection.getAddressLookupTable(lutKey);
    this.lut = accnt.value!;
    return this.lut!;
  }

  async loadHistoricalValuesCompact(
    data_?: PullFeedAccountData
  ): Promise<CompactResult[]> {
    const data = data_ ?? (await this.loadData());
    const values = data.historicalResults
      .filter(x => x.slot.gt(new BN(0)))
      .sort((a, b) => a.slot.cmp(b.slot));
    return values;
  }

  /**
   * @hidden
   *
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
  static async _obsoleteFetchUpdateManyIxs(
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
  ): Promise<{
    successes: {
      submitSignaturesIx: TransactionInstruction;
      oracleResponses: {
        value: Big.Big | null;
        error: string;
        oracle: Oracle;
      }[];
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
    const feeds = params_.feeds.map(feed => new PullFeed(program, feed));
    const params = params_;
    const feedConfigs: {
      maxVariance: number;
      minResponses: number;
      jobs: IOracleJob[];
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
          'fetchUpdateManyIx: All feeds must have the same queue'
        );
      }
      queue = data.queue;
      const maxVariance = data.maxVariance.toNumber() / 1e9;
      const minResponses = data.minResponses;
      const feedHash = Buffer.from(data.feedHash).toString('hex');

      // Store the feed in a map for later use
      feedToFeedHash.set(feed.pubkey.toString(), feedHash);

      // Add an entry for the feed in the response map
      feedHashToResponses.set(feedHash, []);

      // Pull the job definitions
      const jobs = await (params_.crossbarClient ?? CrossbarClient.default())
        .fetch(feedHash)
        .then(resp => resp.jobs);

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
        Buffer.from(oracleResponse.feed_responses[0].oracle_pubkey, 'hex')
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
    const successes: Array<{
      submitSignaturesIx: TransactionInstruction;
      oracleResponses: {
        value: Big.Big | null;
        error: string;
        oracle: Oracle;
      }[];
      numSuccesses: number;
      luts: AddressLookupTableAccount[];
      failures: string[];
    }> = [];
    const failures: Array<{
      feed: PublicKey;
      error: string;
    }> = [];

    for (const feed of feeds) {
      const feedHash = feedToFeedHash.get(feed.pubkey.toString());
      if (!feedHash) {
        failures.push({
          feed: feed.pubkey,
          error: `No feed hash found for feed: ${feed.pubkey.toString()}. Skipping.`,
        });
        continue;
      }

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

      const oracleResponses = responses.map(x => {
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
            new PublicKey(Buffer.from(x.oracle_pubkey, 'hex'))
          ),
        };
      });

      // offsets currently deprecated
      const offsets: number[] = Array(responses.length).fill(0);

      if (debug) {
        console.log('priceSignatures', responses);
      }

      let submitSignaturesIx: TransactionInstruction | undefined = undefined;
      let numSuccesses = 0;
      if (responses.length > 0) {
        const validResponses = responses.filter(
          x => (x.signature ?? '').length > 0
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
            x => x.error
          )}`,
        };
        failures.push(failure);
        continue;
      }

      // Get lookup tables for the oracles
      const lutOwners = [...oracleResponses.map(x => x.oracle), feed];
      const luts = await loadLookupTables(lutOwners);

      // Add the result to the successes array
      if (submitSignaturesIx) {
        successes.push({
          submitSignaturesIx,
          oracleResponses,
          numSuccesses,
          luts,
          failures: responses.map(x => x.failure_error),
        });
      }
    }

    return {
      successes,
      failures,
    };
  }

  /**
   * @hidden
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
  static async _obsoleteFetchUpdateManyIx(
    program: Program,
    params_: {
      gateway?: string;
      feeds: PublicKey[];
      numSignatures: number;
      crossbarClient?: CrossbarClient;
      payer?: PublicKey;
    },
    recentSlothashes?: Array<[anchor.BN, string]>
  ): Promise<
    [
      TransactionInstruction,
      AddressLookupTableAccount[],
      FetchSignaturesMultiResponse,
    ]
  > {
    const slotHashes =
      recentSlothashes ??
      (await RecentSlotHashes.fetchLatestNSlothashes(
        program.provider.connection,
        30
      ));
    const feeds = params_.feeds.map(feed => new PullFeed(program, feed));
    const params = params_;
    const feedConfigs: {
      maxVariance: number;
      minResponses: number;
      jobs: IOracleJob[];
    }[] = [];
    let queue: PublicKey | undefined = undefined;
    for (const feed of feeds) {
      const data = await feed.loadData();
      if (queue !== undefined && !queue.equals(data.queue)) {
        throw new Error(
          'fetchUpdateManyIx: All feeds must have the same queue'
        );
      }
      queue = data.queue;
      const maxVariance = data.maxVariance.toNumber() / 1e9;
      const minResponses = data.minResponses;
      const jobs = await (params_.crossbarClient ?? CrossbarClient.default())
        .fetch(Buffer.from(data.feedHash).toString('hex'))
        .then(resp => resp.jobs);
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
    const submissions: Array<{
      values: anchor.BN[];
      signature: Buffer;
      recoveryId: number;
    }> = [];
    const maxI128 = new BN(2).pow(new BN(127)).sub(new BN(1));
    for (let i = 0; i < response.oracle_responses.length; i++) {
      oracles.push(
        new PublicKey(
          Buffer.from(
            response.oracle_responses[i].feed_responses[0].oracle_pubkey,
            'hex'
          )
        )
      );
      const oracleResponse = response.oracle_responses[i];
      const feedResponses = oracleResponse.feed_responses;
      const multisSubmission = {
        values: feedResponses.map((x: { success_value?: string }) => {
          if (!x.success_value || x.success_value === '') {
            return maxI128;
          }
          return new anchor.BN(x.success_value);
        }),
        signature: Buffer.from(
          oracleResponse.signature, // Use oracle-level signature (not feed-level)
          'base64'
        ),
        recoveryId: oracleResponse.feed_responses[0].recovery_id,
      };
      submissions.push(multisSubmission);
    }

    const payerPublicKey =
      params.payer ?? program.provider.publicKey ?? PublicKey.default;
    const oracleFeedStats = oracles.map(
      oracle =>
        PublicKey.findProgramAddressSync(
          [Buffer.from('OracleStats'), oracle.toBuffer()],
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
      ...feeds.map(k => ({
        pubkey: k.pubkey,
        isSigner: false,
        isWritable: true,
      })),
      ...oracles.map(k => ({
        pubkey: k,
        isSigner: false,
        isWritable: false,
      })),
      ...oracleFeedStats.map(k => ({
        pubkey: k,
        isSigner: false,
        isWritable: true,
      })),
    ];
    const lutLoaders: Promise<AddressLookupTableAccount>[] = [];
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
}
