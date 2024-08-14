var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export var SwitchboardPermission;
(function (SwitchboardPermission) {
    SwitchboardPermission[SwitchboardPermission["PermitOracleHeartbeat"] = 1] = "PermitOracleHeartbeat";
    SwitchboardPermission[SwitchboardPermission["PermitOracleQueueUsage"] = 2] = "PermitOracleQueueUsage";
})(SwitchboardPermission || (SwitchboardPermission = {}));
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
    static setIx(program, params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const payer = program.provider.wallet.payer;
            const ix = yield program.instruction.permissionSet({
                enable: (_a = params.enable) !== null && _a !== void 0 ? _a : false,
                permission: params.permission,
            }, {
                accounts: {
                    granter: params.granter,
                    authority: params.authority,
                },
                remainingAccounts: [
                    { pubkey: params.grantee, isSigner: false, isWritable: true },
                ],
                signers: [payer],
            });
            return ix;
        });
    }
    /**
     *  Disable object instantiation.
     */
    constructor() { }
}
//# sourceMappingURL=permission.js.map