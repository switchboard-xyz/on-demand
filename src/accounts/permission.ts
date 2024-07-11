import type { Program } from "@coral-xyz/anchor-30";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

export enum SwitchboardPermission {
  PermitOracleHeartbeat = 1 << 0,
  PermitOracleQueueUsage = 1 << 1,
}

/**
 *  Abstraction around the Switchboard-On-Demand Permission meta-account
 */
export class Permission {
  /**
   *  Set the permission for a given granter and grantee.
   *
   *  @param program - The program that owns the permission account.
   *  @param params - The parameters for setting the permission.
   *  @returns A promise that resolves to the transaction instruction.
   */
  static async setIx(
    program: Program,
    params: {
      authority: PublicKey;
      granter: PublicKey;
      grantee: PublicKey;
      enable?: boolean;
      permission: SwitchboardPermission;
    }
  ): Promise<TransactionInstruction> {
    const payer = (program.provider as any).wallet.payer;
    const ix = await program.instruction.permissionSet(
      {
        enable: params.enable ?? false,
        permission: params.permission,
      },
      {
        accounts: {
          granter: params.granter,
          authority: params.authority,
        },
        remainingAccounts: [
          { pubkey: params.grantee, isSigner: false, isWritable: true },
        ],
        signers: [payer],
      }
    );
    return ix;
  }

  /**
   *  Disable object instantiation.
   */
  private constructor() {}
}
