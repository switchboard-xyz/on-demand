import type { Program } from "@coral-xyz/anchor-30";
import type { AddressLookupTableAccount, TransactionInstruction } from "@solana/web3.js";
import { Keypair, PublicKey } from "@solana/web3.js";
/**
 *  This class represents an oracle account on chain.
 */
export declare class Oracle {
    readonly program: Program;
    readonly pubkey: PublicKey;
    lut: AddressLookupTableAccount | null;
    constructor(program: Program, pubkey: PublicKey);
    /**
     * Creates a new oracle account. linked to the specified queue.
     * After creation the oracle still must receive run approval and verify their
     * enclave measurement.
     * @param program - The program that owns the oracle account.
     * @param params.queue - The queue that the oracle will be linked to.
     * @returns A promise that resolves to a tuple containing the oracle account
     * and the transaction signature.
     *
     */
    static create(program: Program, params: {
        queue: PublicKey;
    }): Promise<[Oracle, TransactionInstruction[], Keypair]>;
    updateDelegationRewardPoolsIx(params: {
        overrideStakePool?: PublicKey;
        overrideMint?: PublicKey;
        authority: PublicKey;
    }): Promise<TransactionInstruction>;
    setConfigsIx(params: {
        authority: PublicKey;
    }): Promise<TransactionInstruction>;
    /**
     *  Loads the oracle data for this {@linkcode Oracle} account from on chain.
     *
     *  @returns A promise that resolves to the oracle data.
     *  @throws if the oracle account does not exist.
     */
    loadData(): Promise<any>;
    fetchGateway(): Promise<string>;
    /**
     * Loads the oracle data for a list of {@linkcode Oracle} accounts from on chain.
     *
     * @param program - The program that owns the oracle accounts.
     * @param keys - The public keys of the oracle accounts to load.
     * @returns A promise that resolves to an array of oracle data.
     * @throws if any of the oracle accounts do not exist.
     */
    static loadMany(program: Program, keys: PublicKey[]): Promise<any[]>;
    /**
     * Loads the oracle data and checks if the oracle is verified.
     *
     * @returns A promise that resolves to a tuple containing a boolean indicating
     * if the oracle is verified and the expiration time of the verification.
     * @throws if the oracle account does not exist.
     */
    verificationStatus(): Promise<[boolean, number]>;
    /**
     * Get the pubkey of the stats account for this oracle.
     * @returns A promise that resolves to the pubkey of the stats account.
     */
    statsKey(): Promise<PublicKey>;
    lutKey(): Promise<PublicKey>;
    lookupTableKey(data: any): PublicKey;
    loadLookupTable(): Promise<AddressLookupTableAccount>;
}
//# sourceMappingURL=oracle.d.ts.map