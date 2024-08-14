import * as anchor from "@coral-xyz/anchor-30";
import type { Connection } from "@solana/web3.js";
/**
 * Abstraction around the SysvarS1otHashes111111111111111111111111111 sysvar
 * This sysvar is used to store the recent slot hashes
 */
export declare class RecentSlotHashes {
    /**
     *  Disable object instantiation.
     */
    private constructor();
    /**
     * Fetches the latest slot hash from the sysvar.
     * @param connection The connection to use.
     * @returns A promise that resolves to the latest slot number and hash.
     */
    static fetchLatest(connection: Connection): Promise<[anchor.BN, string]>;
    static fetchLatestNSlothashes(connection: Connection, n: number): Promise<Array<[anchor.BN, string]>>;
}
//# sourceMappingURL=recentSlothashes.d.ts.map