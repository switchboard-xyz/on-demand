import {
  isMainnetConnection,
  ON_DEMAND_DEVNET_PID,
  ON_DEMAND_MAINNET_PID,
} from "../utils";

import * as anchor from "@coral-xyz/anchor-30";
import NodeWallet from "@coral-xyz/anchor-30/dist/cjs/nodewallet.js";
import type { Commitment } from "@solana/web3.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import yaml from "js-yaml";
import os from "os";
import path from "path";

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
  static async initWalletFromFile(
    filePath: string
  ): Promise<[NodeWallet, Keypair]> {
    const keypair = await AnchorUtils.initKeypairFromFile(filePath);
    const wallet: NodeWallet = new NodeWallet(keypair);
    return [wallet, keypair];
  }

  /**
   * Initializes a keypair from a file.
   *
   * @param {string} filePath - The path to the file containing the keypair's secret key.
   * @returns {Promise<Keypair>} A promise that resolves to the keypair.
   */
  static async initKeypairFromFile(filePath: string): Promise<Keypair> {
    const secretKeyString = fs.readFileSync(filePath, { encoding: "utf8" });
    const secretKey: Uint8Array = Uint8Array.from(JSON.parse(secretKeyString));
    const keypair: Keypair = Keypair.fromSecretKey(secretKey);
    return keypair;
  }

  /**
   * Loads an Anchor program from the environment.
   *
   * @returns {Promise<anchor.Program>} A promise that resolves to the loaded Anchor program.
   */
  static async loadProgramFromEnv(): Promise<anchor.Program> {
    const config = await AnchorUtils.loadEnv();
    const isMainnet = isMainnetConnection(config.connection);
    let pid = ON_DEMAND_MAINNET_PID;
    if (!isMainnet) {
      pid = ON_DEMAND_DEVNET_PID;
    }
    const idl = (await anchor.Program.fetchIdl(pid, config.provider))!;
    const program = new anchor.Program(idl, config.provider);
    return new anchor.Program(idl, config.provider);
  }

  /**
   * Loads the same environment set for the Solana CLI.
   *
   * @returns {Promise<SolanaConfig>} A promise that resolves to the Solana configuration.
   */
  static async loadEnv(): Promise<SolanaConfig> {
    const configPath = path.join(
      os.homedir(),
      ".config",
      "solana",
      "cli",
      "config.yml"
    );
    const fileContents = fs.readFileSync(configPath, "utf8");
    const data = yaml.load(fileContents);
    const defaultCon = new Connection("https://api.devnet.solana.com");
    const defaultKeypair = Keypair.generate();
    const config: SolanaConfig = {
      rpcUrl: data.json_rpc_url,
      webSocketUrl: data.websocket_url,
      keypairPath: data.keypair_path,
      commitment: data.commitment as Commitment,
      keypair: data.keypair_path,
      connection: defaultCon,
      provider: new anchor.AnchorProvider(
        defaultCon,
        new NodeWallet(defaultKeypair),
        {}
      ),
      wallet: new NodeWallet(defaultKeypair),
      program: null,
    };
    config.keypair = (
      await AnchorUtils.initWalletFromFile(config.keypairPath)
    )[1];
    config.connection = new Connection(config.rpcUrl, {
      commitment: "confirmed",
    });
    config.wallet = new NodeWallet(config.keypair);
    config.provider = new anchor.AnchorProvider(
      config.connection,
      config.wallet,
      {
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );
    const isMainnet = await isMainnetConnection(config.connection);
    let pid = ON_DEMAND_MAINNET_PID;
    if (!isMainnet) {
      pid = ON_DEMAND_DEVNET_PID;
    }
    const idl = (await anchor.Program.fetchIdl(pid, config.provider))!;
    const program = new anchor.Program(idl, config.provider);
    config.program = program;

    return config;
  }

  /**
   * Parse out anchor events from the logs present in the program IDL.
   *
   * @param {anchor.Program} program - The Anchor program instance.
   * @param {string[]} logs - The array of logs to parse.
   * @returns {any[]} An array of parsed events.
   */
  static loggedEvents(program: anchor.Program, logs: string[]): any[] {
    const coder = new anchor.BorshEventCoder(program.idl);
    const out: any[] = [];
    logs.forEach((log) => {
      if (log.startsWith("Program data: ")) {
        const strings = log.split(" ");
        if (strings.length !== 3) return;
        try {
          out.push(coder.decode(strings[2]));
        } catch {}
      }
    });
    return out;
  }
}
