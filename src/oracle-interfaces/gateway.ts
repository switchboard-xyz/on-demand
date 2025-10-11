import { Surge } from './../classes/surge.js';
import { GATEWAY_PING_CACHE } from './../utils/cache.js';

import type { BN, web3 } from '@coral-xyz/anchor-31';
import type { Program } from '@coral-xyz/anchor-31';
import type { IOracleFeed, IOracleJob } from '@switchboard-xyz/common';
import {
  CrossbarClient,
  OracleFeedUtils,
  OracleJobUtils,
} from '@switchboard-xyz/common';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import bs58 from 'bs58';

const TIMEOUT = 10_000;

const axiosClient: () => AxiosInstance = (() => {
  let instance: AxiosInstance;
  return () => (instance ??= axios.create());
})();

/**
 * Configuration for a feed request to oracle operators
 */
export type FeedRequestV1 = {
  /** Maximum allowed variance between oracle responses (e.g., 1.0 = 100%) */
  maxVariance?: number;
  /** Minimum number of oracle responses required */
  minResponses?: number;
  /** Array of oracle job definitions */
  jobs: IOracleJob[];
};

/**
 * Configuration for a feed request to oracle operators
 */
export type FeedRequestV2 = {
  /** Base64 encoded feed proto */
  feed: IOracleFeed;
};

/**
 * Configuration for a feed request to oracle operators
 */
export type FeedRequest = FeedRequestV1 | FeedRequestV2;

/**
 * Response from a single oracle for a feed evaluation
 *
 * Contains the oracle's signed response including the computed value,
 * signature, and metadata. Variables are snake_case for serialization
 * compatibility with the gateway API.
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

  /**
   * Minimum number of oracle samples required
   */
  min_oracle_samples: number;

  /**
   * Task execution receipts
   */
  receipts?: Array<Record<string, unknown>>;
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

export type FetchSignaturesConsensusResponse = {
  median_responses: { value: string; feed_hash: string; num_oracles: number }[];
  oracle_responses: {
    oracle_pubkey: string;
    eth_address: string;
    signature: string;
    checksum: string;
    recovery_id: number;
    ed25519_enclave_signer: string;
    feed_responses: FeedEvalResponse[];
    errors: string[];
    oracle_idx: number;
    min_oracle_samples: number;
  }[];
  failed_oracle_responses: {
    oracle_pubkey: string;
    eth_address: string;
    signature: string;
    checksum: string;
    recovery_id: number;
    ed25519_enclave_signer: string;
    feed_responses: FeedEvalResponse[];
    errors: string[];
    oracle_idx: number;
  }[];
  recent_hash: string;
  slot: BN;
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
 *  `base64` encodes an array of oracle jobs. to send to a gateway
 */
function encodeJobs(jobArray: IOracleJob[]): string[] {
  return jobArray.map(job =>
    OracleJobUtils.serializeOracleJob(job).toString('base64')
  );
}

/**
 * Gateway interface for oracle communication
 *
 * The Gateway class provides the connection between your application
 * and Switchboard oracle operators. It handles:
 *
 * - Fetching signed price data from oracles
 * - Managing oracle selection and consensus
 * - Batch operations for multiple feeds
 * - Network latency optimization
 * - Variable overrides for dynamic task customization
 *
 * Gateways are geo-distributed endpoints that route requests to
 * available oracle operators for optimal performance.
 *
 * ## Variable Overrides
 *
 * Variable overrides allow you to dynamically customize oracle task execution
 * by providing key-value pairs that replace variables within oracle jobs.
 * This is particularly useful for:
 *
 * - **API Key Management**: Override API keys for different environments
 * - **Dynamic Parameters**: Change URLs, endpoints, or query parameters
 * - **A/B Testing**: Switch between different data sources
 * - **Environment Configuration**: Use different settings for dev/staging/prod
 *
 * ### Usage Examples
 *
 * ```typescript
 * // Create gateway
 * const gateway = new Gateway(program, 'https://gateway.switchboard.xyz');
 *
 * // Basic feed fetch with API key override
 * const response = await gateway.fetchSignatures({
 *   jobs: [buildApiJob('${API_KEY}')], // Job uses ${API_KEY} variable
 *   numSignatures: 3,
 *   variableOverrides: {
 *     'API_KEY': 'prod-api-key-123',
 *     'BASE_URL': 'https://api.prod.example.com'
 *   }
 * });
 *
 * // Batch processing with environment-specific overrides
 * const batchResponse = await gateway.fetchSignaturesBatch({
 *   feedConfigs: [{
 *     jobs: [buildJob('${ENDPOINT}/price/${SYMBOL}')],
 *     maxVariance: 0.5,
 *     minResponses: 2
 *   }],
 *   numSignatures: 5,
 *   variableOverrides: {
 *     'ENDPOINT': 'https://api.staging.example.com',
 *     'SYMBOL': 'BTCUSD',
 *     'TIMEOUT': '30000'
 *   }
 * });
 *
 * // Multi-feed with shared overrides
 * const multiResponse = await gateway.fetchSignaturesMulti({
 *   feedConfigs: [
 *     { jobs: [priceJob1], maxVariance: 1.0, minResponses: 1 },
 *     { jobs: [priceJob2], maxVariance: 1.5, minResponses: 2 }
 *   ],
 *   numSignatures: 4,
 *   variableOverrides: {
 *     'API_VERSION': 'v2',
 *     'RATE_LIMIT': '100'
 *   }
 * });
 *
 * // Consensus with authentication override
 * const consensusResponse = await gateway.fetchSignaturesConsensus({
 *   feedConfigs: [{ feed: myFeedConfig }],
 *   numSignatures: 7,
 *   variableOverrides: {
 *     'AUTH_TOKEN': await getAuthToken(),
 *     'REGION': 'us-east-1'
 *   }
 * });
 * ```
 *
 * ### Variable Syntax in Jobs
 *
 * Variables in oracle jobs use the `${VARIABLE_NAME}` syntax:
 *
 * ```typescript
 * const httpJob = {
 *   tasks: [{
 *     httpTask: {
 *       url: '${BASE_URL}/api/${VERSION}/price?symbol=${SYMBOL}&key=${API_KEY}',
 *       method: 'GET',
 *       headers: {
 *         'Authorization': 'Bearer ${AUTH_TOKEN}',
 *         'User-Agent': '${USER_AGENT}'
 *       }
 *     }
 *   }]
 * };
 * ```
 *
 * ### Best Practices
 *
 * 1. **Security**: Never hardcode sensitive API keys in jobs - use overrides
 * 2. **Environment Management**: Use overrides to switch between dev/staging/prod
 * 3. **Flexibility**: Design jobs with variables for maximum reusability
 * 4. **Validation**: Ensure all required variables are provided in overrides
 * 5. **Documentation**: Document expected variables in your job definitions
 *
 * @class Gateway
 */
export class Gateway {
  /**
   * Constructs a Gateway instance
   *
   * @param {Program} program - The Anchor program instance
   * @param {string} gatewayUrl - The URL of the switchboard gateway
   * @param {web3.PublicKey} oracleKey - Optional specific oracle key
   */
  constructor(
    readonly program: Program,
    readonly gatewayUrl: string,
    readonly oracleKey?: web3.PublicKey
  ) {}

  /**
   * Initializes a Surge instance
   * @param {Object} params - The parameters for the surge instance
   * @param {string} params.apiKey - The API key for authentication
   * @param {boolean} [params.verbose=false] - Whether to enable verbose logging
   * @return {Surge} A new instance of dSurge
   */
  initSurge(params: { apiKey: string; verbose?: boolean }): Surge {
    return new Surge({
      apiKey: params.apiKey,
      gatewayUrl: this.gatewayUrl,
      verbose: params.verbose ?? false,
    });
  }

  /**
   *  Fetches signatures from the gateway.
   *
   *  REST API endpoint: /api/v1/fetch_signatures
   *
   *  @param recentHash The chain metadata to sign with. Blockhash or slothash.
   *  @param encodedJobs The base64 encoded oracle jobs.
   *  @param numSignatures The number of oracles to fetch signatures from.
   *  @param variableOverrides Optional variable overrides for task execution (e.g., {"API_KEY": "custom-key"})
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
    variableOverrides?: Record<string, string>;
  }): Promise<{ responses: FeedEvalResponse[]; failures: string[] }> {
    // TODO: have total NumOracles count against rate limit per IP
    const { recentHash, encodedJobs, numSignatures } = params;
    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures`;
    const headers = { 'Content-Type': 'application/json' };
    const maxVariance = params.maxVariance * 1e9;
    const body = JSON.stringify({
      api_version: '1.0.0',
      jobs_b64_encoded: encodedJobs,
      recent_chainhash: recentHash ?? bs58.encode(Buffer.alloc(32, 0)),
      signature_scheme: 'Secp256k1',
      hash_scheme: 'Sha256',
      num_oracles: numSignatures,
      max_variance: maxVariance,
      min_responses: params.minResponses,
      use_timestamp: params.useTimestamp ?? false,
      variable_overrides: params.variableOverrides ?? {},
    });
    return axiosClient()
      .post(url, body, {
        headers,
        timeout: TIMEOUT,
      })
      .then(r => r.data);
  }

  async ping(): Promise<PingResponse> {
    const url = `${this.gatewayUrl}/gateway/api/v1/ping`;
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ api_version: '1.0.0' });
    return axiosClient()
      .post(url, body, { method, headers, timeout: TIMEOUT })
      .then(r => r.data);
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
    const url = `${this.gatewayUrl}/gateway/api/v1/gateway_attest_enclave`;
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      api_version: '1.0.0',
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
      .then(r => r.data);
  }

  /**
   * Fetches an attestation quote from the gateway.
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
  async fetchAttestationQuote(params: {
    blockhash: string;
    get_for_oracle: boolean;
    get_for_guardian: boolean;
  }): Promise<FetchQuoteResponse[]> {
    const url = `${this.endpoint()}/gateway/api/v1/gateway_fetch_quote`;
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      api_version: '1.0.0',
      blockhash: params.blockhash,
      get_for_oracle: params.get_for_oracle,
      get_for_guardian: params.get_for_guardian,
    });
    return axiosClient()
      .post(url, { method, headers, data: body, timeout: TIMEOUT })
      .then(r => r.data);
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
   *  @param variableOverrides Optional variable overrides for task execution (e.g., {"API_KEY": "custom-key"})
   *  @returns A promise that resolves to the feed evaluation responses.
   *  @throws if the request fails.
   */
  async fetchSignatures(params: {
    recentHash?: string;
    jobs: IOracleJob[];
    numSignatures?: number;
    maxVariance?: number;
    minResponses?: number;
    useTimestamp?: boolean;
    variableOverrides?: Record<string, string>;
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
      variableOverrides,
    } = params;
    const encodedJobs = encodeJobs(jobs);
    const res = await this.fetchSignaturesFromEncoded({
      recentHash,
      encodedJobs,
      numSignatures,
      maxVariance,
      minResponses,
      useTimestamp,
      variableOverrides,
    });
    return res;
  }

  /**
   * Fetches signatures from multiple feeds
   *
   * @param recentHash The chain metadata to sign with. Blockhash or slothash.
   * @param feedConfigs Array of feed configurations to fetch signatures for.
   * @param numSignatures The number of oracles to fetch signatures from.
   * @param useTimestamp Whether to use the timestamp in the response & to encode update signature.
   * @param variableOverrides Optional variable overrides for task execution (e.g., {"API_KEY": "custom-key"})
   * @returns A promise that resolves to the feed evaluation responses.
   * @throws if the request fails.
   */
  async fetchSignaturesMulti(params: {
    recentHash?: string;
    feedConfigs: FeedRequestV1[];
    numSignatures?: number;
    useTimestamp?: boolean;
    variableOverrides?: Record<string, string>;
  }): Promise<FetchSignaturesMultiResponse> {
    const {
      recentHash,
      feedConfigs,
      useTimestamp,
      numSignatures,
      variableOverrides,
    } = params;
    const encodedConfigs = feedConfigs.map(config => ({
      encodedJobs: encodeJobs(config.jobs),
      maxVariance: config.maxVariance ?? 1,
      minResponses: config.minResponses ?? 1,
    }));
    const res = await this.fetchSignaturesFromEncodedMulti({
      recentHash,
      encodedConfigs,
      numSignatures: numSignatures ?? 1,
      useTimestamp,
      variableOverrides,
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
    variableOverrides?: Record<string, string>;
  }): Promise<FetchSignaturesMultiResponse> {
    // TODO: have total NumOracles count against rate limit per IP
    const { recentHash, encodedConfigs, numSignatures } = params;
    if (numSignatures <= 0) {
      throw new Error('numSignatures must be greater than 0');
    }

    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures_multi`;
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const body = {
      api_version: '1.0.0',
      num_oracles: numSignatures,
      recent_hash: recentHash ?? bs58.encode(Buffer.alloc(32, 0)),
      signature_scheme: 'Secp256k1',
      hash_scheme: 'Sha256',
      feed_requests: encodedConfigs.map(config => ({
        jobs_b64_encoded: config.encodedJobs,
        max_variance: Math.floor(Number(config.maxVariance ?? 1) * 1e9),
        min_responses: config.minResponses ?? 1,
        use_timestamp: params.useTimestamp ?? false,
      })),
      variable_overrides: params.variableOverrides ?? {},
    };
    const data = JSON.stringify(body);
    try {
      const resp = await axiosClient()(url, { method, headers, data });
      return resp.data;
    } catch (err) {
      console.error('fetchSignaturesFromEncodedMulti error', err);
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
   * @param variableOverrides Optional variable overrides for task execution (e.g., {"API_KEY": "custom-key"})
   * @returns A promise that resolves to the feed evaluation responses.
   * @throws if the request fails.
   */
  async fetchSignaturesBatch(params: {
    recentHash?: string;
    feedConfigs: FeedRequestV1[];
    numSignatures?: number;
    useTimestamp?: boolean;
    useEd25519?: boolean;
    variableOverrides?: Record<string, string>;
  }): Promise<FetchSignaturesBatchResponse> {
    const {
      recentHash,
      feedConfigs,
      useTimestamp,
      numSignatures,
      variableOverrides,
    } = params;
    const encodedConfigs = feedConfigs.map(config => {
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
      variableOverrides,
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
   * @param variableOverrides Optional variable overrides for task execution (e.g., {"API_KEY": "custom-key"})
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
    variableOverrides?: Record<string, string>;
  }): Promise<FetchSignaturesBatchResponse> {
    type BatchFeedRequests = {
      jobs_b64_encoded: string[];
      max_variance: number;
      min_responses: number;
      use_timestamp: boolean;
    }[];

    const { recentHash, encodedConfigs, numSignatures } = params;
    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures_batch`;
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const body = {
      api_version: '1.0.0',
      num_oracles: numSignatures,
      recent_hash: recentHash ?? bs58.encode(Buffer.alloc(32, 0)),
      signature_scheme: 'Secp256k1',
      hash_scheme: 'Sha256',
      feed_requests: [] as BatchFeedRequests,
      variable_overrides: params.variableOverrides ?? {},
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
      const resp = await axiosClient()(url, { method, headers, data });
      return resp.data;
    } catch (err) {
      console.error('fetchSignaturesFromEncodedBatch error', err);
      throw err;
    }
  }

  /**
   * Fetches signatures using consensus mechanism
   * REST API endpoint: /api/v1/fetch_signatures_consensus
   *
   * @param feedConfigs Array of feed configurations to fetch signatures for.
   * @param useTimestamp Whether to use the timestamp in the response & to encode update signature.
   * @param numSignatures The number of oracles to fetch signatures from.
   * @param useEd25519 Whether to use Ed25519 signatures instead of secp256k1.
   * @param variableOverrides Optional variable overrides for task execution (e.g., {"API_KEY": "custom-key"})
   * @returns A promise that resolves to the consensus response.
   * @throws if the request fails.
   */
  async fetchSignaturesConsensus(params: {
    feedConfigs: FeedRequest[];
    useTimestamp?: boolean;
    numSignatures?: number;
    useEd25519?: boolean;
    variableOverrides?: Record<string, string>;
  }): Promise<FetchSignaturesConsensusResponse> {
    const { feedConfigs } = params;

    const isV1 = feedConfigs.every(config => 'jobs' in config);
    const isV2 = feedConfigs.every(config => 'feed' in config);

    if (!isV1 && !isV2) {
      throw new Error(
        '[Switchboard] Malformed input: feedConfigs must be either FeedRequestV1 or FeedRequestV2'
      );
    }

    const feedRequests = isV1
      ? feedConfigs.map(config => ({
          jobs_b64_encoded: encodeJobs(config.jobs),
          max_variance: Math.floor(Number(config.maxVariance ?? 1) * 1e9),
          min_responses: config.minResponses ?? 1,
        }))
      : feedConfigs.map(config => ({
          feed_proto_b64: OracleFeedUtils.serializeOracleFeed(
            config.feed
          ).toString('base64'),
        }));

    // if numSignatures is provided, use it, otherwise use the max of the minOracleSamples for each feed (or 1 for v1)
    const numOracles =
      params.numSignatures ??
      (isV2
        ? Math.max(...feedConfigs.map(fc => fc.feed.minOracleSamples ?? 1))
        : 1);

    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures_consensus`;
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const useEd25519 = params.useEd25519 ?? false;
    const data = JSON.stringify({
      api_version: '1.0.0',
      recent_hash: '',
      signature_scheme: useEd25519 ? 'Ed25519' : 'Secp256k1',
      hash_scheme: 'Sha256',
      feed_requests: feedRequests,
      num_oracles: numOracles,
      use_timestamp: params.useTimestamp ?? false,
      use_ed25519: useEd25519,
      variable_overrides: params.variableOverrides ?? {},
    });

    try {
      const resp = await axiosClient()(url, { method, headers, data });
      return resp.data;
    } catch (err) {
      console.error('fetchSignaturesConsensus error', err);
      throw err;
    }
  }

  /**
   * Fetches oracle quote data from the gateway
   *
   * This method retrieves signed price quotes from oracle operators through
   * the gateway interface. It's the primary method for fetching oracle data
   * using the modern quote terminology.
   *
   * ## Protocol Details
   * - Uses Ed25519 signature scheme for efficient verification
   * - Supports both protobuf and legacy job specifications
   * - Implements consensus mechanism across multiple oracles
   * - Returns structured response with oracle metadata
   *
   * ## Response Structure
   * The returned response contains:
   * - `oracle_responses`: Array of signed oracle data
   * - `recent_hash`: Recent Solana block hash for replay protection
   * - `slot`: Recent slot number for temporal validation
   *
   * @param {CrossbarClient} crossbar - Crossbar client for data routing and feed resolution
   * @param {string[]} feedHashes - Array of feed hashes to fetch (hex strings, max 16)
   * @param {number} numSignatures - Number of oracle signatures required (default: 1, max based on queue config)
   * @returns {Promise<FetchSignaturesConsensusResponse>} Oracle quote response with signatures
   *
   * @throws {Error} When gateway is unreachable or returns error
   * @throws {Error} When crossbar cannot resolve feed hashes
   * @throws {Error} When insufficient oracles are available
   *
   * @since 2.14.0
   * @see {@link fetchUpdateBundle} - Deprecated equivalent method
   * @see {@link Queue.fetchQuoteIx} - High-level method that uses this internally
   *
   * @example
   * ```typescript
   * import { CrossbarClient } from '@switchboard-xyz/common';
   *
   * // Initialize crossbar client
   * const crossbar = CrossbarClient.default();
   *
   * // Single feed quote
   * const btcQuote = await gateway.fetchQuote(
   *   crossbar,
   *   ['0xef0d8b6fcd0104e3e75096912fc8e1e432893da4f18faedaacca7e5875da620f'], // BTC/USD
   *   1 // Single signature for fast updates
   * );
   *
   * // Multi-feed quote for DeFi protocol
   * const defiAssets = [
   *   '0xef0d8b6fcd0104e3e75096912fc8e1e432893da4f18faedaacca7e5875da620f', // BTC/USD
   *   '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', // ETH/USD
   *   '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', // SOL/USD
   *   '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba'  // USDC/USD
   * ];
   *
   * const portfolioQuote = await gateway.fetchQuote(
   *   crossbar,
   *   defiAssets,
   *   5 // Higher consensus for financial operations
   * );
   *
   * // Access oracle responses
   * console.log('Oracle responses:', portfolioQuote.oracle_responses.length);
   * console.log('Recent slot:', portfolioQuote.slot);
   *
   * // Process individual feed responses
   * portfolioQuote.oracle_responses.forEach((oracle, index) => {
   *   oracle.feed_responses.forEach((feed, feedIndex) => {
   *     console.log(`Oracle ${index}, Feed ${feedIndex}:`, {
   *       feedHash: feed.feed_hash,
   *       value: feed.success_value,
   *       confidence: feed.min_oracle_samples
   *     });
   *   });
   * });
   * ```
   */
  async fetchQuote(
    crossbar: CrossbarClient,
    feedHashes: string[],
    numSignatures: number = 1,
    variableOverrides?: Record<string, string>
  ): Promise<FetchSignaturesConsensusResponse> {
    const feedRequests = await Promise.all(
      feedHashes.map(async hash => {
        try {
          const ipfsData = await crossbar.fetchOracleFeed(hash);
          return {
            feed_proto_b64: ipfsData.data,
          };
        } catch {
          console.warn('Using fallback v1 fetch for feed', hash);
          const { jobs } = await crossbar.fetch(hash);
          return {
            jobs_b64_encoded: encodeJobs(jobs),
            max_variance: 1e9, // default to 1% variance
            min_responses: 1, // default to 1 job response
            min_oracles: 1, // default to 1 oracle response
          };
        }
      })
    );

    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures_consensus`;
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const data = JSON.stringify({
      api_version: '1.0.0',
      signature_scheme: 'Ed25519',
      hash_scheme: 'Sha256',
      feed_requests: feedRequests,
      recent_hash: '',
      num_oracles: numSignatures,
      use_ed25519: true,
      variable_overrides: variableOverrides ?? {},
    });

    try {
      const resp = await axiosClient()(url, { method, headers, data });
      return resp.data;
    } catch (err) {
      console.error('fetchQuote error', err);
      throw err;
    }
  }

  /**
   * @deprecated Use {@link fetchQuote} instead. The bundle terminology has been replaced with quote terminology.
   *
   * Fetches oracle bundle data from the gateway
   */
  async fetchUpdateBundle(
    crossbar: CrossbarClient,
    feedHashes: string[],
    numSignatures: number = 1
  ): Promise<FetchSignaturesConsensusResponse> {
    return this.fetchQuote(crossbar, feedHashes, numSignatures);
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
    const method = 'POST';
    const headers = { 'Content-Type': 'application/json' };
    const body = {
      api_version: '1.0.0',
      chain_hash: params.chainHash,
      oracle_pubkey: params.oraclePubkey,
      queue_pubkey: params.queuePubkey,
    };
    const data = JSON.stringify(body);
    const resp = await axiosClient()(url, { method, headers, data });
    return resp.data;
  }

  /**
   * Fetches the randomness reveal from the gateway.
   * @param params The parameters for the randomness reveal.
   * @returns The randomness reveal response.
   */
  async fetchRandomnessReveal(
    params:
      | {
          randomnessAccount: web3.PublicKey;
          slothash: string;
          slot: number;
          rpc?: string;
        }
      | {
          randomnessId: string;
          timestamp: number;
          minStalenessSeconds: number;
        }
  ): Promise<RandomnessRevealResponse> {
    const url = `${this.gatewayUrl}/gateway/api/v1/randomness_reveal`;
    const method = 'POST';
    const responseType = 'text';
    const headers = { 'Content-Type': 'application/json' };

    // Handle Solana and Cross-Chain Randomness
    let data: string;
    if ('slot' in params) {
      // Solana Randomness
      data = JSON.stringify({
        slothash: [...bs58.decode(params.slothash)],
        randomness_key: params.randomnessAccount.toBuffer().toString('hex'),
        slot: params.slot,
        rpc: params.rpc,
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
      console.error('fetchRandomnessReveal error', err);
      throw err;
    }
  }

  async test(): Promise<boolean> {
    const url = `${this.gatewayUrl}/gateway/api/v1/test`;
    const cachedResponse = GATEWAY_PING_CACHE.get(this.gatewayUrl);
    if (cachedResponse !== undefined) return cachedResponse;

    try {
      const txt = await axiosClient()(url);
      if (txt.data.length !== 0) {
        GATEWAY_PING_CACHE.set(this.gatewayUrl, true);
        return true;
      }
    } catch {} // eslint-disable-line no-empty
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
    return hint === 'string' ? `Gateway: ${this.toString()}` : null;
  }
}
