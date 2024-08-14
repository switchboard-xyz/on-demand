"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gateway = void 0;
const common_1 = require("@switchboard-xyz/common");
const axios_1 = __importDefault(require("axios"));
const bs58 = __importStar(require("bs58"));
const https_1 = require("https");
const node_cache_1 = __importDefault(require("node-cache"));
const GATEWAY_PING_CACHE = new node_cache_1.default({ stdTTL: 100, checkperiod: 120 });
function newAbortSignal(timeoutMs) {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), timeoutMs);
    return abortController.signal;
}
const httpsAgent = new https_1.Agent({
    rejectUnauthorized: false, // WARNING: This disables SSL/TLS certificate verification.
});
const TIMEOUT = 10000;
const axiosClient = (() => {
    let instance;
    return () => {
        if (!instance) {
            instance = axios_1.default.create({
                httpsAgent,
            });
        }
        return instance;
    };
})();
/**
 *  base64 encodes an array of oracle jobs. to send to a gateway
 */
function encodeJobs(jobArray) {
    return jobArray.map((job) => Buffer.from(common_1.OracleJob.encodeDelimited(job).finish()).toString("base64"));
}
/**
 *  The gateway class is used to interface with the switchboard gateway REST API.
 */
class Gateway {
    /**
     *  Constructs a `Gateway` instance.
     *
     *  @param program The Anchor program instance.
     *  @param gatewayUrl The URL of the switchboard gateway.
     */
    constructor(program, gatewayUrl, oracleKey) {
        this.program = program;
        this.gatewayUrl = gatewayUrl;
        this.oracleKey = oracleKey;
    }
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
    fetchSignaturesFromEncoded(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // TODO: have total NumOracles count against rate limit per IP
            const { recentHash, encodedJobs, numSignatures } = params;
            const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures`;
            const headers = { "Content-Type": "application/json" };
            const maxVariance = params.maxVariance * 1e9;
            const body = JSON.stringify({
                api_version: "1.0.0",
                jobs_b64_encoded: encodedJobs,
                recent_chainhash: recentHash !== null && recentHash !== void 0 ? recentHash : bs58.encode(Buffer.alloc(32, 0)),
                signature_scheme: "Secp256k1",
                hash_scheme: "Sha256",
                num_oracles: numSignatures,
                max_variance: maxVariance,
                min_responses: params.minResponses,
                use_timestamp: (_a = params.useTimestamp) !== null && _a !== void 0 ? _a : false,
            });
            return axiosClient()
                .post(url, body, {
                headers,
                timeout: TIMEOUT,
            })
                .then((r) => r.data);
        });
    }
    ping() {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `${this.gatewayUrl}/gateway/api/v1/ping`;
            const method = "POST";
            const headers = { "Content-Type": "application/json" };
            const body = JSON.stringify({ api_version: "1.0.0" });
            return axiosClient()
                .post(url, body, { method, headers, timeout: TIMEOUT })
                .then((r) => r.data);
        });
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
    fetchAttestation(params) {
        return __awaiter(this, void 0, void 0, function* () {
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
        });
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
    fetchQuote(params) {
        return __awaiter(this, void 0, void 0, function* () {
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
                .then((r) => __awaiter(this, void 0, void 0, function* () {
                return r.data;
            }));
        });
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
    fetchBridgingMessage(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const api_version = "1.0.0";
            const url = `${this.gatewayUrl}/gateway/api/v1/gateway_bridge_enclave`;
            const method = "POST";
            const headers = { "Content-Type": "application/json" };
            const body = JSON.stringify({
                api_version,
                chain_hash: params.chainHash,
                oracle_pubkey: params.oraclePubkey,
                queue_pubkey: params.queuePubkey,
            });
            return axiosClient()
                .post(url, body, { method, headers, timeout: TIMEOUT })
                .then((r) => {
                return r.data;
            });
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
    fetchSignatures(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            params.numSignatures = (_a = params.numSignatures) !== null && _a !== void 0 ? _a : 1;
            params.maxVariance = (_b = params.maxVariance) !== null && _b !== void 0 ? _b : 1;
            params.minResponses = (_c = params.minResponses) !== null && _c !== void 0 ? _c : 1;
            const { recentHash, jobs, numSignatures, maxVariance, minResponses, useTimestamp, } = params;
            const encodedJobs = encodeJobs(jobs);
            const res = yield this.fetchSignaturesFromEncoded({
                recentHash,
                encodedJobs,
                numSignatures,
                maxVariance,
                minResponses,
                useTimestamp,
            });
            return res;
        });
    }
    fetchSignaturesMulti(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const { recentHash, feedConfigs, useTimestamp, numSignatures } = params;
            const encodedConfigs = feedConfigs.map((config) => {
                var _a, _b;
                const encodedJobs = encodeJobs(config.jobs);
                return {
                    encodedJobs,
                    maxVariance: (_a = config.maxVariance) !== null && _a !== void 0 ? _a : 1,
                    minResponses: (_b = config.minResponses) !== null && _b !== void 0 ? _b : 1,
                };
            });
            const res = yield this.fetchSignaturesFromEncodedMulti({
                recentHash,
                encodedConfigs,
                numSignatures: numSignatures !== null && numSignatures !== void 0 ? numSignatures : 1,
                useTimestamp,
            });
            return res;
        });
    }
    fetchSignaturesFromEncodedMulti(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            // TODO: have total NumOracles count against rate limit per IP
            const { recentHash, encodedConfigs, numSignatures } = params;
            const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures_multi`;
            const method = "POST";
            const headers = { "Content-Type": "application/json" };
            const body = {
                api_version: "1.0.0",
                num_oracles: numSignatures,
                recent_hash: recentHash !== null && recentHash !== void 0 ? recentHash : bs58.encode(Buffer.alloc(32, 0)),
                signature_scheme: "Secp256k1",
                hash_scheme: "Sha256",
                feed_requests: [],
            };
            for (const config of encodedConfigs) {
                const maxVariance = Math.floor(Number((_a = config.maxVariance) !== null && _a !== void 0 ? _a : 1) * 1e9);
                body.feed_requests.push({
                    jobs_b64_encoded: config.encodedJobs,
                    max_variance: maxVariance,
                    min_responses: (_b = config.minResponses) !== null && _b !== void 0 ? _b : 1,
                    use_timestamp: (_c = params.useTimestamp) !== null && _c !== void 0 ? _c : false,
                });
            }
            const data = JSON.stringify(body);
            try {
                const resp = yield axiosClient()(url, { method, headers, data }).then((r) => r.data);
                return resp;
            }
            catch (err) {
                console.error("fetchSignaturesFromEncodedMulti error", err);
                throw err;
            }
        });
    }
    /**
     * Fetches the randomness reveal from the gateway.
     * @param params The parameters for the randomness reveal.
     * @returns The randomness reveal response.
     */
    fetchRandomnessReveal(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `${this.gatewayUrl}/gateway/api/v1/randomness_reveal`;
            const method = "POST";
            const responseType = "text";
            const headers = { "Content-Type": "application/json" };
            // Handle Solana and Cross-Chain Randomness
            let data;
            if ("slot" in params) {
                // Solana Randomness
                data = JSON.stringify({
                    slothash: [...bs58.decode(params.slothash)],
                    randomness_key: params.randomnessAccount.toBuffer().toString("hex"),
                    slot: params.slot,
                });
            }
            else {
                // Cross-chain randomness
                data = JSON.stringify({
                    timestamp: params.timestamp,
                    min_staleness_seconds: params.minStalenessSeconds,
                    randomness_key: params.randomnessId,
                });
            }
            try {
                const txtResponse = yield axiosClient()(url, {
                    method,
                    headers,
                    data,
                    responseType,
                });
                return JSON.parse(txtResponse.data);
            }
            catch (err) {
                console.error("fetchRandomnessReveal error", err);
                throw err;
            }
        });
    }
    test() {
        return __awaiter(this, void 0, void 0, function* () {
            const url = `${this.gatewayUrl}/gateway/api/v1/test`;
            const cachedResponse = GATEWAY_PING_CACHE.get(this.gatewayUrl);
            if (cachedResponse !== undefined) {
                return cachedResponse;
            }
            try {
                const txt = yield axiosClient()(url);
                if (txt.data.length !== 0) {
                    GATEWAY_PING_CACHE.set(this.gatewayUrl, true);
                    return true;
                }
            }
            catch (_a) { }
            GATEWAY_PING_CACHE.set(this.gatewayUrl, false);
            return false;
        });
    }
    endpoint() {
        return this.gatewayUrl;
    }
    toString() {
        return JSON.stringify({
            gatewayUrl: this.gatewayUrl,
            programId: this.program.programId.toBase58(),
        });
    }
    [Symbol.toPrimitive](hint) {
        if (hint === "string") {
            return `Gateway: ${this.toString()}`;
        }
        return null;
    }
}
exports.Gateway = Gateway;
//# sourceMappingURL=gateway.js.map