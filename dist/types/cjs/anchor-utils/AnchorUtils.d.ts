import * as anchor from "@coral-xyz/anchor-30";
import NodeWallet from "@coral-xyz/anchor-30/dist/cjs/nodewallet.js";
import type { Commitment } from "@solana/web3.js";
import { Connection, Keypair } from "@solana/web3.js";
type SolanaConfig = {
    rpcUrl: string;
    webSocketUrl: string;
    keypairPath: string;
    commitment: Commitment;
    keypair: Keypair;
    connection: Connection;
    provider: anchor.AnchorProvider;
    wallet: NodeWallet;
    program: anchor.Program | null;
};
export declare class AnchorUtils {
    /**
     * Initializes a wallet from a file.
     *
     * @param {string} filePath - The path to the file containing the wallet's secret key.
     * @returns {Promise<[NodeWallet, Keypair]>} A promise that resolves to a tuple containing the wallet and the keypair.
     */
    static initWalletFromFile(filePath: string): Promise<[NodeWallet, Keypair]>;
    /**
     * Initializes a keypair from a file.
     *
     * @param {string} filePath - The path to the file containing the keypair's secret key.
     * @returns {Promise<Keypair>} A promise that resolves to the keypair.
     */
    static initKeypairFromFile(filePath: string): Promise<Keypair>;
    /**
     * Loads an Anchor program from the environment.
     *
     * @returns {Promise<anchor.Program>} A promise that resolves to the loaded Anchor program.
     */
    static loadProgramFromEnv(): Promise<anchor.Program>;
    /**
     * Loads the same environment set for the Solana CLI.
     *
     * @returns {Promise<SolanaConfig>} A promise that resolves to the Solana configuration.
     */
    static loadEnv(): Promise<SolanaConfig>;
    /**
     * Parse out anchor events from the logs present in the program IDL.
     *
     * @param {anchor.Program} program - The Anchor program instance.
     * @param {string[]} logs - The array of logs to parse.
     * @returns {any[]} An array of parsed events.
     */
    static loggedEvents(program: anchor.Program, logs: string[]): any[];
}
export {};
//# sourceMappingURL=AnchorUtils.d.ts.map