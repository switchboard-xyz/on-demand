var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Queue } from "./queue.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
/**
 *  Abstraction around the Switchboard-On-Demand State account
 *
 *  This account is used to store the state data for a given program.
 */
export class State {
    /**
     * Derives a state PDA (Program Derived Address) from the program.
     *
     * @param {Program} program - The Anchor program instance.
     * @returns {PublicKey} The derived state account's public key.
     */
    static keyFromSeed(program) {
        const [state] = PublicKey.findProgramAddressSync([Buffer.from("STATE")], program.programId);
        return state;
    }
    /**
     * Initializes the state account.
     *
     * @param {Program} program - The Anchor program instance.
     * @returns {Promise<[State, string]>} A promise that resolves to the state account and the transaction signature.
     */
    static create(program) {
        return __awaiter(this, void 0, void 0, function* () {
            const payer = program.provider.wallet.payer;
            const sig = yield program.rpc.stateInit({}, {
                accounts: {
                    state: State.keyFromSeed(program),
                    payer: payer.publicKey,
                    systemProgram: SystemProgram.programId,
                },
                signers: [payer],
            });
            return [new State(program), sig];
        });
    }
    /**
     * Constructs a `State` instance.
     *
     * @param {Program} program - The Anchor program instance.
     */
    constructor(program) {
        this.program = program;
        const pubkey = State.keyFromSeed(program);
        this.pubkey = pubkey;
    }
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
    setConfigsIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const state = yield this.loadData();
            const queue = (_a = params.guardianQueue) !== null && _a !== void 0 ? _a : state.guardianQueue;
            const program = this.program;
            const payer = program.provider.wallet.payer;
            const testOnlyDisableMrEnclaveCheck = (_b = params.testOnlyDisableMrEnclaveCheck) !== null && _b !== void 0 ? _b : state.testOnlyDisableMrEnclaveCheck;
            const resetEpochs = (_c = params.resetEpochs) !== null && _c !== void 0 ? _c : false;
            const ix = yield this.program.instruction.stateSetConfigs({
                newAuthority: (_d = params.newAuthority) !== null && _d !== void 0 ? _d : state.authority,
                testOnlyDisableMrEnclaveCheck: testOnlyDisableMrEnclaveCheck ? 1 : 0,
                stakePool: (_e = params.stakePool) !== null && _e !== void 0 ? _e : state.stakePool,
                stakeProgram: (_f = params.stakeProgram) !== null && _f !== void 0 ? _f : state.stakeProgram,
                addAdvisory: params.permitAdvisory,
                rmAdvisory: params.denyAdvisory,
                epochLength: (_g = params.epochLength) !== null && _g !== void 0 ? _g : state.epochLength,
                resetEpochs: resetEpochs,
                lutSlot: state.lutSlot,
                switchMint: (_h = params.switchMint) !== null && _h !== void 0 ? _h : state.switchMint,
                enableStaking: (_j = params.enableStaking) !== null && _j !== void 0 ? _j : state.enableStaking,
                authority: (_k = params.newAuthority) !== null && _k !== void 0 ? _k : state.authority,
            }, {
                accounts: {
                    state: this.pubkey,
                    authority: state.authority,
                    queue,
                    payer: payer.publicKey,
                    systemProgram: SystemProgram.programId,
                },
            });
            return ix;
        });
    }
    /**
     * Register a guardian with the global guardian queue.
     *
     * @param {object} params - The parameters object.
     * @param {PublicKey} params.guardian - The guardian account.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    registerGuardianIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const state = yield this.loadData();
            const program = this.program;
            const payer = program.provider.wallet.payer;
            const ix = yield this.program.instruction.guardianRegister({}, {
                accounts: {
                    oracle: params.guardian,
                    state: this.pubkey,
                    guardianQueue: state.guardianQueue,
                    authority: state.authority,
                },
                signers: [payer],
            });
            return ix;
        });
    }
    /**
     * Unregister a guardian from the global guardian queue.
     *
     * @param {object} params - The parameters object.
     * @param {PublicKey} params.guardian - The guardian account.
     * @returns {Promise<TransactionInstruction>} A promise that resolves to the transaction instruction.
     */
    unregisterGuardianIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const state = yield this.loadData();
            const guardianQueue = new Queue(this.program, state.guardianQueue);
            const queueData = yield guardianQueue.loadData();
            const idx = queueData.guardians.findIndex((key) => key.equals(params.guardian));
            const program = this.program;
            const payer = program.provider.wallet.payer;
            const ix = yield this.program.instruction.guardianUnregister({ idx }, {
                accounts: {
                    oracle: params.guardian,
                    state: this.pubkey,
                    guardianQueue: state.guardianQueue,
                    authority: state.authority,
                },
                signers: [payer],
            });
            return ix;
        });
    }
    /**
     *  Loads the state data from on chain.
     *
     *  @returns A promise that resolves to the state data.
     *  @throws if the state account does not exist.
     */
    loadData() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.program.account["state"].fetch(this.pubkey);
        });
    }
    /**
     *  Loads the state data from on chain.
     *
     *  @returns A promise that resolves to the state data.
     *  @throws if the state account does not exist.
     */
    static loadData(program) {
        return __awaiter(this, void 0, void 0, function* () {
            const state = new State(program);
            return yield state.loadData();
        });
    }
}
//# sourceMappingURL=state.js.map