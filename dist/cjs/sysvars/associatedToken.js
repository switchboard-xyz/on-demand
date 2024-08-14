"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssociatedTokenProgram = void 0;
const constants_js_1 = require("../constants.js");
const index_js_1 = require("./../utils/index.js");
const web3_js_1 = require("@solana/web3.js");
class AssociatedTokenProgram {
    constructor() { }
    /**
     * Find the associated token address for the given wallet and token mint
     */
    findAssociatedTokenAddress(walletAddress, tokenMintAddress) {
        return web3_js_1.PublicKey.findProgramAddressSync([
            walletAddress.toBuffer(),
            index_js_1.TOKEN_PROGRAM_ID.toBuffer(),
            tokenMintAddress.toBuffer(),
        ], constants_js_1.SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID);
    }
}
exports.AssociatedTokenProgram = AssociatedTokenProgram;
//# sourceMappingURL=associatedToken.js.map