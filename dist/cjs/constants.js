"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IX_SYSVAR_ID = exports.SLOT_HASHES_SYSVAR_ID = exports.SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = void 0;
const web3_js_1 = require("@solana/web3.js");
/**
 * The public key of the Solana SPL Associated Token Account program.
 */
exports.SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new web3_js_1.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/**
 * The public key of the Solana SlotHashes sysvar.
 */
exports.SLOT_HASHES_SYSVAR_ID = new web3_js_1.PublicKey("SysvarS1otHashes111111111111111111111111111");
/**
 * The public key of the Solana Instructions sysvar.
 */
exports.IX_SYSVAR_ID = new web3_js_1.PublicKey("Sysvar1nstructions1111111111111111111111111");
//# sourceMappingURL=constants.js.map