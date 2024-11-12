import type { FeedRequest } from "./../accounts/pullFeed.js";

import { TTLCache } from "@brokerloop/ttlcache";
import type * as anchor from "@coral-xyz/anchor-30";
import type { PublicKey } from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/common";
import type { AxiosInstance } from "axios";
import axios from "axios";
import * as bs58 from "bs58";

const GATEWAY_PING_CACHE = new TTLCache<string, boolean>({
  ttl: 100,
  max: 50,
  clock: Date,
});

// const httpsAgent = new HttpsAgent({
//   rejectUnauthorized: false, // WARNING: This disables SSL/TLS certificate verification.
// });
const TIMEOUT = 10_000;

const axiosClient: () => AxiosInstance = (() => {
  let instance: AxiosInstance;

  return () => {
    if (!instance) {
      instance = axios.create();
    }
    return instance;
  };
})();

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
 *  base64 encodes an array of oracle jobs. to send to a gateway
 */
function encodeJobs(jobArray: OracleJob[]): string[] {
  return jobArray.map((job) => {
    const encoded = OracleJob.encodeDelimited(
      OracleJob.fromObject(job)
    ).finish();
    // const decoded = OracleJob.decodeDelimited(encoded);
    return Buffer.from(encoded).toString("base64");
  });
}

/**
 *  The gateway class is used to interface with the switchboard gateway REST API.
 */
export class Gateway {
  /**
   *  Constructs a `Gateway` instance.
   *
   *  @param program The Anchor program instance.
   *  @param gatewayUrl The URL of the switchboard gateway.
   */
  constructor(
    readonly program: anchor.Program,
    readonly gatewayUrl: string,
    readonly oracleKey?: PublicKey
  ) {}

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
  async fetchSignaturesFromEncoded(params: {
    recentHash?: string;
    encodedJobs: string[];
    numSignatures: number;
    maxVariance: number;
    minResponses: number;
    useTimestamp?: boolean;
  }): Promise<{ responses: FeedEvalResponse[]; failures: string[] }> {
    // TODO: have total NumOracles count against rate limit per IP
    const { recentHash, encodedJobs, numSignatures } = params;
    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures`;
    const headers = { "Content-Type": "application/json" };
    const maxVariance = params.maxVariance * 1e9;
    const body = JSON.stringify({
      api_version: "1.0.0",
      jobs_b64_encoded: encodedJobs,
      recent_chainhash: recentHash ?? bs58.encode(Buffer.alloc(32, 0)),
      signature_scheme: "Secp256k1",
      hash_scheme: "Sha256",
      num_oracles: numSignatures,
      max_variance: maxVariance,
      min_responses: params.minResponses,
      use_timestamp: params.useTimestamp ?? false,
    });
    return axiosClient()
      .post(url, body, {
        headers,
        timeout: TIMEOUT,
      })
      .then((r) => r.data);
  }

  async ping(): Promise<PingResponse> {
    const url = `${this.gatewayUrl}/gateway/api/v1/ping`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({ api_version: "1.0.0" });
    return axiosClient()
      .post(url, body, { method, headers, timeout: TIMEOUT })
      .then((r) => r.data);
  }

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
  async fetchAttestation(params: {
    timestamp: number;
    quote: string;
    oracle_pubkey: string;
    oracle_reward_wallet: string;
    oracle_ed25519_enclave_signer: string;
    oracle_secp256k1_enclave_signer: string;
    recentHash: string;
  }): Promise<AttestEnclaveResponse> {
    const api_version = "1.0.0";
    const url = `${this.gatewayUrl}/gateway/api/v1/gateway_attest_enclave`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({
      api_version,
      timestamp: params.timestamp,
      quote: params.quote,
      oracle_pubkey: params.oracle_pubkey,
      oracle_reward_wallet: params.oracle_reward_wallet,
      oracle_ed25519_enclave_signer: params.oracle_ed25519_enclave_signer,
      oracle_secp256k1_enclave_signer: params.oracle_secp256k1_enclave_signer,
      chain_hash: params.recentHash,
    });

    return axiosClient()
      .post(url, { method, headers, data: body, timeout: TIMEOUT })
      .then((r) => r.data);
  }

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
  async fetchQuote(params: {
    blockhash: string;
    get_for_oracle: boolean;
    get_for_guardian: boolean;
  }): Promise<FetchQuoteResponse[]> {
    const api_version = "1.0.0";
    const url = `${this.endpoint()}/gateway/api/v1/gateway_fetch_quote`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({
      api_version,
      blockhash: params.blockhash,
      get_for_oracle: params.get_for_oracle,
      get_for_guardian: params.get_for_guardian,
    });
    return axiosClient()
      .post(url, { method, headers, data: body, timeout: TIMEOUT })
      .then(async (r) => {
        return r.data;
      });
  }

  // alberthermida@Switchboard ts % curl -X POST \
  // -H "Content-Type: application/json" \
  // -d '{
  //   "api_version": "1.0.0",
  //   "blockhash": "0000000000000000000000000000000000000000000000000000000000000000",
  //   "get_for_oracle": true,
  //   "get_for_guardian": false
  // }' \
  // https://vu-ams-02.switchboard-oracles.xyz/gateway/api/v1/gateway_fetch_quote

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
  async fetchSignatures(params: {
    recentHash?: string;
    jobs: OracleJob[];
    numSignatures?: number;
    maxVariance?: number;
    minResponses?: number;
    useTimestamp?: boolean;
  }): Promise<{ responses: FeedEvalResponse[]; failures: string[] }> {
    params.numSignatures = params.numSignatures ?? 1;
    params.maxVariance = params.maxVariance ?? 1;
    params.minResponses = params.minResponses ?? 1;
    const {
      recentHash,
      jobs,
      numSignatures,
      maxVariance,
      minResponses,
      useTimestamp,
    } = params;
    const encodedJobs = encodeJobs(jobs);
    const res = await this.fetchSignaturesFromEncoded({
      recentHash,
      encodedJobs,
      numSignatures,
      maxVariance,
      minResponses,
      useTimestamp,
    });
    return res;
  }

  async fetchSignaturesMulti(params: {
    recentHash?: string;
    feedConfigs: FeedRequest[];
    numSignatures?: number;
    useTimestamp?: boolean;
  }): Promise<FetchSignaturesMultiResponse> {
    const { recentHash, feedConfigs, useTimestamp, numSignatures } = params;
    const encodedConfigs = feedConfigs.map((config) => {
      const encodedJobs = encodeJobs(config.jobs);
      return {
        encodedJobs,
        maxVariance: config.maxVariance ?? 1,
        minResponses: config.minResponses ?? 1,
      };
    });
    const res = await this.fetchSignaturesFromEncodedMulti({
      recentHash,
      encodedConfigs,
      numSignatures: numSignatures ?? 1,
      useTimestamp,
    });
    return res;
  }

  async fetchSignaturesFromEncodedMulti(params: {
    recentHash?: string;
    encodedConfigs: {
      encodedJobs: string[];
      maxVariance: number;
      minResponses: number;
    }[];
    numSignatures: number;
    useTimestamp?: boolean;
  }): Promise<FetchSignaturesMultiResponse> {
    // TODO: have total NumOracles count against rate limit per IP
    const { recentHash, encodedConfigs, numSignatures } = params;
    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures_multi`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = {
      api_version: "1.0.0",
      num_oracles: numSignatures,
      recent_hash: recentHash ?? bs58.encode(Buffer.alloc(32, 0)),
      signature_scheme: "Secp256k1",
      hash_scheme: "Sha256",
      feed_requests: [] as any,
    };
    for (const config of encodedConfigs) {
      const maxVariance = Math.floor(Number(config.maxVariance ?? 1) * 1e9);
      body.feed_requests.push({
        jobs_b64_encoded: config.encodedJobs,
        max_variance: maxVariance,
        min_responses: config.minResponses ?? 1,
        use_timestamp: params.useTimestamp ?? false,
      });
    }
    const data = JSON.stringify(body);
    try {
      const resp = await axiosClient()(url, { method, headers, data }).then(
        (r) => r.data
      );
      return resp;
    } catch (err) {
      console.error("fetchSignaturesFromEncodedMulti error", err);
      throw err;
    }
  }

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
  async fetchSignaturesBatch(params: {
    recentHash?: string;
    feedConfigs: FeedRequest[];
    numSignatures?: number;
    useTimestamp?: boolean;
  }): Promise<FetchSignaturesBatchResponse> {
    const { recentHash, feedConfigs, useTimestamp, numSignatures } = params;
    const encodedConfigs = feedConfigs.map((config) => {
      const encodedJobs = encodeJobs(config.jobs);
      return {
        encodedJobs,
        maxVariance: config.maxVariance ?? 1,
        minResponses: config.minResponses ?? 1,
      };
    });
    const res = await this.fetchSignaturesFromEncodedBatch({
      recentHash,
      encodedConfigs,
      numSignatures: numSignatures ?? 1,
      useTimestamp,
    });
    return res;
  }

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
  async fetchSignaturesFromEncodedBatch(params: {
    recentHash?: string;
    encodedConfigs: {
      encodedJobs: string[];
      maxVariance: number;
      minResponses: number;
    }[];
    numSignatures: number;
    useTimestamp?: boolean;
  }): Promise<FetchSignaturesBatchResponse> {
    const { recentHash, encodedConfigs, numSignatures } = params;
    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures_batch`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = {
      api_version: "1.0.0",
      num_oracles: numSignatures,
      recent_hash: recentHash ?? bs58.encode(Buffer.alloc(32, 0)),
      signature_scheme: "Secp256k1",
      hash_scheme: "Sha256",
      feed_requests: [] as any,
    };
    for (const config of encodedConfigs) {
      const maxVariance = Math.floor(Number(config.maxVariance ?? 1) * 1e9);
      body.feed_requests.push({
        jobs_b64_encoded: config.encodedJobs,
        max_variance: maxVariance,
        min_responses: config.minResponses ?? 1,
        use_timestamp: params.useTimestamp ?? false,
      });
    }
    const data = JSON.stringify(body);

    // get size of data
    try {
      const resp = await axiosClient()(url, { method, headers, data }).then(
        (r) => {
          return {
            ...r.data,
          };
        }
      );

      return resp;
    } catch (err) {
      console.error("fetchSignaturesFromEncodedBatch error", err);
      throw err;
    }
  }

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
  async fetchBridgingMessage(params: {
    chainHash: string;
    oraclePubkey: string;
    queuePubkey: string;
  }): Promise<BridgeEnclaveResponse> {
    const url = `${this.gatewayUrl}/gateway/api/v1/gateway_bridge_enclave`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = {
      api_version: "1.0.0",
      chain_hash: params.chainHash,
      oracle_pubkey: params.oraclePubkey,
      queue_pubkey: params.queuePubkey,
    };
    const data = JSON.stringify(body);

    try {
      const resp = await axiosClient()(url, { method, headers, data }).then(
        (r) => r.data
      );
      return resp;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Fetches the randomness reveal from the gateway.
   * @param params The parameters for the randomness reveal.
   * @returns The randomness reveal response.
   */
  async fetchRandomnessReveal(
    params:
      | {
          randomnessAccount: PublicKey;
          slothash: string;
          slot: number;
        }
      | {
          randomnessId: string;
          timestamp: number;
          minStalenessSeconds: number;
        }
  ): Promise<RandomnessRevealResponse> {
    const url = `${this.gatewayUrl}/gateway/api/v1/randomness_reveal`;
    const method = "POST";
    const responseType = "text";
    const headers = { "Content-Type": "application/json" };

    // Handle Solana and Cross-Chain Randomness
    let data: string;
    if ("slot" in params) {
      // Solana Randomness
      data = JSON.stringify({
        slothash: [...bs58.decode(params.slothash)],
        randomness_key: params.randomnessAccount.toBuffer().toString("hex"),
        slot: params.slot,
      });
    } else {
      // Cross-chain randomness
      data = JSON.stringify({
        timestamp: params.timestamp,
        min_staleness_seconds: params.minStalenessSeconds,
        randomness_key: params.randomnessId,
      });
    }
    try {
      const txtResponse = await axiosClient()(url, {
        method,
        headers,
        data,
        responseType,
      });
      return JSON.parse(txtResponse.data);
    } catch (err) {
      console.error("fetchRandomnessReveal error", err);
      throw err;
    }
  }

  async test(): Promise<boolean> {
    const url = `${this.gatewayUrl}/gateway/api/v1/test`;
    const cachedResponse = GATEWAY_PING_CACHE.get(this.gatewayUrl);
    if (cachedResponse !== undefined) {
      return cachedResponse;
    }
    try {
      const txt = await axiosClient()(url);
      if (txt.data.length !== 0) {
        GATEWAY_PING_CACHE.set(this.gatewayUrl, true);
        return true;
      }
    } catch {}
    GATEWAY_PING_CACHE.set(this.gatewayUrl, false);
    return false;
  }

  endpoint(): string {
    return this.gatewayUrl;
  }

  toString(): string {
    return JSON.stringify({
      gatewayUrl: this.gatewayUrl,
      programId: this.program.programId.toBase58(),
    });
  }

  [Symbol.toPrimitive](hint: string) {
    if (hint === "string") {
      return `Gateway: ${this.toString()}`;
    }
    return null;
  }
}
