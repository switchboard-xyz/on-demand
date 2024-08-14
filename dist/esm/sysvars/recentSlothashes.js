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
import * as anchor from "@coral-xyz/anchor-30";
import bs58 from "bs58";
/**
 * Abstraction around the SysvarS1otHashes111111111111111111111111111 sysvar
 * This sysvar is used to store the recent slot hashes
 */
export class RecentSlotHashes {
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
            const accountInfo = yield connection.getAccountInfo(SLOT_HASHES_SYSVAR_ID, {
                commitment: "confirmed",
                dataSlice: { length: 40, offset: 8 },
            });
            if (!accountInfo) {
                throw new Error("Failed to get account info");
            }
            const buffer = accountInfo.data;
            const slotNumber = buffer.readBigUInt64LE(0);
            const encoded = bs58.encode(Uint8Array.prototype.slice.call(buffer, 8));
            return [new anchor.BN(slotNumber.toString()), encoded];
        });
    }
    static fetchLatestNSlothashes(connection, n) {
        return __awaiter(this, void 0, void 0, function* () {
            const accountInfo = yield connection.getAccountInfo(SLOT_HASHES_SYSVAR_ID, {
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
                const encoded = bs58.encode(Uint8Array.prototype.slice.call(buffer, hashStart, hashEnd));
                out.push([new anchor.BN(slotNumber.toString()), encoded]);
            }
            return out;
        });
    }
}
//# sourceMappingURL=recentSlothashes.js.map