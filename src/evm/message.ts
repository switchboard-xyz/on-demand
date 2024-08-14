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
  secp256k1Key: string; // 64-byte secp256k1 key
  blockNumber: string; // 8-byte block number (u64 BE encoded)
  mrEnclave: string; // 32-byte mr enclave
  r: string; // 32-byte r value
  s: string; // 32-byte s value
  v: number; // 1-byte v value
  timestamp: string; // 8-byte timestamp (u64 BE encoded)
  guardianId: string; // 32-byte guardian id
};

// Components for an EVM attestation message
// This is for bridging new oracles onto the target chain
export type V0AttestationHexStringParams = {
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
  timestamp,
  secp256k1Key,
  r,
  s,
  v,
  blockNumber,
  mrEnclave,
  guardianId,
}: AttestationHexStringParams): string {
  const discriminatorHex = discriminator.toString(16).padStart(2, "0");
  const blockNumberHex = BigInt(blockNumber).toString(16).padStart(16, "0");
  const timestampHex = BigInt(timestamp).toString(16).padStart(16, "0");
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${discriminatorHex}${oracleId}${queueId}${mrEnclave}${secp256k1Key}${blockNumberHex}${r}${s}${vHex}${timestampHex}${guardianId}`;
}

/**
 * Create an EVM-serializable attestation message
 * @param param0 - AttestationHexStringParams: Components for an EVM attestation message
 * @returns hex string
 */
export function createV0AttestationHexString({
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
}: V0AttestationHexStringParams): string {
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
  discriminator,
  randomnessId,
  result,
  r,
  s,
  v,
}: RandomnessRevealHexStringParams): string {
  const discriminatorHex = discriminator.toString(16).padStart(2, "0");
  const vHex = v.toString(16).padStart(2, "0");
  return `0x${discriminatorHex}${randomnessId}${result}${r}${s}${vHex}`;
}
