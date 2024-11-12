var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { isMainnetConnection, ON_DEMAND_DEVNET_PID, ON_DEMAND_MAINNET_PID, } from "../utils";
import * as anchor from "@coral-xyz/anchor-30";
import NodeWallet from "@coral-xyz/anchor-30/dist/cjs/nodewallet.js";
import { Connection, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import yaml from "js-yaml";
import os from "os";
import path from "path";
/*
 * AnchorUtils is a utility class that provides helper functions for working with
 * the Anchor framework. It is a static class, meaning that it does not need to be
 * instantiated to be used. It is a collection of helper functions that can be used
 * to simplify common tasks when working with Anchor.
 */
export class AnchorUtils {
    /**
     * Initializes a wallet from a file.
     *
     * @param {string} filePath - The path to the file containing the wallet's secret key.
     * @returns {Promise<[NodeWallet, Keypair]>} A promise that resolves to a tuple containing the wallet and the keypair.
     */
    static initWalletFromFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const keypair = yield AnchorUtils.initKeypairFromFile(filePath);
            const wallet = new NodeWallet(keypair);
            return [wallet, keypair];
        });
    }
    /**
     * Initializes a keypair from a file.
     *
     * @param {string} filePath - The path to the file containing the keypair's secret key.
     * @returns {Promise<Keypair>} A promise that resolves to the keypair.
     */
    static initKeypairFromFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const secretKeyString = fs.readFileSync(filePath, { encoding: "utf8" });
            const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
            const keypair = Keypair.fromSecretKey(secretKey);
            return keypair;
        });
    }
    /**
     * Loads an Anchor program from the environment.
     *
     * @returns {Promise<anchor.Program>} A promise that resolves to the loaded Anchor program.
     */
    static loadProgramFromEnv() {
        return __awaiter(this, void 0, void 0, function* () {
            const config = yield AnchorUtils.loadEnv();
            const isMainnet = isMainnetConnection(config.connection);
            let pid = ON_DEMAND_MAINNET_PID;
            if (!isMainnet) {
                pid = ON_DEMAND_DEVNET_PID;
            }
            const idl = (yield anchor.Program.fetchIdl(pid, config.provider));
            const program = new anchor.Program(idl, config.provider);
            return new anchor.Program(idl, config.provider);
        });
    }
    /**
     * Loads the same environment set for the Solana CLI.
     *
     * @returns {Promise<SolanaConfig>} A promise that resolves to the Solana configuration.
     */
    static loadEnv() {
        return __awaiter(this, void 0, void 0, function* () {
            const configPath = path.join(os.homedir(), ".config", "solana", "cli", "config.yml");
            const fileContents = fs.readFileSync(configPath, "utf8");
            const data = yaml.load(fileContents);
            const defaultCon = new Connection("https://api.devnet.solana.com");
            const defaultKeypair = Keypair.generate();
            const config = {
                rpcUrl: data.json_rpc_url,
                webSocketUrl: data.websocket_url,
                keypairPath: data.keypair_path,
                commitment: data.commitment,
                keypair: data.keypair_path,
                connection: defaultCon,
                provider: new anchor.AnchorProvider(defaultCon, new NodeWallet(defaultKeypair), {}),
                wallet: new NodeWallet(defaultKeypair),
                program: null,
            };
            config.keypair = (yield AnchorUtils.initWalletFromFile(config.keypairPath))[1];
            config.connection = new Connection(config.rpcUrl, {
                commitment: "confirmed",
            });
            config.wallet = new NodeWallet(config.keypair);
            config.provider = new anchor.AnchorProvider(config.connection, config.wallet, {
                preflightCommitment: "confirmed",
                commitment: "confirmed",
            });
            const isMainnet = yield isMainnetConnection(config.connection);
            let pid = ON_DEMAND_MAINNET_PID;
            if (!isMainnet) {
                pid = ON_DEMAND_DEVNET_PID;
            }
            const idl = (yield anchor.Program.fetchIdl(pid, config.provider));
            const program = new anchor.Program(idl, config.provider);
            config.program = program;
            return config;
        });
    }
    /**
     * Parse out anchor events from the logs present in the program IDL.
     *
     * @param {anchor.Program} program - The Anchor program instance.
     * @param {string[]} logs - The array of logs to parse.
     * @returns {any[]} An array of parsed events.
     */
    static loggedEvents(program, logs) {
        const coder = new anchor.BorshEventCoder(program.idl);
        const out = [];
        logs.forEach((log) => {
            if (log.startsWith("Program data: ")) {
                const strings = log.split(" ");
                if (strings.length !== 3)
                    return;
                try {
                    out.push(coder.decode(strings[2]));
                }
                catch (_a) { }
            }
        });
        return out;
    }
}
//# sourceMappingURL=AnchorUtils.js.map