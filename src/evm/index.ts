import { Queue } from "../accounts/index.js";
import type {
  BridgeEnclaveResponse,
  FeedEvalResponse,
  Gateway,
} from "../oracle-interfaces/index.js";
import {
  ON_DEMAND_DEVNET_GUARDIAN_QUEUE,
  ON_DEMAND_DEVNET_PID,
  ON_DEMAND_DEVNET_QUEUE,
  ON_DEMAND_MAINNET_GUARDIAN_QUEUE,
  ON_DEMAND_MAINNET_PID,
  ON_DEMAND_MAINNET_QUEUE,
} from "../utils/index.js";

import {
  createAttestationHexString,
  createUpdateHexString,
  createV0AttestationHexString,
} from "./message.js";

import NodeWallet from "@coral-xyz/anchor-30/dist/cjs/nodewallet.js";
export * as message from "./message.js";
import * as anchor from "@coral-xyz/anchor-30";
import { Big, OracleJob } from "@switchboard-xyz/common";
import * as bs58 from "bs58";

// Common options for feed updates
export interface FeedUpdateCommonOptions {
  jobs: OracleJob[]; // Array of job definitions
  numSignatures?: number; // Number of signatures to fetch
  maxVariance?: number; // Maximum variance allowed for the feed
  minResponses?: number; // Minimum number of responses to consider the feed valid
  recentHash?: string; // Hex string of length 64 (32 bytes) which does not start with 0x
  aggregatorId?: string; // Specify the aggregator ID if the feed already exists
  blockNumber?: number; // The block number
  gateway?: Gateway; // Gateway (optional)
}

// Define a type for the input parameters
export type FeedUpdateParams = FeedUpdateCommonOptions;

// Attestation options
export interface AttestationOptions {
  guardianQueue: Queue; // The guardian queue account
  recentHash: string; // The blockhash to get the attestation for
  blockNumber: number; // The timestamp
  queueId: string; // The queue ID (queue pubkey as hex)
  oracleId: string; // The oracle ID (oracle pubkey as hex)
  gateway?: Gateway; // The gateway account (optional)
}

// Feed simulation result
export interface FeedSimulateResult {
  result: number;
  feedId: string;
  response: FeedEvalResponse;
}

// Feed update result
export interface FeedUpdateResult {
  feedId: string;
  result: number;
  encoded: string;
  response: FeedEvalResponse;
}

// Attestation result
export interface AttestationResult {
  oracleId: string; // Attestee oracle pubkey as hex
  queueId: string; // Attestee queue pubkey as hex
  guardian: string; // Guardian pubkey as hex
  encoded: string; // The attestation as a hex string
  response: BridgeEnclaveResponse; // The attestation response from guardian
}

// Fetch feed response
export interface FetchFeedResponse {
  results: FeedEvalResponse[];
  encoded: string[];
}

// Fetch result response
export interface FetchResultResponse extends FetchFeedResponse {
  feedId: string;
}

// Fetch results response
export interface FetchResultsArgs {
  feedIds: string[];
  chainId: number;
  crossbarUrl?: string;
  minResponses?: number;
  maxVariance?: number;
  numSignatures?: number;
  syncOracles?: boolean;
  syncGuardians?: boolean;
  gateway?: string;
}

// Fetch result args
export interface FetchResultArgs {
  feedId: string;
  chainId: number;
  crossbarUrl?: string;
  minResponses?: number;
  maxVariance?: number;
  numSignatures?: number;
  syncOracles?: boolean;
  syncGuardians?: boolean;
  gateway?: string;
}

// Feed evaluation response
export interface FetchRandomnessArgs {
  chainId: number;
  crossbarUrl: string;
  randomnessId: string;
  timestamp?: number;
  minStalenessSeconds?: number;
}

/**
 * Get an oracle job from object definition
 * @param params the job parameters
 * @returns
 */
export function createJob(params: { tasks: any }): OracleJob {
  return OracleJob.fromObject(params);
}

/**
 * Get the feed update data for a particular feed
 * @dev - this function is heavily rate limited
 * @param params the feed update parameters
 * @param queue the queue account
 * @returns the feed simulation result and feed id
 */
export async function simulateFeed(
  params: FeedUpdateParams,
  queue: Queue
): Promise<FeedSimulateResult> {
  const gateway = params.gateway ?? (await queue.fetchGateway());
  const result = (
    await gateway.fetchSignatures({
      ...params,
      useTimestamp: true,
      recentHash: bs58.encode(
        Buffer.from(params.recentHash ?? "0".repeat(64), "hex")
      ),
    })
  ).responses[0];

  return {
    result: new Big(result.success_value).div(new Big(10).pow(18)).toNumber(),
    feedId: result.feed_hash,
    response: result,
  };
}

/**
 * Get the feed update data for a particular feed
 * @param params the feed update parameters
 * @param queue the queue account
 * @returns the feed update data, the byte arrays that need to be sent to the target chain
 */
export async function getFeedUpdateData(
  params: FeedUpdateParams,
  queue: Queue
): Promise<string[]> {
  return (await getFeedUpdateWithContext(params, queue)).responses.map(
    (r) => r.encoded
  );
}

/**
 * Get the feed update data for a particular feed
 * @param params the feed update parameters
 * @param queue the queue account
 * @returns the feed update data with context (numeric result data, oracle response, AND encoded response)
 */
export async function getFeedUpdateWithContext(
  params: FeedUpdateParams,
  queue: Queue
): Promise<{
  responses: FeedUpdateResult[];
  failures: string[];
}> {
  // Set the blockhash
  const blockhash = params.recentHash ?? "0".repeat(64);

  // if we just want the time feed, return
  if (params.jobs.length === 0) {
    {
      return {
        responses: [],
        failures: [],
      };
    }
  }

  // Get the Feed Update if the feed exists
  // Setup the updates array
  const updates = await getUpdate(
    {
      ...params,
      recentHash: blockhash,
    },
    queue
  );

  return updates;
}

/**
 * Get the update message for the EVM for a particular feed
 * This is useful for feeds that have already been created on chain
 * @param params - FeedUpdateCommonOptions: Parameters for the upsert message
 * @param queue - Queue: The queue account
 * @returns - Promise<string> - The update message as a hex string
 */
export async function getUpdate(
  params: FeedUpdateCommonOptions,
  queue: Queue
): Promise<{
  responses: FeedUpdateResult[];
  failures: string[];
}> {
  if (!params.recentHash) {
    params.recentHash = "0".repeat(64);
  }

  // slice if the recentHash starts with 0x
  if (params.recentHash.startsWith("0x")) {
    params.recentHash = params.recentHash.slice(2);
  }

  const gateway = params.gateway ?? (await queue.fetchGateway());

  const { responses, failures } = await gateway.fetchSignatures({
    ...params,
    useTimestamp: true,
    recentHash: bs58.encode(Buffer.from(params.recentHash, "hex")),
  });
  const response: FeedUpdateResult[] = [];

  for (const result of responses) {
    if (!result.success_value) {
      failures.push(result.failure_error.toString());
      continue;
    }

    // Decode from Base64 to a Buffer
    const signatureBuffer = new Uint8Array(
      Buffer.from(result.signature, "base64")
    );

    // Assuming each component (r and s) is 32 bytes long
    const r = Buffer.from(signatureBuffer.slice(0, 32)).toString("hex");
    const s = Buffer.from(signatureBuffer.slice(32, 64)).toString("hex");
    const v = result.recovery_id;

    // Create the upsert message
    const updateString = createUpdateHexString({
      discriminator: 1,
      feedId: params.aggregatorId ?? result.feed_hash.toString(),
      result: result.success_value.toString(),
      blockNumber: params.blockNumber?.toString() ?? "0",
      timestamp: result.timestamp?.toString(),
      r,
      s,
      v,
    });

    // Add the response to the array
    const res = {
      feedId: result.feed_hash,
      result: new Big(result.success_value).div(new Big(10).pow(18)).toNumber(),
      encoded: updateString,
      response: result,
    };

    // Add the response to the array
    response.push(res);
  }

  // Sort the response by timestamp, ascending
  response.sort((a, b) => a.response.timestamp - b.response.timestamp);

  // Return the response
  return {
    responses: response,
    failures,
  };
}

/**
 * Get attestation for a particular oracle on a particular queue
 * @param options - AttestationOptions: Options for the attestation
 * @returns - Promise<string> - The attestation as a hex string
 */
export async function getAttestation(
  options: AttestationOptions
): Promise<AttestationResult> {
  const { guardianQueue, recentHash, queueId, oracleId, gateway, blockNumber } =
    options;
  const gatewayAccount = gateway ?? (await guardianQueue.fetchGateway());
  const chainHash = recentHash.startsWith("0x")
    ? recentHash.slice(2)
    : recentHash;
  const attestation = await gatewayAccount.fetchBridgingMessage({
    chainHash,
    queuePubkey: queueId,
    oraclePubkey: oracleId,
  });

  if (!options.recentHash) {
    options.recentHash = "0".repeat(64);
  }

  // slice if the recentHash starts with 0x
  if (options.recentHash.startsWith("0x")) {
    options.recentHash = options.recentHash.slice(2);
  }

  // Decode from Base64 to a Buffer
  const signatureBuffer = new Uint8Array(
    Buffer.from(attestation.signature, "base64")
  );

  // Assuming each component (r and s) is 32 bytes long
  const r = Buffer.from(signatureBuffer.slice(0, 32)).toString("hex");
  const s = Buffer.from(signatureBuffer.slice(32, 64)).toString("hex");
  const v = attestation.recovery_id;

  // Create the attestation bassed on message contents (it'll either be v0 or ordinary)
  if (attestation.oracle_ed25519_enclave_signer) {
    const hexString = createV0AttestationHexString({
      discriminator: 2,
      oracleId,
      queueId,
      ed25519Key: attestation.oracle_ed25519_enclave_signer,
      secp256k1Key: attestation.oracle_secp256k1_enclave_signer,
      r,
      s,
      v,
      mrEnclave: attestation.mr_enclave,
      blockNumber: blockNumber.toString(),
    });

    return {
      oracleId,
      queueId,
      guardian: attestation.guardian,
      encoded: hexString,
      response: attestation,
    };
  } else if (attestation.timestamp) {
    const hexString = createAttestationHexString({
      discriminator: 2,
      oracleId,
      queueId,
      secp256k1Key: attestation.oracle_secp256k1_enclave_signer,
      timestamp: attestation.timestamp.toString(),
      mrEnclave: attestation.mr_enclave,
      r,
      s,
      v,
      blockNumber: blockNumber.toString(),
      guardianId: attestation.guardian,
    });

    return {
      oracleId: attestation.oracle,
      queueId: attestation.queue,
      guardian: attestation.guardian,
      encoded: hexString,
      response: attestation,
    };
  } else {
    throw new Error("Invalid attestation response");
  }
}

/**
 * Get the default devnet queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default devnet queue
 */
export async function getDefaultDevnetQueue(
  solanaRPCUrl: string = "https://api.devnet.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_DEVNET_PID.toString(),
    ON_DEMAND_DEVNET_QUEUE.toString()
  );
}

/**
 * Get the default devnet guardian queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default devnet guardian queue
 */
export async function getDefaultDevnetGuardianQueue(
  solanaRPCUrl: string = "https://api.devnet.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_DEVNET_PID.toString(),
    ON_DEMAND_DEVNET_GUARDIAN_QUEUE.toString()
  );
}

/**
 * Get the default queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default queue
 * @NOTE - SWITCHBOARD PID AND QUEUE PUBKEY ARE WRONG
 */
export async function getDefaultQueue(
  solanaRPCUrl: string = "https://api.mainnet-beta.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_MAINNET_PID.toString(),
    ON_DEMAND_MAINNET_QUEUE.toString()
  );
}

/**
 * Get the default guardian queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default guardian queue
 * @NOTE - SWITCHBOARD PID AND GUARDIAN QUEUE PUBKEY ARE WRONG
 */
export async function getDefaultGuardianQueue(
  solanaRPCUrl: string = "https://api.mainnet-beta.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_MAINNET_PID.toString(),
    ON_DEMAND_MAINNET_GUARDIAN_QUEUE.toString()
  );
}

/**
 * Get the queue for the Switchboard program
 * @param solanaRPCUrl - string: The Solana RPC URL
 * @param switchboardProgramId - string: The Switchboard program ID
 * @param queueAddress - string: The queue address
 * @returns - Promise<Queue> - The queue
 */
export async function getQueue(
  solanaRPCUrl: string,
  switchboardProgramId: string,
  queueAddress: string
): Promise<Queue> {
  const { PublicKey, Keypair, Connection } = anchor.web3;
  const wallet: NodeWallet = new NodeWallet(new Keypair());
  const connection = new Connection(solanaRPCUrl, "confirmed");
  const PID = new PublicKey(switchboardProgramId);
  const queue = new PublicKey(queueAddress);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  const idl = (await anchor.Program.fetchIdl(PID, provider))!;
  const program = new anchor.Program(idl, provider);
  const queueAccount = new Queue(program, queue);
  return queueAccount;
}

/**
 * Crossbar API for EVM
 */

/**
 * Fetch result from the Switchboard API
 * @param param0 The parameters to fetch results
 * @returns
 */
export async function fetchResult({
  feedId,
  chainId,
  crossbarUrl,
  minResponses,
  maxVariance,
  numSignatures,
  syncOracles,
  syncGuardians,
}: FetchResultArgs): Promise<FetchResultResponse> {
  if (!crossbarUrl) {
    crossbarUrl = "https://crossbar.switchboard.xyz";
  }
  return {
    feedId,
    ...(await fetchUpdateData(
      crossbarUrl,
      chainId.toString(),
      feedId,
      minResponses,
      maxVariance,
      numSignatures,
      syncOracles,
      syncGuardians
    )),
  };
}

/**
 * Fetch results from the Switchboard API
 * @param param0 The parameters to fetch results
 * @returns
 */
export async function fetchResults({
  feedIds,
  chainId,
  crossbarUrl,
  minResponses,
  maxVariance,
  numSignatures,
  syncOracles,
  syncGuardians,
}: FetchResultsArgs): Promise<FetchResultResponse[]> {
  if (!crossbarUrl) {
    crossbarUrl = "https://crossbar.switchboard.xyz";
  }

  const responses = await Promise.all(
    feedIds.map((feedId) => {
      return fetchUpdateData(
        crossbarUrl,
        chainId.toString(),
        feedId,
        minResponses,
        maxVariance,
        numSignatures,
        syncOracles,
        syncGuardians
      );
    })
  );

  return responses.map((response, index) => {
    return {
      feedId: feedIds[index],
      ...response,
    };
  });
}

/**
 * Fetch data to settle randomness
 * @param param0 The parameters to fetch randomness
 * @returns
 */
export async function fetchRandomness({
  chainId,
  crossbarUrl,
  randomnessId,
  timestamp,
  minStalenessSeconds,
}: FetchRandomnessArgs): Promise<{
  encoded: string;
  response: {
    signature: string;
    recovery_id: number;
    value: string;
  };
}> {
  if (!crossbarUrl) {
    crossbarUrl = "https://crossbar.switchboard.xyz";
  }

  return fetchRandomnessData(
    crossbarUrl,
    chainId.toString(),
    randomnessId,
    timestamp,
    minStalenessSeconds
  );
}

/**
 * Fetch update data from the Switchboard API
 * @param crossbarUrl The Crossbar URL
 * @param chainId The chain ID
 * @param feedId The feed ID
 * @param minResponses Minimum number of responses
 * @param maxVariance Maximum variance
 * @param numSignatures Number of signatures
 * @param syncOracles Sync oracles
 * @param syncGuardians Sync guardians
 * @param gateway Gateway
 * @returns
 */
async function fetchUpdateData(
  crossbarUrl: string,
  chainId: string,
  feedId: string,
  minResponses: number = 1,
  maxVariance: number = 1e9,
  numSignatures: number = 1,
  syncOracles: boolean = true,
  syncGuardians: boolean = true,
  gateway?: string
): Promise<FetchFeedResponse> {
  const cleanedCrossbarUrl = crossbarUrl.endsWith("/")
    ? crossbarUrl.slice(0, -1)
    : crossbarUrl;

  const url = new URL(`${cleanedCrossbarUrl}/updates/evm/${chainId}/${feedId}`);

  // Add query parameters to the URL
  if (minResponses !== undefined) {
    url.searchParams.append("minResponses", minResponses.toString());
  }
  if (maxVariance !== undefined) {
    url.searchParams.append("maxVariance", maxVariance.toString());
  }
  if (numSignatures !== undefined) {
    url.searchParams.append("numSignatures", numSignatures.toString());
  }
  if (syncOracles !== undefined) {
    url.searchParams.append("syncOracles", syncOracles.toString());
  }
  if (syncGuardians !== undefined) {
    url.searchParams.append("syncGuardians", syncGuardians.toString());
  }
  if (gateway !== undefined) {
    url.searchParams.append("gateway", gateway);
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Error fetching data: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching feed data:", error);
    throw error;
  }
}

/**
 * Fetch randomness data from the Switchboard API
 * @param chainId The chain ID
 * @param randomnessId The randomness ID configured on-chain
 * @param timestamp The timestamp that the randomness was configured at
 * @param minStalenessSeconds The minimum staleness of the data in seconds
 * @returns
 */
async function fetchRandomnessData(
  crossbarUrl: string,
  chainId: string,
  randomnessId: string,
  timestamp?: number,
  minStalenessSeconds?: number
): Promise<{
  encoded: string;
  response: {
    signature: string;
    recovery_id: number;
    value: string;
  };
}> {
  const cleanedCrossbarUrl = crossbarUrl.endsWith("/")
    ? crossbarUrl.slice(0, -1)
    : crossbarUrl;
  const url = new URL(
    `${cleanedCrossbarUrl}/randomness/evm/${chainId}/${randomnessId}`
  );

  // Add query parameters to the URL
  if (timestamp !== undefined) {
    url.searchParams.append("timestamp", timestamp.toString());
  }
  if (minStalenessSeconds !== undefined) {
    url.searchParams.append(
      "minStalenessSeconds",
      minStalenessSeconds.toString()
    );
  }

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`Error fetching data: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching randomness data:", error);
    throw error;
  }
}
