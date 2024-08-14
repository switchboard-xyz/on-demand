var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as spl from "./../utils/index.js";
import { State } from "./state.js";
import { BN, BorshAccountsCoder, utils } from "@coral-xyz/anchor-30";
import { AddressLookupTableProgram, Keypair, PublicKey, SystemProgram, } from "@solana/web3.js";
/**
 *  This class represents an oracle account on chain.
 */
export class Oracle {
    constructor(program, pubkey) {
        this.program = program;
        this.pubkey = pubkey;
        this.lut = null;
    }
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
    static create(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const stateKey = State.keyFromSeed(program);
            const state = yield State.loadData(program);
            const payer = program.provider.wallet.payer;
            const oracle = Keypair.generate();
            const oracleStats = (yield PublicKey.findProgramAddress([Buffer.from("OracleStats"), oracle.publicKey.toBuffer()], program.programId))[0];
            const lutSigner = (yield PublicKey.findProgramAddress([Buffer.from("LutSigner"), oracle.publicKey.toBuffer()], program.programId))[0];
            const [delegationPool] = yield PublicKey.findProgramAddress([
                Buffer.from("Delegation"),
                stateKey.toBuffer(),
                oracleStats.toBuffer(),
                state.stakePool.toBuffer(),
            ], state.stakeProgram);
            const recentSlot = yield program.provider.connection.getSlot("finalized");
            const [_, lut] = AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot,
            });
            const [delegationGroup] = yield PublicKey.findProgramAddress([
                Buffer.from("Group"),
                stateKey.toBuffer(),
                state.stakePool.toBuffer(),
                params.queue.toBuffer(),
            ], state.stakeProgram);
            const ix = yield program.instruction.oracleInit({
                recentSlot: new BN(recentSlot.toString()),
                authority: payer.publicKey,
                queue: params.queue,
                secpAuthority: null,
            }, {
                accounts: {
                    oracle: oracle.publicKey,
                    oracleStats,
                    authority: payer.publicKey,
                    programState: stateKey,
                    payer: payer.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    tokenMint: spl.NATIVE_MINT,
                    delegationPool,
                    lutSigner,
                    lut,
                    addressLookupTableProgram: AddressLookupTableProgram.programId,
                    switchMint: state.switchMint,
                    wsolVault: spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, oracle.publicKey),
                    switchVault: spl.getAssociatedTokenAddressSync(state.switchMint, oracle.publicKey),
                    stakeProgram: state.stakeProgram,
                    stakePool: state.stakePool,
                },
            });
            const ix2 = yield program.instruction.oracleUpdateDelegation({
                recentSlot: new BN(recentSlot.toString()),
            }, {
                accounts: {
                    oracle: oracle.publicKey,
                    oracleStats,
                    queue: params.queue,
                    authority: payer.publicKey,
                    programState: stateKey,
                    payer: payer.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    delegationPool,
                    lutSigner,
                    lut,
                    addressLookupTableProgram: AddressLookupTableProgram.programId,
                    switchMint: state.switchMint,
                    nativeMint: spl.NATIVE_MINT,
                    wsolVault: PublicKey.findProgramAddressSync([
                        Buffer.from("RewardPool"),
                        delegationPool.toBuffer(),
                        spl.NATIVE_MINT.toBuffer(),
                    ], state.stakeProgram)[0],
                    switchVault: PublicKey.findProgramAddressSync([
                        Buffer.from("RewardPool"),
                        delegationPool.toBuffer(),
                        state.switchMint.toBuffer(),
                    ], state.stakeProgram)[0],
                    stakeProgram: state.stakeProgram,
                    stakePool: state.stakePool,
                    delegationGroup,
                },
            });
            return [new Oracle(program, oracle.publicKey), [ix, ix2], oracle];
        });
    }
    updateDelegationRewardPoolsIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const program = this.program;
            const stateKey = State.keyFromSeed(program);
            const state = yield State.loadData(program);
            const switchMint = (_a = params.overrideMint) !== null && _a !== void 0 ? _a : state.switchMint;
            const stakePool = (_b = params.overrideStakePool) !== null && _b !== void 0 ? _b : state.stakePool;
            const stakeProgram = state.stakeProgram;
            const payer = program.provider.wallet.payer;
            const oracleData = yield this.loadData();
            const oracleStats = (yield PublicKey.findProgramAddress([Buffer.from("OracleStats"), this.pubkey.toBuffer()], program.programId))[0];
            const lutSigner = (yield PublicKey.findProgramAddress([Buffer.from("LutSigner"), this.pubkey.toBuffer()], program.programId))[0];
            const [delegationPool] = yield PublicKey.findProgramAddress([
                Buffer.from("Delegation"),
                stateKey.toBuffer(),
                oracleStats.toBuffer(),
                stakePool.toBuffer(),
            ], stakeProgram);
            const lutSlot = oracleData.lutSlot.toNumber();
            const [_, lut] = AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot: lutSlot,
            });
            const ix = yield program.instruction.oracleUpdateDelegation({
                recentSlot: new BN(lutSlot.toString()),
            }, {
                accounts: {
                    oracle: this.pubkey,
                    oracleStats,
                    queue: oracleData.queue,
                    authority: params.authority,
                    programState: stateKey,
                    payer: payer.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    delegationPool,
                    lutSigner,
                    lut,
                    addressLookupTableProgram: AddressLookupTableProgram.programId,
                    switchMint: switchMint,
                    nativeMint: spl.NATIVE_MINT,
                    wsolVault: PublicKey.findProgramAddressSync([
                        Buffer.from("RewardPool"),
                        delegationPool.toBuffer(),
                        spl.NATIVE_MINT.toBuffer(),
                    ], stakeProgram)[0],
                    switchVault: PublicKey.findProgramAddressSync([
                        Buffer.from("RewardPool"),
                        delegationPool.toBuffer(),
                        switchMint.toBuffer(),
                    ], stakeProgram)[0],
                    stakeProgram: stakeProgram,
                    stakePool: stakePool,
                },
            });
            return ix;
        });
    }
    setConfigsIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            const ix = yield this.program.instruction.oracleSetConfigs({
                authority: params.authority,
                newSecpAuthority: null,
            }, {
                accounts: {
                    oracle: this.pubkey,
                    authority: params.authority,
                },
            });
            return ix;
        });
    }
    /**
     *  Loads the oracle data for this {@linkcode Oracle} account from on chain.
     *
     *  @returns A promise that resolves to the oracle data.
     *  @throws if the oracle account does not exist.
     */
    loadData() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.program.account["oracleAccountData"].fetch(this.pubkey);
        });
    }
    fetchGateway() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            const gw = Buffer.from(data.gatewayUri).toString();
            return gw.replace(/\0+$/, "");
        });
    }
    /**
     * Loads the oracle data for a list of {@linkcode Oracle} accounts from on chain.
     *
     * @param program - The program that owns the oracle accounts.
     * @param keys - The public keys of the oracle accounts to load.
     * @returns A promise that resolves to an array of oracle data.
     * @throws if any of the oracle accounts do not exist.
     */
    static loadMany(program, keys) {
        return __awaiter(this, void 0, void 0, function* () {
            const coder = new BorshAccountsCoder(program.idl);
            const accountType = "oracleAccountData";
            const oracleDatas = yield utils.rpc
                .getMultipleAccounts(program.provider.connection, keys)
                .then((o) => o.map((x) => coder.decode(accountType, x.account.data)));
            return oracleDatas;
        });
    }
    /**
     * Loads the oracle data and checks if the oracle is verified.
     *
     * @returns A promise that resolves to a tuple containing a boolean indicating
     * if the oracle is verified and the expiration time of the verification.
     * @throws if the oracle account does not exist.
     */
    verificationStatus() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            const now = +new Date() / 1000;
            const status = data.enclave.verificationStatus;
            const expiration = data.enclave.validUntil;
            return [status === 4 && now < expiration, expiration.toNumber()];
        });
    }
    /**
     * Get the pubkey of the stats account for this oracle.
     * @returns A promise that resolves to the pubkey of the stats account.
     */
    statsKey() {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield PublicKey.findProgramAddress([Buffer.from("OracleStats"), this.pubkey.toBuffer()], this.program.programId))[0];
        });
    }
    lutKey() {
        return __awaiter(this, void 0, void 0, function* () {
            const payer = this.program.provider.wallet.payer;
            const data = yield this.loadData();
            const lutSigner = (yield PublicKey.findProgramAddress([Buffer.from("LutSigner"), this.pubkey.toBuffer()], this.program.programId))[0];
            const [_, lutKey] = yield AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot: data.lutSlot,
            });
            return lutKey;
        });
    }
    lookupTableKey(data) {
        const lutSigner = PublicKey.findProgramAddressSync([Buffer.from("LutSigner"), this.pubkey.toBuffer()], this.program.programId)[0];
        const [_, lutKey] = AddressLookupTableProgram.createLookupTable({
            authority: lutSigner,
            payer: PublicKey.default,
            recentSlot: data.lutSlot,
        });
        return lutKey;
    }
    loadLookupTable() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.lut !== null && this.lut !== undefined) {
                return this.lut;
            }
            const lutKey = yield this.lutKey();
            const accnt = yield this.program.provider.connection.getAddressLookupTable(lutKey);
            this.lut = accnt.value;
            return this.lut;
        });
    }
}
//# sourceMappingURL=oracle.js.map