import { SB_ON_DEMAND_PID } from "./../constants.js";

import * as anchor from "@coral-xyz/anchor-30";
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
  wallet: anchor.Wallet;
  program: anchor.Program | null;
};

/*
 * AnchorUtils is a utility class that provides helper functions for working with
 * the Anchor framework. It is a static class, meaning that it does not need to be
 * instantiated to be used. It is a collection of helper functions that can be used
 * to simplify common tasks when working with Anchor.
 */
export class AnchorUtils {
  /*
   * initWalletFromFile is a static function that initializes a wallet from a file.
   * It takes a single argument, walletPath, which is the path to the file containing
   * the wallet's secret key. It returns a Promise that resolves to a tuple containing
   * the wallet and the keypair.
   * @param filePath: string - The path to the file containing the wallet's secret key.
   * @returns Promise<[anchor.Wallet, Keypair]> - A Promise that resolves to a tuple containing
   * the wallet and the keypair.
   */
  static async initWalletFromFile(
    filePath: string
  ): Promise<[anchor.Wallet, Keypair]> {
    const keypair = await AnchorUtils.initKeypairFromFile(filePath);
    const wallet: anchor.Wallet = new anchor.Wallet(keypair);
    return [wallet, keypair];
  }

  static async initKeypairFromFile(filePath: string): Promise<Keypair> {
    const secretKeyString = fs.readFileSync(filePath, { encoding: "utf8" });
    const secretKey: Uint8Array = Uint8Array.from(JSON.parse(secretKeyString));
    const keypair: Keypair = Keypair.fromSecretKey(secretKey);
    return keypair;
  }

  static async loadProgramFromEnv(): Promise<anchor.Program> {
    const config = await AnchorUtils.loadEnv();
    const idl = (await anchor.Program.fetchIdl(
      SB_ON_DEMAND_PID,
      config.provider
    ))!;
    const program = new anchor.Program(idl, config.provider);
    return new anchor.Program(idl, config.provider);
  }

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
        new anchor.Wallet(defaultKeypair),
        {}
      ),
      wallet: new anchor.Wallet(defaultKeypair),
      program: null,
    };
    config.keypair = (
      await AnchorUtils.initWalletFromFile(config.keypairPath)
    )[1];
    config.connection = new Connection(config.rpcUrl, {
      commitment: "confirmed",
    });
    config.wallet = new anchor.Wallet(config.keypair);
    config.provider = new anchor.AnchorProvider(
      config.connection,
      config.wallet,
      {
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );
    const idl = (await anchor.Program.fetchIdl(
      SB_ON_DEMAND_PID,
      config.provider
    ))!;
    const program = new anchor.Program(idl, config.provider);
    config.program = program;

    return config;
  }

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
