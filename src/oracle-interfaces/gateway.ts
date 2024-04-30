import type * as anchor from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/common";
import * as bs58 from "bs58";

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
  value: string;
};

/**
 *  base64 encodes an array of oracle jobs. to send to a gateway
 */
function encodeJobs(jobArray: OracleJob[]): string[] {
  return jobArray.map((job) =>
    Buffer.from(OracleJob.encodeDelimited(job).finish()).toString("base64")
  );
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
  constructor(readonly program: anchor.Program, readonly gatewayUrl: string) {}

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
  }): Promise<FeedEvalResponse[]> {
    // TODO: have total NumOracles count against rate limit per IP
    const { recentHash, encodedJobs, numSignatures } = params;
    const url = `${this.gatewayUrl}/gateway/api/v1/fetch_signatures`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const maxVariance = Math.floor((params.maxVariance ?? 1) * 1e9);
    const body = JSON.stringify({
      api_version: "1.0.0",
      jobs_b64_encoded: encodedJobs,
      recent_chainhash: recentHash ?? bs58.encode(Buffer.alloc(32, 0)),
      signature_scheme: "Secp256k1",
      hash_scheme: "Sha256",
      num_oracles: numSignatures,
      max_variance: maxVariance,
      min_responses: params.minResponses,
    });
    return fetch(url, { method, headers, body })
      .then((r) => r.json())
      .then((r) => r.responses);
  }

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
   *  @returns A promise that resolves to the feed evaluation responses.
   *  @throws if the request fails.
   */
  async fetchSignatures(params: {
    recentHash?: string;
    jobs: OracleJob[];
    numSignatures?: number;
    maxVariance?: number;
    minResponses?: number;
  }): Promise<FeedEvalResponse[]> {
    params.numSignatures = params.numSignatures ?? 1;
    params.maxVariance = params.maxVariance ?? 1;
    params.minResponses = params.minResponses ?? 1;
    const { recentHash, jobs, numSignatures, maxVariance, minResponses } =
      params;
    const encodedJobs = encodeJobs(jobs);
    const res = await this.fetchSignaturesFromEncoded({
      recentHash,
      encodedJobs,
      numSignatures,
      maxVariance,
      minResponses,
    });
    return res;
  }

  async fetchRandomnessReveal(params: {
    randomnessAccount: PublicKey;
    slothash: string;
    slot: number;
  }): Promise<RandomnessRevealResponse> {
    const url = `${this.gatewayUrl}/gateway/api/v1/randomness_reveal`;
    const method = "POST";
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({
      slothash: [...bs58.decode(params.slothash)],
      randomness_key: params.randomnessAccount.toBuffer().toString("hex"),
      slot: params.slot,
    });
    try {
      const response = await fetch(url, { method, headers, body });
      const txtResponse = await response.text();
      return JSON.parse(txtResponse);
    } catch (err) {
      console.error("fetchRandomnessReveal error", err);
      throw err;
    }
  }

  async test(): Promise<boolean> {
    const url = `${this.gatewayUrl}/gateway/api/v1/test`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      await response.text();
      return true;
    } catch {}
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
