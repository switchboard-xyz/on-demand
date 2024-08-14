import type { BN, Program } from "@coral-xyz/anchor-30";
import type { AddressLookupTableState, TransactionInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
/**
 *  A map of LUTs to their public keys.
 *
 *  Users can initialize to compact all oracle and feed keys they use into a single
 *  account, and then use the LUT to load all tx keys efficiently.
 */
export declare class LutMap {
    readonly program: Program;
    readonly pubkey: PublicKey;
    /**
     *  The public key of the LUT map account.
     */
    static keyFromSeed(program: Program, queue: PublicKey, authority: PublicKey): Promise<PublicKey>;
    /**
     * Creating a LUT map account will allow a user or protocol to easy manage
     * and associate a common account grouping for their feeds to reduce the
     * total number of transaction bytes taken by Switchboard.
     * This will maximize the flexibility users have in their instructions.
     *
     * @param program - The program that owns the LUT map account.
     * @param queue - The queue account that the LUT map is associated with.
     * @param slot - The slot that the LUT map is associated with.
     * @returns A promise that resolves to the LUT map and the transaction signature.
     */
    static create(program: Program, queue: PublicKey, slot: BN): Promise<[LutMap, string]>;
    constructor(program: Program, pubkey: PublicKey);
    queueLutExtendIx(params: {
        queue: PublicKey;
        newKey: PublicKey;
        payer: PublicKey;
    }): Promise<TransactionInstruction>;
    /**
     *  Loads the data for this {@linkcode LutMap} account from on chain.
     *
     *  @returns A promise that resolves to the data.
     *  @throws if the account does not exist.
     */
    loadData(): Promise<any>;
    loadLut(): Promise<[PublicKey, AddressLookupTableState]>;
    syncLut(feeds: PublicKey[]): Promise<void>;
}
//# sourceMappingURL=lutMap.d.ts.map