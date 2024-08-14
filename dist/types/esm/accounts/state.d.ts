import type { BN, Program } from "@coral-xyz/anchor-30";
import type { TransactionInstruction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
/**
 *  Abstraction around the Switchboard-On-Demand State account
 *
 *  This account is used to store the state data for a given program.
 */
export declare class State {
    readonly program: Program;
    pubkey: PublicKey;
    /**
     * Derives a state PDA (Program Derived Address) from the program.
     *
     * @param {Program} program - The Anchor program instance.
     * @returns {PublicKey} The derived state account's public key.
     */
    static keyFromSeed(program: Program): PublicKey;
    /**
     * Initializes the state account.
     *
     * @param {Program} program - The Anchor program instance.
     * @returns {Promise<[State, string]>} A promise that resolves to the state account and the transaction signature.
     */
    static create(program: Program): Promise<[State, String]>;
    /**
     * Constructs a `State` instance.
     *
     * @param {Program} program - The Anchor program instance.
     */
    constructor(program: Program);
    /**
     * Set program-wide configurations.
     *
     * @param {object} params - The configuration parameters.
     * @param {PublicKey} [params.guardianQueue] - The guardian queue account.
     * @param {PublicKey} [params.newAuthority] - The new authority account.
     * @param {BN} [params.minQuoteVerifyVotes] - The minimum number of votes required to verify a quote.
     * @param {PublicKey} [params.stakeProgram] - The stake program account.
     * @param {PublicKey} [params.stakePool] - The stake pool account.
     * @param {number} [params.permitAdvisory] - The permit advisory value.
     * @param {number} [params.denyAdvisory] - The deny advisory value.
     * @param {boolean} [params.testOnlyDisableMrEnclaveCheck] - A flag to disable MrEnclave check for testing purposes.
     * @param {PublicKey} [params.switchMint] - The switch mint account.
     * @param {BN} [params.epochLength] - The epoch length.
     * @param {boolean} [params.resetEpochs] - A flag to reset epochs.
     * @param {boolean} [params.enableStaking] - A flag to enable staking.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    setConfigsIx(params: {
        guardianQueue?: PublicKey;
        newAuthority?: PublicKey;
        minQuoteVerifyVotes?: BN;
        stakeProgram?: PublicKey;
        stakePool?: PublicKey;
        permitAdvisory?: number;
        denyAdvisory?: number;
        testOnlyDisableMrEnclaveCheck?: boolean;
        switchMint?: PublicKey;
        epochLength?: BN;
        resetEpochs?: boolean;
        enableStaking?: boolean;
    }): Promise<TransactionInstruction>;
    /**
     * Register a guardian with the global guardian queue.
     *
     * @param {object} params - The parameters object.
     * @param {PublicKey} params.guardian - The guardian account.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    registerGuardianIx(params: {
        guardian: PublicKey;
    }): Promise<TransactionInstruction>;
    /**
     * Unregister a guardian from the global guardian queue.
     *
     * @param {object} params - The parameters object.
     * @param {PublicKey} params.guardian - The guardian account.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    unregisterGuardianIx(params: {
        guardian: PublicKey;
    }): Promise<TransactionInstruction>;
    /**
     *  Loads the state data from on chain.
     *
     *  @returns A promise that resolves to the state data.
     *  @throws if the state account does not exist.
     */
    loadData(): Promise<any>;
    /**
     *  Loads the state data from on chain.
     *
     *  @returns A promise that resolves to the state data.
     *  @throws if the state account does not exist.
     */
    static loadData(program: Program): Promise<any>;
}
//# sourceMappingURL=state.d.ts.map