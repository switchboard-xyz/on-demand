import { PublicKey } from "@solana/web3.js";
export declare class AssociatedTokenProgram {
    private constructor();
    /**
     * Find the associated token address for the given wallet and token mint
     */
    findAssociatedTokenAddress(walletAddress: PublicKey, tokenMintAddress: PublicKey): [PublicKey, number];
}
//# sourceMappingURL=associatedToken.d.ts.map