/// <reference types="node" />
/// <reference types="node" />
import type { FeedEvalResponse, FetchSignaturesMultiResponse } from "../oracle-interfaces/gateway.js";
import { Oracle } from "./oracle.js";
import type { Program } from "@coral-xyz/anchor-30";
import * as anchor from "@coral-xyz/anchor-30";
import { BN } from "@coral-xyz/anchor-30";
import type { AddressLookupTableAccount, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { IOracleJob } from "@switchboard-xyz/common";
import { OracleJob } from "@switchboard-xyz/common";
import { CrossbarClient } from "@switchboard-xyz/common";
import Big from "big.js";
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
    signature: Buffer;
    recoveryId: number;
};
export declare class OracleResponse {
    readonly oracle: Oracle;
    readonly value: Big | null;
    readonly error: string;
    constructor(oracle: Oracle, value: Big | null, error: string);
    shortError(): string | undefined;
}
export type FeedRequest = {
    maxVariance: number;
    minResponses: number;
    jobs: OracleJob[];
};
export type FeedSubmission = {
    value: Big;
    slot: anchor.BN;
    oracle: PublicKey;
};
export declare function toFeedValue(submissions: FeedSubmission[], onlyAfter: anchor.BN): FeedSubmission | null;
/**
 *  Abstraction around the Switchboard-On-Demand Feed account
 *
 *  This account is used to store the feed data and the oracle responses
 *  for a given feed.
 */
export declare class PullFeed {
    readonly program: Program;
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
    constructor(program: Program, pubkey: PublicKey | string);
    static generate(program: Program): [PullFeed, Keypair];
    static initTx(program: Program, params: {
        name: string;
        queue: PublicKey;
        maxVariance: number;
        minResponses: number;
        minSampleSize: number;
        maxStaleness: number;
        payer?: PublicKey;
    } & ({
        feedHash: Buffer;
    } | {
        jobs: IOracleJob[];
    })): Promise<[PullFeed, VersionedTransaction]>;
    private getPayer;
    /**
     *  Calls to initialize a pull feed account and to update the configuration account need to
     *  compute the feed hash for the account (if one is not specified).
     */
    private static feedHashFromParams;
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
    initIx(params: {
        name: string;
        queue: PublicKey;
        maxVariance: number;
        minResponses: number;
        payer?: PublicKey;
        minSampleSize: number;
        maxStaleness: number;
    } & ({
        feedHash: Buffer;
    } | {
        jobs: IOracleJob[];
    })): Promise<TransactionInstruction>;
    closeIx(params: {
        payer?: PublicKey;
    }): Promise<TransactionInstruction>;
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
    setConfigsIx(params: {
        name?: string;
        authority?: PublicKey;
        maxVariance?: number;
        minResponses?: number;
        feedHash?: Buffer;
        jobs?: IOracleJob[];
        minSampleSize?: number;
        maxStaleness?: number;
    }): Promise<TransactionInstruction>;
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
    fetchUpdateIx(params_?: {
        gateway?: string;
        numSignatures?: number;
        jobs?: IOracleJob[];
        crossbarClient?: CrossbarClient;
        retries?: number;
        chain?: string;
        network?: "mainnet" | "mainnet-beta" | "testnet" | "devnet";
        solanaRpcUrl?: string;
    }, recentSlothashes?: Array<[anchor.BN, string]>, priceSignatures?: FeedEvalResponse[], debug?: boolean, payer?: PublicKey): Promise<[
        TransactionInstruction | undefined,
        OracleResponse[],
        number,
        AddressLookupTableAccount[],
        string[]
    ]>;
    /**
     * Loads the feed configurations for this {@linkcode PullFeed} account from on chain.
     * @returns A promise that resolves to the feed configurations.
     * @throws if the feed account does not exist.
     */
    loadConfigs(): Promise<{
        queue: PublicKey;
        maxVariance: number;
        minResponses: number;
        feedHash: Buffer;
        minSampleSize: number;
    }>;
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
    static fetchUpdateIx(program: Program, params_: {
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
    }, recentSlothashes?: Array<[anchor.BN, string]>, priceSignatures?: FeedEvalResponse[], debug?: boolean, payer?: PublicKey): Promise<[
        TransactionInstruction | undefined,
        OracleResponse[],
        number,
        AddressLookupTableAccount[],
        string[]
    ]>;
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
    static fetchUpdateManyIxs(program: Program, params_: {
        gateway?: string;
        feeds: PublicKey[];
        numSignatures: number;
        crossbarClient?: CrossbarClient;
        payer?: PublicKey;
    }, recentSlothashes?: Array<[anchor.BN, string]>, debug?: boolean, payer?: PublicKey): Promise<{
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
    }>;
    /**
     * Prefetch all lookup tables needed for the feed and queue.
     * @returns A promise that resolves to an array of lookup tables.
     * @throws if the lookup tables cannot be loaded.
     */
    preHeatLuts(): Promise<AddressLookupTableAccount[]>;
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
    static fetchUpdateManyIx(program: Program, params_: {
        gateway?: string;
        feeds: PublicKey[];
        numSignatures: number;
        crossbarClient?: CrossbarClient;
        payer?: PublicKey;
    }, recentSlothashes?: Array<[anchor.BN, string]>, debug?: boolean): Promise<[
        TransactionInstruction,
        AddressLookupTableAccount[],
        FetchSignaturesMultiResponse
    ]>;
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
    }): TransactionInstruction;
    /**
     *  Checks if the pull feed account has been initialized.
     *
     *  @returns A promise that resolves to a boolean indicating if the account has been initialized.
     */
    isInitializedAsync(): Promise<boolean>;
    /**
     *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
     *
     *  @returns A promise that resolves to the feed data.
     *  @throws if the feed account does not exist.
     */
    loadData(): Promise<PullFeedAccountData>;
    /**
     *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
     *
     *  @returns A promise that resolves to the values currently stored in the feed.
     *  @throws if the feed account does not exist.
     */
    loadValues(): Promise<Array<{
        value: Big;
        slot: anchor.BN;
        oracle: PublicKey;
    }>>;
    /**
     *  Loads the feed data for this {@linkcode PullFeed} account from on chain.
     *
     *  @param onlyAfter Call will ignore data signed before this slot.
     *  @returns A promise that resolves to the observed value as it would be
     *           seen on-chain.
     */
    loadObservedValue(onlyAfter: anchor.BN): Promise<{
        value: Big;
        slot: anchor.BN;
        oracle: PublicKey;
    } | null>;
    /**
     * Watches for any on-chain updates to the feed data.
     *
     * @param callback The callback to call when the feed data is updated.
     * @returns A promise that resolves to a subscription ID.
     */
    subscribeToValueChanges(callback: any): Promise<number>;
    /**
     * Watches for any on-chain updates to any data feed.
     *
     * @param program The Anchor program instance.
     * @param callback The callback to call when the feed data is updated.
     * @returns A promise that resolves to a subscription ID.
     */
    static subscribeToAllUpdates(program: Program, callback: (event: [number, {
        pubkey: PublicKey;
        submissions: FeedSubmission[];
    }]) => Promise<void>): Promise<number>;
    lookupTableKey(data: any): PublicKey;
    loadLookupTable(): Promise<AddressLookupTableAccount>;
    loadHistoricalValuesCompact(data_?: PullFeedAccountData): Promise<CompactResult[]>;
}
//# sourceMappingURL=pullFeed.d.ts.map