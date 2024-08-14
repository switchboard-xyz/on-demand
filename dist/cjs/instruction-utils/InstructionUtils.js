"use strict";
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
exports.InstructionUtils = void 0;
const web3_js_1 = require("@solana/web3.js");
const web3_js_2 = require("@solana/web3.js");
/*
 * Utilities namespace for instruction related functions
 * */
class InstructionUtils {
    /**
     * Function to convert transaction instructions to a versioned transaction.
     *
     * @param {object} params - The parameters object.
     * @param {Connection} params.connection - The connection to use.
     * @param {TransactionInstruction[]} params.ixs - The transaction instructions.
     * @param {PublicKey} [params.payer] - The payer for the transaction.
     * @param {number} [params.computeUnitLimitMultiple] - The compute units to cap the transaction as a multiple of the simulated units consumed (e.g., 1.25x).
     * @param {number} [params.computeUnitPrice] - The price per compute unit in microlamports.
     * @param {AddressLookupTableAccount[]} [params.lookupTables] - The address lookup tables.
     * @param {Signer[]} [params.signers] - The signers for the transaction.
     * @returns {Promise<VersionedTransaction>} A promise that resolves to the versioned transaction.
     */
    static asV0TxWithComputeIxs(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            let payer = params.payer;
            if (payer === undefined && ((_a = params.signers) !== null && _a !== void 0 ? _a : []).length === 0) {
                throw new Error("Payer not provided");
            }
            if (payer === undefined) {
                payer = params.signers[0].publicKey;
            }
            const priorityFeeIx = web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: (_b = params.computeUnitPrice) !== null && _b !== void 0 ? _b : 0,
            });
            const simulationComputeLimitIx = web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({
                units: 1400000, // 1.4M compute units
            });
            const recentBlockhash = (yield params.connection.getLatestBlockhash())
                .blockhash;
            const simulateMessageV0 = new web3_js_2.TransactionMessage({
                recentBlockhash,
                instructions: [priorityFeeIx, simulationComputeLimitIx, ...params.ixs],
                payerKey: payer,
            }).compileToV0Message((_c = params.lookupTables) !== null && _c !== void 0 ? _c : []);
            const simulateTx = new web3_js_2.VersionedTransaction(simulateMessageV0);
            try {
                simulateTx.serialize();
            }
            catch (e) {
                if (e instanceof RangeError) {
                    throw new Error("Transaction failed to serialize: Transaction too large");
                }
                throw e;
            }
            const simulationResult = yield params.connection.simulateTransaction(simulateTx, {
                commitment: "processed",
                sigVerify: false,
            });
            const simulationUnitsConsumed = simulationResult.value.unitsConsumed;
            const computeLimitIx = web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({
                units: Math.floor(simulationUnitsConsumed * ((_d = params.computeUnitLimitMultiple) !== null && _d !== void 0 ? _d : 1)),
            });
            const messageV0 = new web3_js_2.TransactionMessage({
                recentBlockhash,
                instructions: [priorityFeeIx, computeLimitIx, ...params.ixs],
                payerKey: payer,
            }).compileToV0Message((_e = params.lookupTables) !== null && _e !== void 0 ? _e : []);
            const tx = new web3_js_2.VersionedTransaction(messageV0);
            tx.sign((_f = params.signers) !== null && _f !== void 0 ? _f : []);
            return tx;
        });
    }
}
exports.InstructionUtils = InstructionUtils;
//# sourceMappingURL=InstructionUtils.js.map