import type { FeedRequest } from "./../accounts/pullFeed.js";
import type * as anchor from "@coral-xyz/anchor-30";
import type { PublicKey } from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/common";
/**
 *  The response from the gateway after fetching signatures.
 *  Variables are snake_case for serialization.
 */
export type FeedEvalResponse = {
    /**
     *  Hex encoded oracle pubkey
     */
    oracle_pubkey: string;
    /**
     *  Hex encoded queue pubkey
     */
    queue_pubkey: string;
    /**
     *  Hex encoded oracle signing pubkey
     */
    oracle_signing_pubkey: string;
    /**
     *  Hex encoded feed id
     */
    feed_hash: string;
    /**
     *  Hex encoded blockhash/slothash the response was signed with.
     */
    recent_hash: string;
    /**
     *  Errors encountered while fetching feed value
     */
    failure_error: string;
    /**
     *  Feed values derived
     */
    success_value: string;
    /**
     *  Signed message of the result and blockhash
     */
    msg: string;
    /**
     *  Oracle signature of the result and blockhash
     *
     *  Sha256(success_feed_hashes || results || slothash)
     */
    signature: string;
    recovery_id: number;
    /**
     *  If the feed fetch failed, get other recent successes
     */
    recent_successes_if_failed: Array<FeedEvalResponse>;
    /**
     * Timestamp marking when the result was fetched
     */
    timestamp?: number;
};
export type FeedEvalManyResponse = {
    feed_responses: FeedEvalResponse[];
    signature: string;
    recovery_id: number;
    errors: string[];
};
export type FetchSignaturesMultiResponse = {
    oracle_responses: FeedEvalManyResponse[];
    errors: string[];
};
export type FeedEvalBatchResponse = {
    feed_responses: FeedEvalResponse[];
    errors: string[];
};
export type FetchSignaturesBatchResponse = {
    oracle_responses: FeedEvalBatchResponse[];
    errors: string[];
};
/**
 *  The response from the gateway after revealing randomness.
 *  Variables are snake_case for serialization.
 */
export type RandomnessRevealResponse = {
    /**
     * Signature of the randomness using the oracle's enclave key
     */
    signature: string;
    /**
     * Recovery ID of the signature
     */
    recovery_id: number;
    /**
     * The randomness value
     */
    value: Array<number>;
};
/**
 * The response from the gateway after attesting an enclave.
 */
export type AttestEnclaveResponse = {
    /**
     * The guardian's public key
     */
    guardian: string;
    /**
     * The signature of the guardian
     */
    signature: string;
    /**
     * The recovery ID of the signature
     */
    recovery_id: number;
};
/**
 * The response from the ping endpoint.
 */
export type PingResponse = {
    /**
     * The oracle's public key
     */
    oracle_pubkey: string;
    /**
     * The oracle's authority pubkey
     */
    oracle_authority: string;
    /**
     * The oracle's queue pubkey
     */
    queue: string;
    /**
     * The registered rate limit for oracle
     */
    rate_limit: number;
    /**
     * The oracle's version
     */
    version: string;
    /**
     * The oracle's enclave measurement
     */
    mr_enclave: string;
    /**
     * Is the oracle a push oracle
     */
    is_push_oracle: boolean;
    /**
     * Is the oracle a pull oracle
     */
    is_pull_oracle: boolean;
    /**
     * Is the oracle a guardian
     */
    is_gateway: boolean;
    /**
     * Is the oracle a guardian
     */
    is_guardian: boolean;
};
/**
 * The Quote info from the gateway_fetch_quote endpoint
 */
export type FetchQuoteResponse = {
    /**
     * The oracle's pubkey
     */
    oracle_pubkey: string;
    /**
     * The oracle's queue pubkey
     */
    queue: string;
    /**
     * The current timestamp used for generating the checksum
     */
    now: number;
    /**
     * The oracle's enclave measurement
     */
    mr_enclave: string;
    /**
     * The oracle's ed25519 pubkey
     */
    ed25519_pubkey: string;
    /**
     * The oracle's secp256k1 pubkey
     */
    secp256k1_pubkey: string;
    /**
     * The base64 encoded quote
     */
    quote: string;
};
export interface BridgeEnclaveResponse {
    /**
     * The guardian's public key
     */
    guardian: string;
    /**
     * The oracle's public key
     */
    oracle: string;
    /**
     * The queue (pubkey) that the oracle belongs to
     */
    queue: string;
    /**
     * The enclave measurement for the oracle
     */
    mr_enclave: string;
    /**
     * The chain hash read on the guardian
     */
    chain_hash: string;
    /**
     * The secp256k1 enclave signer for the oracle
     */
    oracle_secp256k1_enclave_signer: string;
    /**
     * The checksum of the attestation message
     */
    msg: string;
    /**
     * (UNUSED) The attestation message before being hashed
     */
    msg_prehash: string;
    /**
     * The ed25519 enclave signer for the oracle
     */
    oracle_ed25519_enclave_signer?: string;
    /**
     * The timestamp of the attestation
     */
    timestamp?: number;
    /**
     * The signature from the guardian
     */
    signature: string;
    recovery_id: number;
}
/**
 *  The gateway class is used to interface with the switchboard gateway REST API.
 */
export declare class Gateway {
    readonly program: anchor.Program;
    readonly gatewayUrl: string;
    readonly oracleKey?: PublicKey;
    /**
     *  Constructs a `Gateway` instance.
     *
     *  @param program The Anchor program instance.
     *  @param gatewayUrl The URL of the switchboard gateway.
     */
    constructor(program: anchor.Program, gatewayUrl: string, oracleKey?: PublicKey);
    /**
     *  Fetches signatures from the gateway.
     *
     *  REST API endpoint: /api/v1/fetch_signatures
     *
     *  @param recentHash The chain metadata to sign with. Blockhash or slothash.
     *  @param encodedJobs The base64 encoded oracle jobs.
     *  @param numSignatures The number of oracles to fetch signatures from.
     *  @returns A promise that resolves to the feed evaluation responses.
     *  @throws if the request fails.
     */
    fetchSignaturesFromEncoded(params: {
        recentHash?: string;
        encodedJobs: string[];
        numSignatures: number;
        maxVariance: number;
        minResponses: number;
        useTimestamp?: boolean;
    }): Promise<{
        responses: FeedEvalResponse[];
        failures: string[];
    }>;
    ping(): Promise<PingResponse>;
    /**
     *
     * Fetches signatures from the gateway.
     * REST API endpoint: /api/v1/gateway_attest_enclave
     * @param timestamp The timestamp of the attestation
     * @param quote The quote of the attestation
     * @param oracle_pubkey The oracle's public key
     * @param oracle_reward_wallet The oracle's reward wallet
     * @param oracle_ed25519_enclave_signer The oracle's ed25519 enclave signer
     * @param oracle_secp256k1_enclave_signer The oracle's secp256k1 enclave signer
     * @param recentHash The chain metadata to sign with. Blockhash or slothash.
     * @returns A promise that resolves to the attestation response.
     * @throws if the request fails.
     */
    fetchAttestation(params: {
        timestamp: number;
        quote: string;
        oracle_pubkey: string;
        oracle_reward_wallet: string;
        oracle_ed25519_enclave_signer: string;
        oracle_secp256k1_enclave_signer: string;
        recentHash: string;
    }): Promise<AttestEnclaveResponse>;
    /**
     * Fetches a quote from the gateway.
     *
     * REST API endpoint: /api/v1/gateway_fetch_quote
     *
     *
     * @param blockhash The blockhash to fetch the quote for.
     * @param get_for_oracle Whether to fetch the quote for the oracle.
     * @param get_for_guardian Whether to fetch the quote for the guardian.
     * @returns A promise that resolves to the quote response.
     * @throws if the request fails.
     */
    fetchQuote(params: {
        blockhash: string;
        get_for_oracle: boolean;
        get_for_guardian: boolean;
    }): Promise<FetchQuoteResponse[]>;
    /**
     *  Fetches signatures from the gateway.
     *
     *  REST API endpoint: /api/v1/fetch_signatures
     *
     *  @param recentHash The chain metadata to sign with. Blockhash or slothash.
     *  @param jobs The oracle jobs to perform.
     *  @param numSignatures The number of oracles to fetch signatures from.
     *  @param maxVariance The maximum variance allowed in the feed values.
     *  @param minResponses The minimum number of responses of jobs to succeed.
     *  @param useTimestamp Whether to use the timestamp in the response & to encode update signature.
     *  @returns A promise that resolves to the feed evaluation responses.
     *  @throws if the request fails.
     */
    fetchSignatures(params: {
        recentHash?: string;
        jobs: OracleJob[];
        numSignatures?: number;
        maxVariance?: number;
        minResponses?: number;
        useTimestamp?: boolean;
    }): Promise<{
        responses: FeedEvalResponse[];
        failures: string[];
    }>;
    fetchSignaturesMulti(params: {
        recentHash?: string;
        feedConfigs: FeedRequest[];
        numSignatures?: number;
        useTimestamp?: boolean;
    }): Promise<FetchSignaturesMultiResponse>;
    fetchSignaturesFromEncodedMulti(params: {
        recentHash?: string;
        encodedConfigs: {
            encodedJobs: string[];
            maxVariance: number;
            minResponses: number;
        }[];
        numSignatures: number;
        useTimestamp?: boolean;
    }): Promise<FetchSignaturesMultiResponse>;
    /**
     * Fetches signatures from the gateway without pre-encoded jobs
     * REST API endpoint: /api/v1/fetch_signatures_batch
     *
     * @param recentHash The chain metadata to sign with. Blockhash or slothash.
     * @param feedConfigs The feed configurations to fetch signatures for.
     * @param numSignatures The number of oracles to fetch signatures from.
     * @param useTimestamp Whether to use the timestamp in the response & to encode update signature.
     * @returns A promise that resolves to the feed evaluation responses.
     * @throws if the request fails.
     */
    fetchSignaturesBatch(params: {
        recentHash?: string;
        feedConfigs: FeedRequest[];
        numSignatures?: number;
        useTimestamp?: boolean;
    }): Promise<FetchSignaturesBatchResponse>;
    /**
     * Fetches signatures from the gateway.
     * REST API endpoint: /api/v1/fetch_signatures_batch
     *
     * @param recentHash The chain metadata to sign with. Blockhash or slothash.
     * @param encodedConfigs The encoded feed configurations to fetch signatures for.
     * @param numSignatures The number of oracles to fetch signatures from.
     * @param useTimestamp Whether to use the timestamp in the response & to encode update signature.
     * @returns A promise that resolves to the feed evaluation responses.
     * @throws if the request fails.
     */
    fetchSignaturesFromEncodedBatch(params: {
        recentHash?: string;
        encodedConfigs: {
            encodedJobs: string[];
            maxVariance: number;
            minResponses: number;
        }[];
        numSignatures: number;
        useTimestamp?: boolean;
    }): Promise<FetchSignaturesBatchResponse>;
    /**
     * Sends a request to the gateway bridge enclave.
     *
     * REST API endpoint: /api/v1/gateway_bridge_enclave
     *
     * @param chainHash The chain hash to include in the request.
     * @param oraclePubkey The public key of the oracle.
     * @param queuePubkey The public key of the queue.
     * @returns A promise that resolves to the response.
     * @throws if the request fails.
     */
    fetchBridgingMessage(params: {
        chainHash: string;
        oraclePubkey: string;
        queuePubkey: string;
    }): Promise<BridgeEnclaveResponse>;
    /**
     * Fetches the randomness reveal from the gateway.
     * @param params The parameters for the randomness reveal.
     * @returns The randomness reveal response.
     */
    fetchRandomnessReveal(params: {
        randomnessAccount: PublicKey;
        slothash: string;
        slot: number;
    } | {
        randomnessId: string;
        timestamp: number;
        minStalenessSeconds: number;
    }): Promise<RandomnessRevealResponse>;
    test(): Promise<boolean>;
    endpoint(): string;
    toString(): string;
    [Symbol.toPrimitive](hint: string): string;
}
//# sourceMappingURL=gateway.d.ts.map