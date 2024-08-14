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
import { Queue } from "./queue.js";
import { State } from "./state.js";
import { AddressLookupTableAccount, AddressLookupTableProgram, PublicKey, SystemProgram, } from "@solana/web3.js";
/**
 *  A map of LUTs to their public keys.
 *
 *  Users can initialize to compact all oracle and feed keys they use into a single
 *  account, and then use the LUT to load all tx keys efficiently.
 */
export class LutMap {
    /**
     *  The public key of the LUT map account.
     */
    static keyFromSeed(program, queue, authority) {
        return __awaiter(this, void 0, void 0, function* () {
            const [lut] = PublicKey.findProgramAddressSync([
                Buffer.from("LutMapAccountData"),
                queue.toBuffer(),
                authority.toBuffer(),
            ], program.programId);
            return lut;
        });
    }
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
    static create(program, queue, slot) {
        return __awaiter(this, void 0, void 0, function* () {
            const payer = program.provider.wallet.payer;
            const lutKey = yield LutMap.keyFromSeed(program, queue, payer.publicKey);
            const sig = yield program.rpc.lutMapInit({ slot }, {
                accounts: {
                    lutMap: lutKey,
                    queue: queue,
                    payer: payer.publicKey,
                    authority: payer.publicKey,
                    systemProgram: SystemProgram.programId,
                },
                signers: [payer],
            });
            return [new LutMap(program, lutKey), sig];
        });
    }
    constructor(program, pubkey) {
        this.program = program;
        this.pubkey = pubkey;
    }
    queueLutExtendIx(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const payer = this.program.provider.wallet.payer;
            const queueAccount = new Queue(this.program, params.queue);
            const queueData = yield queueAccount.loadData();
            const lutKey = yield LutMap.keyFromSeed(this.program, params.queue, payer.publicKey);
            const lutSigner = (yield PublicKey.findProgramAddress([Buffer.from("LutSigner"), params.queue.toBuffer()], this.program.programId))[0];
            const ix = yield this.program.instruction.queueLutExtend({ newKey: params.newKey }, {
                accounts: {
                    queue: params.queue,
                    authority: queueData.authority,
                    lutSigner,
                    lut: lutKey,
                    addressLookupTableProgram: AddressLookupTableProgram.programId,
                    payer: payer.publicKey,
                    systemProgram: SystemProgram.programId,
                },
            });
            return ix;
        });
    }
    /**
     *  Loads the data for this {@linkcode LutMap} account from on chain.
     *
     *  @returns A promise that resolves to the data.
     *  @throws if the account does not exist.
     */
    loadData() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.program.account["lutMapAccountData"].fetch(this.pubkey);
        });
    }
    loadLut() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.loadData();
            const lutKey = data.lut;
            const lutAccountInfo = yield this.program.provider.connection.getAccountInfo(lutKey);
            const lutData = AddressLookupTableAccount.deserialize(lutAccountInfo.data);
            return [lutKey, lutData];
        });
    }
    syncLut(feeds) {
        return __awaiter(this, void 0, void 0, function* () {
            const wrapperData = yield this.loadData();
            const [key, data] = yield this.loadLut();
            const queueKey = wrapperData.queue;
            const queue = new Queue(this.program, queueKey);
            const queueData = yield queue.loadData();
            const oracles = queueData.oracleKeys.slice(0, queueData.oracleKeysLen);
            const neededLutAccounts = [];
            neededLutAccounts.push(queueKey);
            neededLutAccounts.push(spl.NATIVE_MINT);
            neededLutAccounts.push(spl.TOKEN_PROGRAM_ID);
            neededLutAccounts.push(spl.ASSOCIATED_TOKEN_PROGRAM_ID);
            neededLutAccounts.push(State.keyFromSeed(this.program));
            for (const oracle of oracles) {
                for (const feed of feeds) {
                    const [statsKey] = PublicKey.findProgramAddressSync([Buffer.from("OracleFeedStats"), feed.toBuffer(), oracle.toBuffer()], this.program.programId);
                    const feedRewardEscrow = yield spl.getAssociatedTokenAddress(spl.NATIVE_MINT, feed);
                    neededLutAccounts.push(statsKey);
                    neededLutAccounts.push(feed);
                    neededLutAccounts.push(oracle);
                    neededLutAccounts.push(feedRewardEscrow);
                }
            }
            // TODO: do anneal here
        });
    }
}
//# sourceMappingURL=lutMap.js.map