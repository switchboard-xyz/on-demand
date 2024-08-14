export type UpdateHexStringParams = {
    discriminator: 1;
    feedId: string;
    result: string;
    blockNumber: string;
    timestamp?: string;
    r: string;
    s: string;
    v: number;
};
export type AttestationHexStringParams = {
    discriminator: 2;
    oracleId: string;
    queueId: string;
    secp256k1Key: string;
    blockNumber: string;
    mrEnclave: string;
    r: string;
    s: string;
    v: number;
    timestamp: string;
    guardianId: string;
};
export type V0AttestationHexStringParams = {
    discriminator: 2;
    oracleId: string;
    queueId: string;
    ed25519Key: string;
    secp256k1Key: string;
    blockNumber: string;
    mrEnclave: string;
    r: string;
    s: string;
    v: number;
};
export type RandomnessRevealHexStringParams = {
    discriminator: 4;
    randomnessId: string;
    result: string;
    r: string;
    s: string;
    v: number;
};
/**
 * Create an EVM-serializable update message
 * @param param0 - UpdateHexStringParams: Components for an EVM update message
 * @returns hex string
 */
export declare function createUpdateHexString({ feedId, discriminator, result, blockNumber, r, s, v, timestamp, }: UpdateHexStringParams): string;
/**
 * Create an EVM-serializable attestation message
 * @param param0 - AttestationHexStringParams: Components for an EVM attestation message
 * @returns hex string
 */
export declare function createAttestationHexString({ discriminator, oracleId, queueId, timestamp, secp256k1Key, r, s, v, blockNumber, mrEnclave, guardianId, }: AttestationHexStringParams): string;
/**
 * Create an EVM-serializable attestation message
 * @param param0 - AttestationHexStringParams: Components for an EVM attestation message
 * @returns hex string
 */
export declare function createV0AttestationHexString({ discriminator, oracleId, queueId, ed25519Key, secp256k1Key, r, s, v, blockNumber, mrEnclave, }: V0AttestationHexStringParams): string;
/**
 * Create an EVM-serializable randomness reveal message
 * @param param0 - RandomnessRevealHexStringParams: Components for an EVM randomness reveal message
 * @returns hex string
 */
export declare function createRandomnessRevealHexString({ discriminator, randomnessId, result, r, s, v, }: RandomnessRevealHexStringParams): string;
//# sourceMappingURL=message.d.ts.map