/// <reference types="node" />
/// <reference types="node" />
import type { FeedEvalResponse, FetchSignaturesBatchResponse, FetchSignaturesMultiResponse } from "../oracle-interfaces/gateway.js";
import { Gateway } from "../oracle-interfaces/gateway.js";
import type { SwitchboardPermission } from "./permission.js";
import type { FeedRequest } from "./pullFeed.js";
import * as anchor from "@coral-xyz/anchor-30";
import { type Program } from "@coral-xyz/anchor-30";
import type { AddressLookupTableAccount, TransactionInstruction } from "@solana/web3.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { type OracleJob } from "@switchboard-xyz/common";
/**
 *  Abstraction around the Switchboard-On-Demand Queue account
 *
 *  This account is used to store the queue data for a given feed.
 */
export declare class Queue {
    readonly program: Program;
    readonly pubkey: PublicKey;
    static createIx(program: Program, params: {
        allowAuthorityOverrideAfter?: number;
        requireAuthorityHeartbeatPermission?: boolean;
        requireUsagePermission?: boolean;
        maxQuoteVerificationAge?: number;
        reward?: number;
        nodeTimeout?: number;
        lutSlot?: number;
    }): Promise<[Queue, Keypair, TransactionInstruction]>;
    /**
     * Creates a new instance of the `Queue` account with a PDA for SVM (non-solana) chains.
     * @param program The anchor program instance.
     * @param params The initialization parameters for the queue.
     * @returns
     */
    static createIxSVM(program: Program, params: {
        sourceQueueKey: PublicKey;
        allowAuthorityOverrideAfter?: number;
        requireAuthorityHeartbeatPermission?: boolean;
        requireUsagePermission?: boolean;
        maxQuoteVerificationAge?: number;
        reward?: number;
        nodeTimeout?: number;
        lutSlot?: number;
    }): Promise<[Queue, TransactionInstruction]>;
    /**
     * Add an Oracle to a queue and set permissions
     * @param program
     * @param params
     */
    overrideSVM(params: {
        oracle: PublicKey;
        secp256k1Signer: Buffer;
        maxQuoteVerificationAge: number;
        mrEnclave: Buffer;
        slot: number;
    }): Promise<anchor.web3.TransactionInstruction>;
    initDelegationGroupIx(params: {
        lutSlot?: number;
        overrideStakePool?: PublicKey;
    }): Promise<TransactionInstruction>;
    /**
     *  Fetches signatures from a random gateway on the queue.
     *
     *  REST API endpoint: /api/v1/fetch_signatures
     *
     *  @param recentHash The chain metadata to sign with. Blockhash or slothash.
     *  @param jobs The oracle jobs to perform.
     *  @param numSignatures The number of oracles to fetch signatures from.
     *  @returns A promise that resolves to the feed evaluation responses.
     *  @throws if the request fails.
     */
    static fetchSignatures(program: Program, params: {
        gateway?: string;
        queue: PublicKey;
        recentHash?: string;
        jobs: OracleJob[];
        numSignatures?: number;
        maxVariance?: number;
        minResponses?: number;
    }): Promise<{
        responses: FeedEvalResponse[];
        failures: string[];
    }>;
    static fetchSignaturesMulti(program: Program, params: {
        gateway?: string;
        queue: PublicKey;
        recentHash?: string;
        feedConfigs: FeedRequest[];
        minResponses?: number;
    }): Promise<FetchSignaturesMultiResponse>;
    static fetchSignaturesBatch(program: Program, params: {
        gateway?: string;
        queue: PublicKey;
        recentHash?: string;
        feedConfigs: FeedRequest[];
        minResponses?: number;
    }): Promise<FetchSignaturesBatchResponse>;
    /**
     * @deprecated
     * Deprecated. Use {@linkcode @switchboard-xyz/common#FeedHash.compute} instead.
     */
    static fetchFeedHash(program: Program, params: {
        gateway?: string;
        queue: PublicKey;
        recentHash?: string;
        jobs: OracleJob[];
        numSignatures?: number;
        maxVariance?: number;
        minResponses?: number;
    }): Promise<Buffer>;
    /**
     *  Constructs a `OnDemandQueue` instance.
     *
     *  @param program The Anchor program instance.
     *  @param pubkey The public key of the queue account.
     */
    constructor(program: Program, pubkey: PublicKey);
    /**
     *  Loads the queue data from on chain and returns the listed oracle keys.
     *
     *  @returns A promise that resolves to an array of oracle public keys.
     */
    fetchOracleKeys(): Promise<PublicKey[]>;
    /**
     *  Loads the queue data from on chain and returns the listed gateways.
     *
     *  @returns A promise that resolves to an array of gateway URIs.
     */
    fetchAllGateways(): Promise<Gateway[]>;
    /**
     *  Loads the queue data from on chain and returns a random gateway.
     *  @returns A promise that resolves to a gateway interface
     */
    fetchGateway(): Promise<Gateway>;
    /**
     *  Fetches signatures from a random gateway on the queue.
     *
     *  REST API endpoint: /api/v1/fetch_signatures
     *
     *  @param gateway The gateway to fetch signatures from. If not provided, a gateway will be automatically selected.
     *  @param recentHash The chain metadata to sign with. Blockhash or slothash.
     *  @param jobs The oracle jobs to perform.
     *  @param numSignatures The number of oracles to fetch signatures from.
     *  @param maxVariance The maximum variance allowed in the responses.
     *  @param minResponses The minimum number of responses to attempt to fetch.
     *  @returns A promise that resolves to the feed evaluation responses.
     *  @throws if the request fails.
     */
    fetchSignatures(params: {
        gateway?: string;
        recentHash?: string;
        jobs: OracleJob[];
        numSignatures?: number;
        maxVariance?: number;
        minResponses?: number;
        chain?: string;
    }): Promise<{
        responses: FeedEvalResponse[];
        failures: string[];
    }>;
    fetchSignaturesMulti(params: {
        gateway?: string;
        queue: PublicKey;
        recentHash?: string;
        feedConfigs: FeedRequest[];
        minResponses?: number;
    }): Promise<FetchSignaturesMultiResponse>;
    fetchSignaturesBatch(params: {
        gateway?: string;
        queue: PublicKey;
        recentHash?: string;
        feedConfigs: FeedRequest[];
        minResponses?: number;
    }): Promise<FetchSignaturesBatchResponse>;
    /**
     *  Loads the queue data for this {@linkcode Queue} account from on chain.
     *
     *  @returns A promise that resolves to the queue data.
     *  @throws if the queue account does not exist.
     */
    loadData(): Promise<any>;
    /**
     *  Adds a new MR enclave to the queue.
     *  This will allow the queue to accept signatures from the given MR enclave.
     *  @param mrEnclave The MR enclave to add.
     *  @returns A promise that resolves to the transaction instruction.
     *  @throws if the request fails.
     *  @throws if the MR enclave is already added.
     *  @throws if the MR enclave is invalid.
     *  @throws if the MR enclave is not a valid length.
     */
    addMrEnclaveIx(params: {
        mrEnclave: Uint8Array;
    }): Promise<TransactionInstruction>;
    /**
     *  Removes an MR enclave from the queue.
     *  This will prevent the queue from accepting signatures from the given MR enclave.
     *  @param mrEnclave The MR enclave to remove.
     *  @returns A promise that resolves to the transaction instruction.
     *  @throws if the request fails.
     *  @throws if the MR enclave is not present.
     */
    rmMrEnclaveIx(params: {
        mrEnclave: Uint8Array;
    }): Promise<TransactionInstruction>;
    /**
     * Sets the queue configurations.
     * @param params.authority The new authority for the queue.
     * @param params.reward The new reward for the queue.
     * @param params.nodeTimeout The new node timeout for the queue.
     * @returns A promise that resolves to the transaction instruction.
     */
    setConfigsIx(params: {
        authority?: PublicKey;
        reward?: number;
        nodeTimeout?: number;
    }): Promise<TransactionInstruction>;
    /**
     * Sets the oracle permission on the queue.
     * @param params.oracle The oracle to set the permission for.
     * @param params.permission The permission to set.
     * @param params.enabled Whether the permission is enabled.
     * @returns A promise that resolves to the transaction instruction   */
    setOraclePermissionIx(params: {
        oracle: PublicKey;
        permission: SwitchboardPermission;
        enable: boolean;
    }): Promise<TransactionInstruction>;
    /**
     *  Removes all MR enclaves from the queue.
     *  @returns A promise that resolves to an array of transaction instructions.
     *  @throws if the request fails.
     */
    rmAllMrEnclaveIxs(): Promise<Array<TransactionInstruction>>;
    /**
     *  Fetches most recently added and verified Oracle Key.
     *  @returns A promise that resolves to an oracle public key.
     *  @throws if the request fails.
     */
    fetchFreshOracle(): Promise<PublicKey>;
    /**
     * Get the PDA for the queue (SVM chains that are not solana)
     * @returns Queue PDA Pubkey
     */
    queuePDA(): PublicKey;
    /**
     * Get the PDA for the queue (SVM chains that are not solana)
     * @param program Anchor program
     * @param pubkey Queue pubkey
     * @returns Queue PDA Pubkey
     */
    static queuePDA(program: Program, pubkey: PublicKey): PublicKey;
    lutSigner(): Promise<PublicKey>;
    lutKey(lutSlot: number): Promise<PublicKey>;
    loadLookupTable(): Promise<AddressLookupTableAccount>;
}
//# sourceMappingURL=queue.d.ts.map