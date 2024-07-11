import { SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID } from "../constants.js";

import { TOKEN_PROGRAM_ID } from "./../utils/index.js";

import { PublicKey } from "@solana/web3.js";

export class AssociatedTokenProgram {
  private constructor() {}
  /**
   * Find the associated token address for the given wallet and token mint
   */
  findAssociatedTokenAddress(
    walletAddress: PublicKey,
    tokenMintAddress: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        walletAddress.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        tokenMintAddress.toBuffer(),
      ],
      SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    );
  }
}
