"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRandomnessRevealHexString = exports.createV0AttestationHexString = exports.createAttestationHexString = exports.createUpdateHexString = void 0;
/**
 * Create an EVM-serializable update message
 * @param param0 - UpdateHexStringParams: Components for an EVM update message
 * @returns hex string
 */
function createUpdateHexString({ feedId, discriminator, result, blockNumber, r, s, v, timestamp, }) {
    const discriminatorHex = discriminator.toString(16).padStart(2, "0");
    const resultHex = BigInt(result).toString(16).padStart(32, "0");
    const blockNumberHex = BigInt(blockNumber).toString(16).padStart(16, "0");
    const vHex = v.toString(16).padStart(2, "0");
    const timestampHex = timestamp
        ? BigInt(timestamp).toString(16).padStart(16, "0")
        : "";
    return `0x${discriminatorHex}${feedId}${resultHex}${r}${s}${vHex}${blockNumberHex}${timestampHex}`;
}
exports.createUpdateHexString = createUpdateHexString;
/**
 * Create an EVM-serializable attestation message
 * @param param0 - AttestationHexStringParams: Components for an EVM attestation message
 * @returns hex string
 */
function createAttestationHexString({ discriminator, oracleId, queueId, timestamp, secp256k1Key, r, s, v, blockNumber, mrEnclave, guardianId, }) {
    const discriminatorHex = discriminator.toString(16).padStart(2, "0");
    const blockNumberHex = BigInt(blockNumber).toString(16).padStart(16, "0");
    const timestampHex = BigInt(timestamp).toString(16).padStart(16, "0");
    const vHex = v.toString(16).padStart(2, "0");
    return `0x${discriminatorHex}${oracleId}${queueId}${mrEnclave}${secp256k1Key}${blockNumberHex}${r}${s}${vHex}${timestampHex}${guardianId}`;
}
exports.createAttestationHexString = createAttestationHexString;
/**
 * Create an EVM-serializable attestation message
 * @param param0 - AttestationHexStringParams: Components for an EVM attestation message
 * @returns hex string
 */
function createV0AttestationHexString({ discriminator, oracleId, queueId, ed25519Key, secp256k1Key, r, s, v, blockNumber, mrEnclave, }) {
    const discriminatorHex = discriminator.toString(16).padStart(2, "0");
    const blockNumberHex = BigInt(blockNumber).toString(16).padStart(16, "0");
    const vHex = v.toString(16).padStart(2, "0");
    return `0x${discriminatorHex}${oracleId}${queueId}${mrEnclave}${ed25519Key}${secp256k1Key}${blockNumberHex}${r}${s}${vHex}`;
}
exports.createV0AttestationHexString = createV0AttestationHexString;
/**
 * Create an EVM-serializable randomness reveal message
 * @param param0 - RandomnessRevealHexStringParams: Components for an EVM randomness reveal message
 * @returns hex string
 */
function createRandomnessRevealHexString({ discriminator, randomnessId, result, r, s, v, }) {
    const discriminatorHex = discriminator.toString(16).padStart(2, "0");
    const vHex = v.toString(16).padStart(2, "0");
    return `0x${discriminatorHex}${randomnessId}${result}${r}${s}${vHex}`;
}
exports.createRandomnessRevealHexString = createRandomnessRevealHexString;
//# sourceMappingURL=message.js.map