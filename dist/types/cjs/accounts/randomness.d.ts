import { type Program } from "@coral-xyz/anchor-30";
import type { TransactionInstruction } from "@solana/web3.js";
import { Keypair, PublicKey } from "@solana/web3.js";
/**
 * Switchboard commit-reveal randomness.
 * This account type controls commit-reveal style randomness employing
 * Intel SGX enclaves as a randomness security mechanism.
 * For this flow, a user must commit to a future slot that would be unknown
 * to all parties at the time of commitment. The user must then reveal the
 * randomness by then sending the future slot hash to the oracle which can
 * then be signed by the secret key secured within the Trusted Execution Environment.
 *
 * In this manner, the only way for one to predict the randomness is to:
 * 1. Have access to the randomness oracle
 * 2. have control of the solana network slot leader at the time of commit
 * 3. Have an unpatched Intel SGX vulnerability/advisory that the Switchboard
 *   protocol failed to auto-prune.
 */
export declare class Randomness {
    readonly program: Program;
    readonly pubkey: PublicKey;
    /**
     * Constructs a `Randomness` instance.
     *
     * @param {Program} program - The Anchor program instance.
     * @param {PublicKey} pubkey - The public key of the randomness account.
     */
    constructor(program: Program, pubkey: PublicKey);
    /**
     * Loads the randomness data for this {@linkcode Randomness} account from on chain.
     *
     * @returns {Promise<any>} A promise that resolves to the randomness data.
     * @throws Will throw an error if the randomness account does not exist.
     */
    loadData(): Promise<any>;
    /**
     * Creates a new `Randomness` account.
     *
     * @param {Program} program - The Anchor program instance.
     * @param {Keypair} kp - The keypair of the new `Randomness` account.
     * @param {PublicKey} queue - The queue account to associate with the new `Randomness` account.
     * @param {PublicKey} [payer_] - The payer for the transaction. If not provided, the default payer from the program provider is used.
     * @returns {Promise<[Randomness, TransactionInstruction]>} A promise that resolves to a tuple containing the new `Randomness` account and the transaction instruction.
     */
    static create(program: Program, kp: Keypair, queue: PublicKey, payer_?: PublicKey): Promise<[Randomness, TransactionInstruction]>;
    /**
     * Generate a randomness `commit` solana transaction instruction.
     * This will commit the randomness account to use currentSlot + 1 slothash
     * as the non-repeating randomness seed.
     *
     * @param {PublicKey} queue - The queue public key for the commit instruction.
     * @param {PublicKey} [authority_] - The optional authority public key.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    commitIx(queue: PublicKey, authority_?: PublicKey): Promise<TransactionInstruction>;
    /**
     * Generate a randomness `reveal` solana transaction instruction.
     * This will reveal the randomness using the assigned oracle.
     *
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    revealIx(): Promise<TransactionInstruction>;
    /**
     * Commit and reveal randomness in a single transaction.
     *
     * @param {TransactionInstruction[]} callback - The callback to execute after the reveal in the same transaction.
     * @param {Keypair[]} signers - The signers to sign the transaction.
     * @param {PublicKey} queue - The queue public key.
     * @param {object} [configs] - The configuration options.
     * @param {number} [configs.computeUnitPrice] - The price per compute unit in microlamports.
     * @param {number} [configs.computeUnitLimit] - The compute unit limit.
     * @returns {Promise<void>} A promise that resolves when the transaction is confirmed.
     */
    commitAndReveal(callback: TransactionInstruction[], signers: Keypair[], queue: PublicKey, configs?: {
        computeUnitPrice?: number;
        computeUnitLimit?: number;
    }): Promise<void>;
    /**
     * Serialize ix to file.
     *
     * @param {TransactionInstruction[]} revealIxs - The reveal instruction of a transaction.
     * @param {string} [fileName="serializedIx.bin"] - The name of the file to save the serialized IX to.
     * @throws Will throw an error if the request fails.
     * @returns {Promise<void>} A promise that resolves when the file has been written.
     */
    serializeIxToFile(revealIxs: TransactionInstruction[], fileName?: string): Promise<void>;
    /**
     * Creates a new `Randomness` account and prepares a commit transaction instruction.
     *
     * @param {Program} program - The Anchor program instance.
     * @param {PublicKey} queue - The queue account to associate with the new `Randomness` account.
     * @returns {Promise<[Randomness, Keypair, TransactionInstruction[]]>} A promise that resolves to a tuple containing the new `Randomness` instance, the keypair, and an array of transaction instructions.
     */
    static createAndCommitIxs(program: Program, queue: PublicKey): Promise<[Randomness, Keypair, TransactionInstruction[]]>;
}
//# sourceMappingURL=randomness.d.ts.map