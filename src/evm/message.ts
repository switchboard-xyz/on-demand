// Components for an EVM upsert message
// This is for creating a new feed (or updating an existing one)
export type UpsertHexStringParams = {
  discriminator: 0; // 0 for upsert
  feedId: string; // 32-byte feed id
  queue: string; // 32-byte queue id
  result: string; // 16-byte result (i128 BE encoded)
  maxVariance: string; // 8-byte max variance (u64 BE encoded)
  minResponses: string; // 4-byte min responses (u32 BE encoded)
  blockNumber: string; // 8-byte block number (u64 BE encoded)
  timestamp?: string; // 8-byte timestamp (u64 BE encoded)
  r: string; // 32-byte r value
  s: string; // 32-byte s value
  v: number; // 1-byte v value
};

// Components for an EVM update message
// This is for updating an existing feed
export type UpdateHexStringParams = {
  discriminator: 1; // 1 for update, 3 for update with snapshot
  feedId: string; // 32-byte feed id
  result: string; // 16-byte result (i128 BE encoded)
  blockNumber: string; // 8-byte block number (u64 BE encoded)
  timestamp?: string; // 8-byte timestamp (u64 BE encoded)
  r: string; // 32-byte r value
  s: string; // 32-byte s value
  v: number; // 1-byte v value
};

// Components for an EVM attestation message
// This is for bridging new oracles onto the target chain
export type AttestationHexStringParams = {
  discriminator: 2; // 2 for attestation
  oracleId: string; // 32-byte oracle id
  queueId: string; // 32-byte queue id
  ed25519Key: string; // 32-byte ed25519 key
  secp256k1Key: string; // 64-byte secp256k1 key
  blockNumber: string; // 8-byte block number (u64 BE encoded)
  mrEnclave: string; // 32-byte mr enclave
  r: string; // 32-byte r value
  s: string; // 32-byte s value
  v: number; // 1-byte v value
};

// Components for an EVM randomness reveal message
// This is for revealing randomness
export type RandomnessRevealHexStringParams = {
  discriminator: 4; // 4 for randomness reveal
  randomnessId: string; // 32-byte randomness id
  result: string; // 32-byte result
  r: string; // 32-byte r value
  s: string; // 32-byte s value
  v: number; // 1-byte v value
};

/**
 * Create an EVM-serializable upsert message
 * @param param0 - UpsertHexStringParams: Components for an EVM upsert message
 * @returns hex string
 */
export function createUpsertHexString({
  discriminator,
  feedId,
  queue,
  result,
  maxVariance,
  minResponses,
  blockNumber,
  r,
  s,
  v,
  timestamp,
}: UpsertHexStringParams): string {
  // Convert numerical values to hex, ensuring proper length
  const discriminatorHex = discriminator.toString(16).padStart(2, "0");
  const resultHex = BigInt(result).toString(16).padStart(32, "0");
  const maxVarianceHex = BigInt(maxVariance).toString(16).padStart(16, "0");
  const minResponsesHex = BigInt(minResponses).toString(16).padStart(8, "0");
  const blockNumberHex = BigInt(blockNumber).toString(16).padStart(16, "0");
  const vHex = v.toString(16).padStart(2, "0");
  const timestampHex = timestamp
    ? BigInt(timestamp).toString(16).padStart(16, "0")
    : "";
  return `0x${discriminatorHex}${feedId}${queue}${resultHex}${maxVarianceHex}${minResponsesHex}${blockNumberHex}${r}${s}${vHex}${timestampHex}`;
}

/**
 * Create an EVM-serializable update message
 * @param param0 - UpdateHexStringParams: Components for an EVM update message
 * @returns hex string
 */
export function createUpdateHexString({
  feedId,
  discriminator,
  result,
  blockNumber,
  r,
  s,
  v,
  timestamp,
}: UpdateHexStringParams): string {
  const discriminatorHex = discriminator.toString(16).padStart(2, "0");
  const resultHex = BigInt(result).toString(16).padStart(32, "0");
  const blockNumberHex = BigInt(blockNumber).toString(16).padStart(16, "0");
  const vHex = v.toString(16).padStart(2, "0");
  const timestampHex = timestamp
    ? BigInt(timestamp).toString(16).padStart(16, "0")
    : "";
  return `0x${discriminatorHex}${feedId}${resultHex}${r}${s}${vHex}${blockNumberHex}${timestampHex}`;
}

/**
 * Create an EVM-serializable attestation message
 * @param param0 - AttestationHexStringParams: Components for an EVM attestation message
 * @returns hex string
 */
export function createAttestationHexString({
  discriminator,
  oracleId,
  queueId,
  ed25519Key,
  secp256k1Key,
  r,
  s,
  v,
  blockNumber,
  mrEnclave,
}: AttestationHexStringParams): string {
  const discriminatorHex = discriminator.toString(16).padStart(2, "0");
  const blockNumberHex = BigInt(blockNumber).toString(16).padStart(16, "0");
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${discriminatorHex}${oracleId}${queueId}${mrEnclave}${ed25519Key}${secp256k1Key}${blockNumberHex}${r}${s}${vHex}`;
}

/**
 * Create an EVM-serializable randomness reveal message
 * @param param0 - RandomnessRevealHexStringParams: Components for an EVM randomness reveal message
 * @returns hex string
 */
export function createRandomnessRevealHexString({
  randomnessId,
  result,
  r,
  s,
  v,
}: RandomnessRevealHexStringParams): string {
  const discriminator = 4;
  const discriminatorHex = discriminator.toString(16).padStart(2, "0");
  return `0x${discriminatorHex}${randomnessId}${result}${r}${s}${v}`;
}
