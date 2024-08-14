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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecentSlotHashes = void 0;
const constants_js_1 = require("../constants.js");
const anchor = __importStar(require("@coral-xyz/anchor-30"));
const bs58_1 = __importDefault(require("bs58"));
/**
 * Abstraction around the SysvarS1otHashes111111111111111111111111111 sysvar
 * This sysvar is used to store the recent slot hashes
 */
class RecentSlotHashes {
    /**
     *  Disable object instantiation.
     */
    constructor() { }
    /**
     * Fetches the latest slot hash from the sysvar.
     * @param connection The connection to use.
     * @returns A promise that resolves to the latest slot number and hash.
     */
    static fetchLatest(connection) {
        return __awaiter(this, void 0, void 0, function* () {
            const accountInfo = yield connection.getAccountInfo(constants_js_1.SLOT_HASHES_SYSVAR_ID, {
                commitment: "confirmed",
                dataSlice: { length: 40, offset: 8 },
            });
            if (!accountInfo) {
                throw new Error("Failed to get account info");
            }
            const buffer = accountInfo.data;
            const slotNumber = buffer.readBigUInt64LE(0);
            const encoded = bs58_1.default.encode(Uint8Array.prototype.slice.call(buffer, 8));
            return [new anchor.BN(slotNumber.toString()), encoded];
        });
    }
    static fetchLatestNSlothashes(connection, n) {
        return __awaiter(this, void 0, void 0, function* () {
            const accountInfo = yield connection.getAccountInfo(constants_js_1.SLOT_HASHES_SYSVAR_ID, {
                commitment: "confirmed",
                dataSlice: { length: 40 * Math.floor(n), offset: 8 },
            });
            if (!accountInfo) {
                throw new Error("Failed to get account info");
            }
            const out = [];
            const buffer = accountInfo.data;
            for (let i = 0; i < n; i++) {
                const slotNumber = buffer.readBigUInt64LE(i * 40);
                const hashStart = i * 40 + 8;
                const hashEnd = hashStart + 32;
                const encoded = bs58_1.default.encode(Uint8Array.prototype.slice.call(buffer, hashStart, hashEnd));
                out.push([new anchor.BN(slotNumber.toString()), encoded]);
            }
            return out;
        });
    }
}
exports.RecentSlotHashes = RecentSlotHashes;
//# sourceMappingURL=recentSlothashes.js.map