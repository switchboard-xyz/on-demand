var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { SLOT_HASHES_SYSVAR_ID } from "../constants.js";
import { Gateway } from "../oracle-interfaces/gateway.js";
import { InstructionUtils } from "./../instruction-utils/InstructionUtils.js";
import * as spl from "./../utils/index.js";
import { Oracle } from "./oracle.js";
import { Queue } from "./queue.js";
import { State } from "./state.js";
import * as anchor from "@coral-xyz/anchor-30";
import { AddressLookupTableProgram, ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, } from "@solana/web3.js";
import { sendTxWithJito } from "@solworks/soltoolkit-sdk/build/modules/TransactionWrapper.js";
import * as bs58 from "bs58";
import * as fs from "fs";
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
export class Randomness {
    /**
     * Constructs a `Randomness` instance.
     *
     * @param {Program} program - The Anchor program instance.
     * @param {PublicKey} pubkey - The public key of the randomness account.
     */
    constructor(program, pubkey) {
        this.program = program;
        this.pubkey = pubkey;
    }
    /**
     * Loads the randomness data for this {@linkcode Randomness} account from on chain.
     *
     * @returns {Promise<any>} A promise that resolves to the randomness data.
     * @throws Will throw an error if the randomness account does not exist.
     */
    loadData() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.program.account["randomnessAccountData"].fetch(this.pubkey);
        });
    }
    /**
     * Creates a new `Randomness` account.
     *
     * @param {Program} program - The Anchor program instance.
     * @param {Keypair} kp - The keypair of the new `Randomness` account.
     * @param {PublicKey} queue - The queue account to associate with the new `Randomness` account.
     * @param {PublicKey} [payer_] - The payer for the transaction. If not provided, the default payer from the program provider is used.
     * @returns {Promise<[Randomness, TransactionInstruction]>} A promise that resolves to a tuple containing the new `Randomness` account and the transaction instruction.
     */
    static create(program, kp, queue, payer_) {
        return __awaiter(this, void 0, void 0, function* () {
            const lutSigner = (yield PublicKey.findProgramAddress([Buffer.from("LutSigner"), kp.publicKey.toBuffer()], program.programId))[0];
            const recentSlot = yield program.provider.connection.getSlot("finalized");
            const [_, lut] = AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: PublicKey.default,
                recentSlot,
            });
            const ix = program.instruction.randomnessInit({
                recentSlot: new anchor.BN(recentSlot.toString()),
            }, {
                accounts: {
                    randomness: kp.publicKey,
                    queue,
                    authority: program.provider.publicKey,
                    payer: program.provider.publicKey,
                    rewardEscrow: spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, kp.publicKey),
                    systemProgram: SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                    wrappedSolMint: spl.NATIVE_MINT,
                    programState: State.keyFromSeed(program),
                    lutSigner,
                    lut,
                    addressLookupTableProgram: AddressLookupTableProgram.programId,
                },
            });
            return [new Randomness(program, kp.publicKey), ix];
        });
    }
    /**
     * Generate a randomness `commit` solana transaction instruction.
     * This will commit the randomness account to use currentSlot + 1 slothash
     * as the non-repeating randomness seed.
     *
     * @param {PublicKey} queue - The queue public key for the commit instruction.
     * @param {PublicKey} [authority_] - The optional authority public key.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    commitIx(queue, authority_) {
        return __awaiter(this, void 0, void 0, function* () {
            const queueAccount = new Queue(this.program, queue);
            const oracle = yield queueAccount.fetchFreshOracle();
            const authority = authority_ !== null && authority_ !== void 0 ? authority_ : (yield this.loadData()).authority;
            const ix = yield this.program.instruction.randomnessCommit({}, {
                accounts: {
                    randomness: this.pubkey,
                    queue: queue,
                    oracle: oracle,
                    recentSlothashes: SLOT_HASHES_SYSVAR_ID,
                    authority,
                },
            });
            return ix;
        });
    }
    /**
     * Generate a randomness `reveal` solana transaction instruction.
     * This will reveal the randomness using the assigned oracle.
     *
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    revealIx() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            const oracleKey = data.oracle;
            const oracle = new Oracle(this.program, oracleKey);
            const oracleData = yield oracle.loadData();
            const gatewayUrl = String.fromCharCode(...oracleData.gatewayUri).replace(/\0+$/, "");
            const gateway = new Gateway(this.program, gatewayUrl);
            const gatewayRevealResponse = yield gateway.fetchRandomnessReveal({
                randomnessAccount: this.pubkey,
                slothash: bs58.encode(data.seedSlothash),
                slot: data.seedSlot.toNumber(),
            });
            const stats = PublicKey.findProgramAddressSync([Buffer.from("OracleRandomnessStats"), oracleKey.toBuffer()], this.program.programId)[0];
            const ix = yield this.program.instruction.randomnessReveal({
                signature: Buffer.from(gatewayRevealResponse.signature, "base64"),
                recoveryId: gatewayRevealResponse.recovery_id,
                value: gatewayRevealResponse.value,
            }, {
                accounts: {
                    randomness: this.pubkey,
                    oracle: oracleKey,
                    queue: data.queue,
                    stats,
                    authority: data.authority,
                    payer: this.program.provider.publicKey,
                    recentSlothashes: SLOT_HASHES_SYSVAR_ID,
                    systemProgram: SystemProgram.programId,
                    rewardEscrow: spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, this.pubkey),
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                    wrappedSolMint: spl.NATIVE_MINT,
                    programState: State.keyFromSeed(this.program),
                },
            });
            return ix;
        });
    }
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
    commitAndReveal(callback, signers, queue, configs) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const queueAccount = new Queue(this.program, queue);
            const oracle = yield queueAccount.fetchFreshOracle();
            const computeUnitPrice = (_a = configs === null || configs === void 0 ? void 0 : configs.computeUnitPrice) !== null && _a !== void 0 ? _a : 1;
            const computeUnitLimit = (_b = configs === null || configs === void 0 ? void 0 : configs.computeUnitLimit) !== null && _b !== void 0 ? _b : 200000;
            const connection = this.program.provider.connection;
            const payer = this.program.provider.wallet.payer;
            for (;;) {
                const data = yield this.loadData();
                if (data.seedSlot.toNumber() !== 0) {
                    console.log("Randomness slot already committed. Jumping to reveal.");
                    break;
                }
                const tx = yield InstructionUtils.asV0TxWithComputeIxs({
                    connection: this.program.provider.connection,
                    ixs: [
                        ComputeBudgetProgram.setComputeUnitPrice({
                            microLamports: computeUnitPrice,
                        }),
                        yield this.commitIx(oracle, data.authority),
                    ],
                });
                tx.sign([payer]);
                const sim = yield connection.simulateTransaction(tx, {
                    commitment: "processed",
                });
                if (sim.value.err !== null) {
                    console.log(sim.value.logs);
                    throw new Error(`Failed to simulate commit transaction: ${JSON.stringify(sim.value.err)}`);
                }
                const sig = yield connection.sendTransaction(tx, {
                    maxRetries: 2,
                    skipPreflight: true,
                });
                console.log(`Commit transaction sent: ${sig}`);
                try {
                    yield sendTxWithJito({
                        serialisedTx: tx.serialize(),
                        sendOptions: {},
                        region: "mainnet",
                    });
                }
                catch (e) {
                    // console.log("Skipping Jito send");
                }
                try {
                    yield connection.confirmTransaction(sig);
                    console.log(`Commit transaction confirmed: ${sig}`);
                    break;
                }
                catch (e) {
                    console.log("Failed to confirm commit transaction. Retrying...");
                    yield new Promise((f) => setTimeout(f, 1000));
                    continue;
                }
            }
            yield new Promise((f) => setTimeout(f, 1000));
            for (;;) {
                const data = yield this.loadData();
                if (data.revealSlot.toNumber() !== 0) {
                    break;
                }
                let revealIx = undefined;
                try {
                    revealIx = yield this.revealIx();
                }
                catch (e) {
                    console.log(e);
                    console.log("Failed to grab reveal signature. Retrying...");
                    yield new Promise((f) => setTimeout(f, 1000));
                    continue;
                }
                const tx = yield InstructionUtils.asV0TxWithComputeIxs({
                    connection: this.program.provider.connection,
                    ixs: [
                        ComputeBudgetProgram.setComputeUnitPrice({
                            microLamports: computeUnitPrice,
                        }),
                        ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
                        revealIx,
                        ...callback,
                    ],
                });
                tx.sign(signers);
                const sim = yield connection.simulateTransaction(tx, {
                    commitment: "processed",
                });
                if (sim.value.err !== null) {
                    console.log(sim.value.logs);
                    throw new Error(`Failed to simulate commit transaction: ${JSON.stringify(sim.value.err)}`);
                }
                const sig = yield connection.sendTransaction(tx, {
                    maxRetries: 2,
                    skipPreflight: true,
                });
                console.log(`RevealAndCallback transaction sent: ${sig}`);
                try {
                    yield sendTxWithJito({
                        serialisedTx: tx.serialize(),
                        sendOptions: {},
                        region: "mainnet",
                    });
                }
                catch (e) {
                    // console.log("Skipping Jito send");
                }
                yield connection.confirmTransaction(sig);
                console.log(`RevealAndCallback transaction confirmed: ${sig}`);
            }
        });
    }
    /**
     * Serialize ix to file.
     *
     * @param {TransactionInstruction[]} revealIxs - The reveal instruction of a transaction.
     * @param {string} [fileName="serializedIx.bin"] - The name of the file to save the serialized IX to.
     * @throws Will throw an error if the request fails.
     * @returns {Promise<void>} A promise that resolves when the file has been written.
     */
    serializeIxToFile(revealIxs_1) {
        return __awaiter(this, arguments, void 0, function* (revealIxs, fileName = "serializedIx.bin") {
            const tx = yield InstructionUtils.asV0TxWithComputeIxs({
                connection: this.program.provider.connection,
                ixs: revealIxs,
                payer: PublicKey.default,
            });
            fs.writeFile(fileName, tx.serialize(), (err) => {
                if (err) {
                    console.error("Failed to write to file:", err);
                    throw err;
                }
            });
        });
    }
    /**
     * Creates a new `Randomness` account and prepares a commit transaction instruction.
     *
     * @param {Program} program - The Anchor program instance.
     * @param {PublicKey} queue - The queue account to associate with the new `Randomness` account.
     * @returns {Promise<[Randomness, Keypair, TransactionInstruction[]]>} A promise that resolves to a tuple containing the new `Randomness` instance, the keypair, and an array of transaction instructions.
     */
    static createAndCommitIxs(program, queue) {
        return __awaiter(this, void 0, void 0, function* () {
            const kp = Keypair.generate();
            const lutSigner = (yield PublicKey.findProgramAddress([Buffer.from("LutSigner"), kp.publicKey.toBuffer()], program.programId))[0];
            const recentSlot = yield program.provider.connection.getSlot("finalized");
            const [_, lut] = AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: PublicKey.default,
                recentSlot,
            });
            const queueAccount = new Queue(program, queue);
            const oracle = yield queueAccount.fetchFreshOracle();
            const creationIx = program.instruction.randomnessInit({}, {
                accounts: {
                    randomness: kp.publicKey,
                    queue,
                    authority: program.provider.publicKey,
                    payer: program.provider.publicKey,
                    rewardEscrow: spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, kp.publicKey),
                    systemProgram: SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                    wrappedSolMint: spl.NATIVE_MINT,
                    programState: State.keyFromSeed(program),
                    lutSigner,
                    lut,
                    addressLookupTableProgram: AddressLookupTableProgram.programId,
                },
            });
            const newRandomness = new Randomness(program, kp.publicKey);
            const commitIx = yield newRandomness.commitIx(oracle, program.provider.publicKey);
            return [newRandomness, kp, [creationIx, commitIx]];
        });
    }
}
//# sourceMappingURL=randomness.js.map