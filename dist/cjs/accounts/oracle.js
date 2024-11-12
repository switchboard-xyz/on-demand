"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Oracle = void 0;
const spl = __importStar(require("./../utils/index.js"));
const state_js_1 = require("./state.js");
const anchor_30_1 = require("@coral-xyz/anchor-30");
const web3_js_1 = require("@solana/web3.js");
/**
 *  This class represents an oracle account on chain.
 */
class Oracle {
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
            const stateKey = state_js_1.State.keyFromSeed(program);
            const state = yield state_js_1.State.loadData(program);
            const payer = program.provider.wallet.payer;
            const oracle = web3_js_1.Keypair.generate();
            const oracleStats = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("OracleStats"), oracle.publicKey.toBuffer()], program.programId))[0];
            const lutSigner = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("LutSigner"), oracle.publicKey.toBuffer()], program.programId))[0];
            const [delegationPool] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Delegation"),
                stateKey.toBuffer(),
                oracleStats.toBuffer(),
                state.stakePool.toBuffer(),
            ], state.stakeProgram);
            const recentSlot = yield program.provider.connection.getSlot("finalized");
            const [_, lut] = web3_js_1.AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot,
            });
            const [delegationGroup] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Group"),
                stateKey.toBuffer(),
                state.stakePool.toBuffer(),
                params.queue.toBuffer(),
            ], state.stakeProgram);
            const ix = yield program.instruction.oracleInit({
                recentSlot: new anchor_30_1.BN(recentSlot.toString()),
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
                    systemProgram: web3_js_1.SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    tokenMint: spl.NATIVE_MINT,
                    delegationPool,
                    lutSigner,
                    lut,
                    addressLookupTableProgram: web3_js_1.AddressLookupTableProgram.programId,
                    switchMint: state.switchMint,
                    wsolVault: spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, oracle.publicKey),
                    switchVault: spl.getAssociatedTokenAddressSync(state.switchMint, oracle.publicKey),
                    stakeProgram: state.stakeProgram,
                    stakePool: state.stakePool,
                },
            });
            const ix2 = yield program.instruction.oracleUpdateDelegation({
                recentSlot: new anchor_30_1.BN(recentSlot.toString()),
            }, {
                accounts: {
                    oracle: oracle.publicKey,
                    oracleStats,
                    queue: params.queue,
                    authority: payer.publicKey,
                    programState: stateKey,
                    payer: payer.publicKey,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    delegationPool,
                    lutSigner,
                    lut,
                    addressLookupTableProgram: web3_js_1.AddressLookupTableProgram.programId,
                    switchMint: state.switchMint,
                    nativeMint: spl.NATIVE_MINT,
                    wsolVault: web3_js_1.PublicKey.findProgramAddressSync([
                        Buffer.from("RewardPool"),
                        delegationPool.toBuffer(),
                        spl.NATIVE_MINT.toBuffer(),
                    ], state.stakeProgram)[0],
                    switchVault: web3_js_1.PublicKey.findProgramAddressSync([
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
    /**
     * Creates a new oracle account for SVM chains (non-solana). linked to the specified queue.
     * After creation the oracle still must receive run approval and verify their
     * enclave measurement.
     * @param program - The program that owns the oracle account.
     * @param params.queue - The queue that the oracle will be linked to.
     * @returns A promise that resolves to a tuple containing the oracle account
     * and the transaction signature.
     *
     */
    static createSVM(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const stateKey = state_js_1.State.keyFromSeed(program);
            const state = yield state_js_1.State.loadData(program);
            const payer = program.provider.wallet.payer;
            // Generate the queue PDA for the given source queue key
            const [oracle] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Oracle"),
                params.queue.toBuffer(),
                params.sourceOracleKey.toBuffer(),
            ], program.programId);
            const oracleStats = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("OracleStats"), oracle.toBuffer()], program.programId))[0];
            const lutSigner = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("LutSigner"), oracle.toBuffer()], program.programId))[0];
            const [delegationPool] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Delegation"),
                stateKey.toBuffer(),
                oracleStats.toBuffer(),
                state.stakePool.toBuffer(),
            ], state.stakeProgram);
            const recentSlot = yield program.provider.connection.getSlot("finalized");
            const [_, lut] = web3_js_1.AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot,
            });
            const [delegationGroup] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Group"),
                stateKey.toBuffer(),
                state.stakePool.toBuffer(),
                params.queue.toBuffer(),
            ], state.stakeProgram);
            const ix = program.instruction.oracleInitSvm({
                recentSlot: new anchor_30_1.BN(recentSlot.toString()),
                authority: payer.publicKey,
                queue: params.queue,
                secpAuthority: null,
                sourceOracleKey: params.sourceOracleKey,
            }, {
                accounts: {
                    oracle: oracle,
                    oracleStats,
                    authority: payer.publicKey,
                    programState: stateKey,
                    payer: payer.publicKey,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    tokenMint: spl.NATIVE_MINT,
                    delegationPool,
                    lutSigner,
                    lut,
                    addressLookupTableProgram: web3_js_1.AddressLookupTableProgram.programId,
                    switchMint: state.switchMint,
                    wsolVault: spl.getAssociatedTokenAddressSync(spl.NATIVE_MINT, oracle, true),
                    switchVault: spl.getAssociatedTokenAddressSync(state.switchMint, oracle, true),
                    stakeProgram: state.stakeProgram,
                    stakePool: state.stakePool,
                },
            });
            return [new Oracle(program, oracle), [ix]];
        });
    }
    /**
     * ATODO: wrap this one up with the gateway bridge oracle fn
     * @param params
     * @returns
     */
    static quoteVerifySvmIx(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            // const [queuePDA, queueBump] = await PublicKey.findProgramAddress(
            //   [Buffer.from("Queue"), params.queue.toBuffer()],
            //   program.programId
            // );
            // timestamp handled by bridge fn
            // mrEnclave handled by bridge fn
            // secp256k1Key handled by bridge fn
            // slot has to be handled by us I think
            // signature has to be handled by bridge fn
            // recoveryId has to be handled by bridge fn
            // guardian key & oracle key
            // source oracle key handled by us:
            // source oracle queue key handled by us:
            // source guardian queue key handled by us:
            // const ix = await program.instruction.guardianQuoteVerifySvm(
            //   {
            //     timestamp: new anchor.BN(params.timestamp),
            //     mrEnclave: params.mrEnclave, // 32-byte array
            //     _reserved1: params._reserved1, // 32-bit unsigned integer
            //     secp256k1Key: params.secp256k1Key, // 64-byte array
            //     slot: new anchor.BN(params.slot), // Slot as u64
            //     signature: params.signature, // 64-byte array
            //     recoveryId: params.recoveryId, // u8
            //     sourceOracleKey: params.sourceOracleKey, // Pubkey of source oracle
            //     sourceOracleQueueKey: params.sourceOracleQueueKey, // Pubkey of oracle queue
            //     sourceGuardianQueueKey: params.sourceGuardianQueueKey, // Pubkey of guardian queue
            //     oracleBump: params.oracleBump, // Bump for oracle PDA
            //     oracleQueueBump: params.oracleQueueBump, // Bump for oracle queue PDA
            //     guardianQueueBump: params.guardianQueueBump, // Bump for guardian queue PDA
            //   },
            //   {
            //     accounts: {
            //       guardian: guardianAccountLoader, // AccountLoader for OracleAccountData
            //       oracle: oracleAccountLoader, // AccountLoader for OracleAccountData
            //       oracleStats: oracleStatsAccountLoader, // AccountLoader for OracleStatsAccountData
            //       payer: payer.publicKey, // Signer for transaction
            //       systemProgram: SystemProgram.programId, // System program ID
            //       oracleQueue: oracleQueueAccountLoader, // AccountLoader for QueueAccountData
            //       guardianQueue: guardianQueueAccountLoader, // AccountLoader for QueueAccountData
            //       state: stateAccountLoader, // AccountLoader for State
            //       recentSlothashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY, // Sysvar slot hashes
            //       lutSigner: lutSignerAccount, // AccountInfo for lut signer
            //       lut: lutAccount, // AccountInfo for lut (lookup table)
            //       programState: programStateAccountLoader, // AccountLoader for State
            //     },
            //     signers: [payer], // Add payer as the signer for the instruction
            //   }
            // );
            throw new Error("Quote verify SVM not implemented yet.");
        });
    }
    updateDelegationRewardPoolsIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const program = this.program;
            const stateKey = state_js_1.State.keyFromSeed(program);
            const state = yield state_js_1.State.loadData(program);
            const switchMint = (_a = params.overrideMint) !== null && _a !== void 0 ? _a : state.switchMint;
            const stakePool = (_b = params.overrideStakePool) !== null && _b !== void 0 ? _b : state.stakePool;
            const stakeProgram = state.stakeProgram;
            const payer = program.provider.wallet.payer;
            const oracleData = yield this.loadData();
            const oracleStats = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("OracleStats"), this.pubkey.toBuffer()], program.programId))[0];
            const lutSigner = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("LutSigner"), this.pubkey.toBuffer()], program.programId))[0];
            const [delegationPool] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Delegation"),
                stateKey.toBuffer(),
                oracleStats.toBuffer(),
                stakePool.toBuffer(),
            ], stakeProgram);
            console.log("stakepool", stakePool.toBase58());
            console.log("delegationPool", delegationPool.toBase58());
            const lutSlot = oracleData.lutSlot.toNumber();
            const [_, lut] = web3_js_1.AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot: lutSlot,
            });
            const [delegationGroup] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Group"),
                stateKey.toBuffer(),
                state.stakePool.toBuffer(),
                oracleData.queue.toBuffer(),
            ], stakeProgram);
            const ix = yield program.instruction.oracleUpdateDelegation({
                recentSlot: new anchor_30_1.BN(lutSlot.toString()),
            }, {
                accounts: {
                    oracle: this.pubkey,
                    oracleStats,
                    queue: oracleData.queue,
                    authority: params.authority,
                    programState: stateKey,
                    payer: payer.publicKey,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    delegationPool,
                    lutSigner,
                    lut,
                    addressLookupTableProgram: web3_js_1.AddressLookupTableProgram.programId,
                    switchMint: switchMint,
                    nativeMint: spl.NATIVE_MINT,
                    wsolVault: web3_js_1.PublicKey.findProgramAddressSync([
                        Buffer.from("RewardPool"),
                        delegationPool.toBuffer(),
                        spl.NATIVE_MINT.toBuffer(),
                    ], stakeProgram)[0],
                    switchVault: web3_js_1.PublicKey.findProgramAddressSync([
                        Buffer.from("RewardPool"),
                        delegationPool.toBuffer(),
                        switchMint.toBuffer(),
                    ], stakeProgram)[0],
                    stakeProgram: stakeProgram,
                    stakePool: stakePool,
                    delegationGroup,
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
            const coder = new anchor_30_1.BorshAccountsCoder(program.idl);
            const accountType = "oracleAccountData";
            const oracleDatas = yield anchor_30_1.utils.rpc
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
            return (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("OracleStats"), this.pubkey.toBuffer()], this.program.programId))[0];
        });
    }
    lutKey() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            const lutSigner = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("LutSigner"), this.pubkey.toBuffer()], this.program.programId))[0];
            const [_, lutKey] = yield web3_js_1.AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: web3_js_1.PublicKey.default,
                recentSlot: data.lutSlot,
            });
            return lutKey;
        });
    }
    lookupTableKey(data) {
        const lutSigner = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("LutSigner"), this.pubkey.toBuffer()], this.program.programId)[0];
        const [_, lutKey] = web3_js_1.AddressLookupTableProgram.createLookupTable({
            authority: lutSigner,
            payer: web3_js_1.PublicKey.default,
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
exports.Oracle = Oracle;
//# sourceMappingURL=oracle.js.map