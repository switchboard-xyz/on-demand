import type { Program } from "@coral-xyz/anchor-30";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
export declare enum SwitchboardPermission {
    PermitOracleHeartbeat = 1,
    PermitOracleQueueUsage = 2
}
/**
 *  Abstraction around the Switchboard-On-Demand Permission meta-account
 */
export declare class Permission {
    /**
     *  Set the permission for a given granter and grantee.
     *
     *  @param program - The program that owns the permission account.
     *  @param params - The parameters for setting the permission.
     *  @returns A promise that resolves to the transaction instruction.
     */
    static setIx(program: Program, params: {
        authority: PublicKey;
        granter: PublicKey;
        grantee: PublicKey;
        enable?: boolean;
        permission: SwitchboardPermission;
    }): Promise<TransactionInstruction>;
    /**
     *  Disable object instantiation.
     */
    private constructor();
}
//# sourceMappingURL=permission.d.ts.map