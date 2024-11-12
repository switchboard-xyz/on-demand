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
exports.Queue = void 0;
const gateway_js_1 = require("../oracle-interfaces/gateway.js");
const utils_1 = require("../utils");
const spl = __importStar(require("./../utils/index.js"));
const permission_js_1 = require("./permission.js");
const state_js_1 = require("./state.js");
const anchor = __importStar(require("@coral-xyz/anchor-30"));
const anchor_30_1 = require("@coral-xyz/anchor-30");
const web3_js_1 = require("@solana/web3.js");
function withTimeout(promise, timeoutMs) {
    // Create a timeout promise that resolves to null after timeoutMs milliseconds
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeoutMs, null));
    // Race the timeout promise against the original promise
    return Promise.race([promise, timeoutPromise]);
}
/**
 *  Removes trailing null bytes from a string.
 *
 *  @param input The input string.
 *  @returns The input string with trailing null bytes removed.
 */
function removeTrailingNullBytes(input) {
    // Regular expression to match trailing null bytes
    const trailingNullBytesRegex = /\x00+$/;
    // Remove trailing null bytes using the replace() method
    return input.replace(trailingNullBytesRegex, "");
}
function runWithTimeout(task, timeoutMs) {
    return new Promise((resolve, reject) => {
        // Set up the timeout
        const timer = setTimeout(() => {
            resolve("timeout");
        }, timeoutMs);
        task.then((result) => {
            clearTimeout(timer);
            resolve(result);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
/**
 *  Abstraction around the Switchboard-On-Demand Queue account
 *
 *  This account is used to store the queue data for a given feed.
 */
class Queue {
    static createIx(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const stateKey = state_js_1.State.keyFromSeed(program);
            const state = yield state_js_1.State.loadData(program);
            const queue = web3_js_1.Keypair.generate();
            const allowAuthorityOverrideAfter = (_a = params.allowAuthorityOverrideAfter) !== null && _a !== void 0 ? _a : 60 * 60;
            const requireAuthorityHeartbeatPermission = (_b = params.requireAuthorityHeartbeatPermission) !== null && _b !== void 0 ? _b : true;
            const requireUsagePermission = (_c = params.requireUsagePermission) !== null && _c !== void 0 ? _c : false;
            const maxQuoteVerificationAge = (_d = params.maxQuoteVerificationAge) !== null && _d !== void 0 ? _d : 60 * 60 * 24 * 7;
            const reward = (_e = params.reward) !== null && _e !== void 0 ? _e : 1000000;
            const nodeTimeout = (_f = params.nodeTimeout) !== null && _f !== void 0 ? _f : 300;
            const payer = program.provider.wallet.payer;
            // Prepare accounts for the transaction
            const lutSigner = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("LutSigner"), queue.publicKey.toBuffer()], program.programId))[0];
            const [delegationGroup] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Group"),
                stateKey.toBuffer(),
                state.stakePool.toBuffer(),
                queue.publicKey.toBuffer(),
            ], state.stakeProgram);
            const recentSlot = (_g = params.lutSlot) !== null && _g !== void 0 ? _g : (yield program.provider.connection.getSlot("finalized"));
            const [_, lut] = web3_js_1.AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot,
            });
            let stakePool = state.stakePool;
            if (stakePool.equals(web3_js_1.PublicKey.default)) {
                stakePool = payer.publicKey;
            }
            const queueAccount = new Queue(program, queue.publicKey);
            const ix = yield program.instruction.queueInit({
                allowAuthorityOverrideAfter,
                requireAuthorityHeartbeatPermission,
                requireUsagePermission,
                maxQuoteVerificationAge,
                reward,
                nodeTimeout,
                recentSlot: new anchor.BN(recentSlot),
            }, {
                accounts: {
                    queue: queue.publicKey,
                    queueEscrow: yield spl.getAssociatedTokenAddress(spl.NATIVE_MINT, queue.publicKey),
                    authority: payer.publicKey,
                    payer: payer.publicKey,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    nativeMint: spl.NATIVE_MINT,
                    programState: state_js_1.State.keyFromSeed(program),
                    lutSigner: yield queueAccount.lutSigner(),
                    lut: yield queueAccount.lutKey(recentSlot),
                    addressLookupTableProgram: web3_js_1.AddressLookupTableProgram.programId,
                    delegationGroup,
                    stakeProgram: state.stakeProgram,
                    stakePool: stakePool,
                    associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                signers: [payer, queue],
            });
            return [new Queue(program, queue.publicKey), queue, ix];
        });
    }
    /**
     * Creates a new instance of the `Queue` account with a PDA for SVM (non-solana) chains.
     * @param program The anchor program instance.
     * @param params The initialization parameters for the queue.
     * @returns
     */
    static createIxSVM(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const stateKey = state_js_1.State.keyFromSeed(program);
            const state = yield state_js_1.State.loadData(program);
            // Generate the queue PDA for the given source queue key
            const [queue] = yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("Queue"), params.sourceQueueKey.toBuffer()], program.programId);
            const allowAuthorityOverrideAfter = (_a = params.allowAuthorityOverrideAfter) !== null && _a !== void 0 ? _a : 60 * 60;
            const requireAuthorityHeartbeatPermission = (_b = params.requireAuthorityHeartbeatPermission) !== null && _b !== void 0 ? _b : true;
            const requireUsagePermission = (_c = params.requireUsagePermission) !== null && _c !== void 0 ? _c : false;
            const maxQuoteVerificationAge = (_d = params.maxQuoteVerificationAge) !== null && _d !== void 0 ? _d : 60 * 60 * 24 * 7;
            const reward = (_e = params.reward) !== null && _e !== void 0 ? _e : 1000000;
            const nodeTimeout = (_f = params.nodeTimeout) !== null && _f !== void 0 ? _f : 300;
            const payer = program.provider.wallet.payer;
            // Prepare accounts for the transaction
            const lutSigner = (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("LutSigner"), queue.toBuffer()], program.programId))[0];
            const [delegationGroup] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Group"),
                stateKey.toBuffer(),
                state.stakePool.toBuffer(),
                queue.toBuffer(),
            ], state.stakeProgram);
            const recentSlot = (_g = params.lutSlot) !== null && _g !== void 0 ? _g : (yield program.provider.connection.getSlot("finalized"));
            const [_, lut] = web3_js_1.AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: payer.publicKey,
                recentSlot,
            });
            let stakePool = state.stakePool;
            if (stakePool.equals(web3_js_1.PublicKey.default)) {
                stakePool = payer.publicKey;
            }
            const queueAccount = new Queue(program, queue);
            const ix = program.instruction.queueInitSvm({
                allowAuthorityOverrideAfter,
                requireAuthorityHeartbeatPermission,
                requireUsagePermission,
                maxQuoteVerificationAge,
                reward,
                nodeTimeout,
                recentSlot: new anchor.BN(recentSlot),
                sourceQueueKey: params.sourceQueueKey,
            }, {
                accounts: {
                    queue: queue,
                    queueEscrow: yield spl.getAssociatedTokenAddress(spl.NATIVE_MINT, queue, true),
                    authority: payer.publicKey,
                    payer: payer.publicKey,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    nativeMint: spl.NATIVE_MINT,
                    programState: state_js_1.State.keyFromSeed(program),
                    lutSigner: yield queueAccount.lutSigner(),
                    lut: yield queueAccount.lutKey(recentSlot),
                    addressLookupTableProgram: web3_js_1.AddressLookupTableProgram.programId,
                    delegationGroup,
                    stakeProgram: state.stakeProgram,
                    stakePool: stakePool,
                    associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                },
                signers: [payer],
            });
            return [new Queue(program, queue), ix];
        });
    }
    /**
     * Add an Oracle to a queue and set permissions
     * @param program
     * @param params
     */
    overrideSVM(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const stateKey = state_js_1.State.keyFromSeed(this.program);
            const state = yield state_js_1.State.loadData(this.program);
            const programAuthority = state.authority;
            const { authority } = yield this.loadData();
            if (!authority.equals(programAuthority)) {
                throw new Error("Override failed: Invalid authority");
            }
            const ix = this.program.instruction.queueOverrideSvm({
                secp256K1Signer: Array.from(params.secp256k1Signer),
                maxQuoteVerificationAge: new anchor.BN(params.maxQuoteVerificationAge),
                mrEnclave: params.mrEnclave,
                slot: new anchor.BN(params.slot),
            }, {
                accounts: {
                    queue: this.pubkey,
                    oracle: params.oracle,
                    authority,
                    state: stateKey,
                },
            });
            return ix;
        });
    }
    initDelegationGroupIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const queueAccount = new Queue(this.program, this.pubkey);
            const lutSlot = (_a = params.lutSlot) !== null && _a !== void 0 ? _a : (yield this.loadData()).lutSlot;
            const payer = this.program.provider.wallet.payer;
            const stateKey = state_js_1.State.keyFromSeed(this.program);
            const state = yield state_js_1.State.loadData(this.program);
            const stakePool = (_b = params.overrideStakePool) !== null && _b !== void 0 ? _b : state.stakePool;
            const [delegationGroup] = yield web3_js_1.PublicKey.findProgramAddress([
                Buffer.from("Group"),
                stateKey.toBuffer(),
                stakePool.toBuffer(),
                this.pubkey.toBuffer(),
            ], state.stakeProgram);
            const isMainnet = (0, utils_1.isMainnetConnection)(this.program.provider.connection);
            let pid = utils_1.ON_DEMAND_MAINNET_PID;
            if (!isMainnet) {
                pid = utils_1.ON_DEMAND_DEVNET_PID;
            }
            const [queueEscrowSigner] = yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("Signer"), this.pubkey.toBuffer()], pid);
            const ix = yield this.program.instruction.queueInitDelegationGroup({}, {
                accounts: {
                    queue: this.pubkey,
                    queueEscrow: yield spl.getAssociatedTokenAddress(spl.NATIVE_MINT, this.pubkey),
                    queueEscrowSigner,
                    payer: payer.publicKey,
                    systemProgram: web3_js_1.SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    nativeMint: spl.NATIVE_MINT,
                    programState: stateKey,
                    lutSigner: yield this.lutSigner(),
                    lut: yield this.lutKey(lutSlot),
                    addressLookupTableProgram: web3_js_1.AddressLookupTableProgram.programId,
                    delegationGroup: delegationGroup,
                    stakeProgram: state.stakeProgram,
                    stakePool: stakePool,
                },
            });
            return ix;
        });
    }
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
    static fetchSignatures(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const queueAccount = new Queue(program, params.queue);
            return queueAccount.fetchSignatures(params);
        });
    }
    static fetchSignaturesMulti(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const queueAccount = new Queue(program, params.queue);
            return queueAccount.fetchSignaturesMulti(params);
        });
    }
    static fetchSignaturesBatch(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const queueAccount = new Queue(program, params.queue);
            return queueAccount.fetchSignaturesBatch(params);
        });
    }
    /**
     * @deprecated
     * Deprecated. Use {@linkcode @switchboard-xyz/common#FeedHash.compute} instead.
     */
    static fetchFeedHash(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            const queueAccount = new Queue(program, params.queue);
            const oracleSigs = yield queueAccount.fetchSignatures(params);
            return Buffer.from(oracleSigs[0].feed_hash, "hex");
        });
    }
    /**
     *  Constructs a `OnDemandQueue` instance.
     *
     *  @param program The Anchor program instance.
     *  @param pubkey The public key of the queue account.
     */
    constructor(program, pubkey) {
        this.program = program;
        this.pubkey = pubkey;
        if (this.pubkey === undefined) {
            throw new Error("NoPubkeyProvided");
        }
    }
    /**
     *  Loads the queue data from on chain and returns the listed oracle keys.
     *
     *  @returns A promise that resolves to an array of oracle public keys.
     */
    fetchOracleKeys() {
        return __awaiter(this, void 0, void 0, function* () {
            const program = this.program;
            const queueData = (yield program.account["queueAccountData"].fetch(this.pubkey));
            const oracles = queueData.oracleKeys.slice(0, queueData.oracleKeysLen);
            return oracles;
        });
    }
    /**
     *  Loads the queue data from on chain and returns the listed gateways.
     *
     *  @returns A promise that resolves to an array of gateway URIs.
     */
    fetchAllGateways() {
        return __awaiter(this, void 0, void 0, function* () {
            const queue = this.pubkey;
            const program = this.program;
            const coder = new anchor_30_1.BorshAccountsCoder(program.idl);
            const oracles = yield this.fetchOracleKeys();
            const oracleAccounts = yield anchor_30_1.utils.rpc.getMultipleAccounts(program.provider.connection, oracles);
            const gatewayUris = oracleAccounts
                .map((x) => coder.decode("oracleAccountData", x.account.data))
                .map((x) => String.fromCharCode(...x.gatewayUri))
                .map((x) => removeTrailingNullBytes(x))
                .filter((x) => x.length > 0)
                .filter((x) => !x.includes("infstones"));
            const tests = [];
            for (const i in gatewayUris) {
                const gw = new gateway_js_1.Gateway(program, gatewayUris[i], oracles[i]);
                tests.push(gw.test());
            }
            let gateways = [];
            for (let i = 0; i < tests.length; i++) {
                try {
                    const isGood = yield withTimeout(tests[i], 2000);
                    if (isGood) {
                        gateways.push(new gateway_js_1.Gateway(program, gatewayUris[i], oracles[i]));
                    }
                }
                catch (e) {
                    console.log("Timeout", e);
                }
            }
            gateways = gateways.sort(() => Math.random() - 0.5);
            return gateways;
        });
    }
    /**
     *  Loads the queue data from on chain and returns a random gateway.
     *  @returns A promise that resolves to a gateway interface
     */
    fetchGateway() {
        return __awaiter(this, void 0, void 0, function* () {
            const gateways = yield this.fetchAllGateways();
            if (gateways.length === 0) {
                throw new Error("NoGatewayAvailable");
            }
            return gateways[Math.floor(Math.random() * gateways.length)];
        });
    }
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
    fetchSignatures(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            let gateway = new gateway_js_1.Gateway(this.program, (_a = params.gateway) !== null && _a !== void 0 ? _a : "");
            if (params.gateway === undefined) {
                gateway = yield this.fetchGateway();
            }
            return yield gateway.fetchSignatures(params);
        });
    }
    fetchSignaturesMulti(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            let gateway = new gateway_js_1.Gateway(this.program, (_a = params.gateway) !== null && _a !== void 0 ? _a : "");
            if (params.gateway === undefined) {
                gateway = yield this.fetchGateway();
            }
            return yield gateway.fetchSignaturesMulti(params);
        });
    }
    fetchSignaturesBatch(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            let gateway = new gateway_js_1.Gateway(this.program, (_a = params.gateway) !== null && _a !== void 0 ? _a : "");
            if (params.gateway === undefined) {
                gateway = yield this.fetchGateway();
            }
            return yield gateway.fetchSignaturesBatch(params);
        });
    }
    /**
     *  Loads the queue data for this {@linkcode Queue} account from on chain.
     *
     *  @returns A promise that resolves to the queue data.
     *  @throws if the queue account does not exist.
     */
    loadData() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.program.account["queueAccountData"].fetch(this.pubkey);
        });
    }
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
    addMrEnclaveIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const stateKey = state_js_1.State.keyFromSeed(this.program);
            const state = yield state_js_1.State.loadData(this.program);
            const programAuthority = state.authority;
            const { authority } = yield this.loadData();
            const ix = yield this.program.instruction.queueAddMrEnclave({ mrEnclave: params.mrEnclave }, {
                accounts: {
                    queue: this.pubkey,
                    authority,
                    programAuthority,
                    state: stateKey,
                },
            });
            return ix;
        });
    }
    /**
     *  Removes an MR enclave from the queue.
     *  This will prevent the queue from accepting signatures from the given MR enclave.
     *  @param mrEnclave The MR enclave to remove.
     *  @returns A promise that resolves to the transaction instruction.
     *  @throws if the request fails.
     *  @throws if the MR enclave is not present.
     */
    rmMrEnclaveIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const stateKey = state_js_1.State.keyFromSeed(this.program);
            const state = yield state_js_1.State.loadData(this.program);
            const programAuthority = state.authority;
            const { authority } = yield this.loadData();
            const ix = yield this.program.instruction.queueRemoveMrEnclave({ mrEnclave: params.mrEnclave }, {
                accounts: {
                    queue: this.pubkey,
                    authority,
                    programAuthority,
                    state: stateKey,
                },
            });
            return ix;
        });
    }
    /**
     * Sets the queue configurations.
     * @param params.authority The new authority for the queue.
     * @param params.reward The new reward for the queue.
     * @param params.nodeTimeout The new node timeout for the queue.
     * @returns A promise that resolves to the transaction instruction.
     */
    setConfigsIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const data = yield this.loadData();
            const stateKey = state_js_1.State.keyFromSeed(this.program);
            let nodeTimeout = null;
            if (params.nodeTimeout !== undefined) {
                nodeTimeout = new anchor.BN(params.nodeTimeout);
            }
            const ix = yield this.program.instruction.queueSetConfigs({
                authority: (_a = params.authority) !== null && _a !== void 0 ? _a : null,
                reward: (_b = params.reward) !== null && _b !== void 0 ? _b : null,
                nodeTimeout: nodeTimeout,
            }, {
                accounts: {
                    queue: this.pubkey,
                    authority: data.authority,
                    state: stateKey,
                },
            });
            return ix;
        });
    }
    /**
     * Sets the oracle permission on the queue.
     * @param params.oracle The oracle to set the permission for.
     * @param params.permission The permission to set.
     * @param params.enabled Whether the permission is enabled.
     * @returns A promise that resolves to the transaction instruction   */
    setOraclePermissionIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            return permission_js_1.Permission.setIx(this.program, {
                authority: data.authority,
                grantee: params.oracle,
                granter: this.pubkey,
                permission: params.permission,
                enable: params.enable,
            });
        });
    }
    /**
     *  Removes all MR enclaves from the queue.
     *  @returns A promise that resolves to an array of transaction instructions.
     *  @throws if the request fails.
     */
    rmAllMrEnclaveIxs() {
        return __awaiter(this, void 0, void 0, function* () {
            const { mrEnclaves, mrEnclavesLen } = yield this.loadData();
            const activeEnclaves = mrEnclaves.slice(0, mrEnclavesLen);
            const ixs = [];
            for (const mrEnclave of activeEnclaves) {
                ixs.push(yield this.rmMrEnclaveIx({
                    mrEnclave,
                }));
            }
            return ixs;
        });
    }
    /**
     *  Fetches most recently added and verified Oracle Key.
     *  @returns A promise that resolves to an oracle public key.
     *  @throws if the request fails.
     */
    fetchFreshOracle() {
        return __awaiter(this, void 0, void 0, function* () {
            const coder = new anchor_30_1.BorshAccountsCoder(this.program.idl);
            const now = Math.floor(+new Date() / 1000);
            const oracles = yield this.fetchOracleKeys();
            const oracleAccounts = yield anchor_30_1.utils.rpc.getMultipleAccounts(this.program.provider.connection, oracles);
            const oracleUris = oracleAccounts
                .map((x) => coder.decode("oracleAccountData", x.account.data))
                .map((x) => String.fromCharCode(...x.gatewayUri))
                .map((x) => removeTrailingNullBytes(x))
                .filter((x) => x.length > 0);
            const tests = [];
            for (const i in oracleUris) {
                const gw = new gateway_js_1.Gateway(this.program, oracleUris[i], oracles[i]);
                tests.push(gw.test());
            }
            const zip = [];
            for (let i = 0; i < oracles.length; i++) {
                try {
                    const isGood = yield withTimeout(tests[i], 2000);
                    if (!isGood) {
                        continue;
                    }
                }
                catch (e) {
                    console.log("Gateway Timeout", e);
                }
                zip.push({
                    data: coder.decode("oracleAccountData", oracleAccounts[i].account.data),
                    key: oracles[i],
                });
            }
            const validOracles = zip
                .filter((x) => x.data.enclave.verificationStatus === 4) // value 4 is for verified
                .filter((x) => x.data.enclave.validUntil > now + 3600); // valid for 1 hour at least
            const chosen = validOracles[Math.floor(Math.random() * validOracles.length)];
            return chosen.key;
        });
    }
    /**
     * Get the PDA for the queue (SVM chains that are not solana)
     * @returns Queue PDA Pubkey
     */
    queuePDA() {
        return Queue.queuePDA(this.program, this.pubkey);
    }
    /**
     * Get the PDA for the queue (SVM chains that are not solana)
     * @param program Anchor program
     * @param pubkey Queue pubkey
     * @returns Queue PDA Pubkey
     */
    static queuePDA(program, pubkey) {
        const [queuePDA] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("Queue"), pubkey.toBuffer()], program.programId);
        return queuePDA;
    }
    lutSigner() {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield web3_js_1.PublicKey.findProgramAddress([Buffer.from("LutSigner"), this.pubkey.toBuffer()], this.program.programId))[0];
        });
    }
    lutKey(lutSlot) {
        return __awaiter(this, void 0, void 0, function* () {
            const lutSigner = yield this.lutSigner();
            const [_, lutKey] = yield web3_js_1.AddressLookupTableProgram.createLookupTable({
                authority: lutSigner,
                payer: web3_js_1.PublicKey.default,
                recentSlot: lutSlot,
            });
            return lutKey;
        });
    }
    loadLookupTable() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            const lutKey = yield this.lutKey(data.lutSlot);
            const accnt = yield this.program.provider.connection.getAddressLookupTable(lutKey);
            return accnt.value;
        });
    }
}
exports.Queue = Queue;
//# sourceMappingURL=queue.js.map