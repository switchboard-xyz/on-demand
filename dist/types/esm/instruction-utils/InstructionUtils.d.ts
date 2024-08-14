import type { AddressLookupTableAccount, Connection, PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
export declare class InstructionUtils {
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
    static asV0TxWithComputeIxs(params: {
        connection: Connection;
        ixs: TransactionInstruction[];
        payer?: PublicKey;
        computeUnitLimitMultiple?: number;
        computeUnitPrice?: number;
        lookupTables?: AddressLookupTableAccount[];
        signers?: Signer[];
    }): Promise<VersionedTransaction>;
}
//# sourceMappingURL=InstructionUtils.d.ts.map