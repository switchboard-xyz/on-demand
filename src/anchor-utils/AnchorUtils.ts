/**
 * @file AnchorUtils - Utility functions for working with Anchor framework
 *
 * **Browser Compatibility Note:**
 * Some functions in this module require Node.js file system access (fs, os, path modules).
 * These functions will throw descriptive errors when called in browser environments:
 * - `initKeypairFromFile()` - Use `web3.Keypair.fromSecretKey()` directly in browsers
 * - `initWalletFromFile()` - Use browser wallet adapters instead
 * - `loadEnv()` - Use `loadProgramFromConnection()` with your own connection/wallet
 *
 * All other functions (`loadProgramFromConnection`, `loadProgramFromProvider`, etc.)
 * work in both Node.js and browser environments.
 */

import {
  isDevnetConnection,
  isMainnetConnection,
  ON_DEMAND_DEVNET_PID,
  ON_DEMAND_MAINNET_PID,
} from '../utils';
import { getFs } from '../utils/fs';

import { Queue } from './../accounts/queue.js';
import { Gateway } from './../oracle-interfaces/gateway.js';

import {
  AnchorProvider,
  BorshEventCoder,
  Program,
  Provider,
  Wallet,
  web3,
} from '@coral-xyz/anchor-31';
import { CrossbarClient } from '@switchboard-xyz/common';
import yaml from 'js-yaml';

// Node.js-only imports - these functions will throw in browser environments
let os: typeof import('os');
let path: typeof import('path');
let NodeWallet: typeof Wallet | undefined;

try {
  if (typeof window === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    os = require('os');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    path = require('path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    NodeWallet = require('@coral-xyz/anchor-31/dist/cjs/nodewallet').default;
  }
} catch {
  // Browser environment - these modules won't be available
}

type SolanaConfig = {
  rpcUrl: string;
  webSocketUrl: string;
  keypairPath: string;
  commitment: web3.Commitment;
  keypair: web3.Keypair;
  connection: web3.Connection;
  provider: AnchorProvider;
  wallet: Wallet;
  program: Program | null;
  crossbar: CrossbarClient;
  queue: Queue;
  gateway: Gateway;
};

const readonlyWallet: AnchorProvider['wallet'] = {
  publicKey: web3.PublicKey.default,
  signTransaction: () => {
    throw new Error('Program is in `readonly` mode.');
  },
  signAllTransactions: () => {
    throw new Error('Program is in `readonly` mode.');
  },
};

/*
 * AnchorUtils is a utility class that provides helper functions for working with
 * the Anchor framework. It is a static class, meaning that it does not need to be
 * instantiated to be used. It is a collection of helper functions that can be used
 * to simplify common tasks when working with Anchor.
 */
export class AnchorUtils {
  private static initWalletFromKeypair(keypair: web3.Keypair) {
    if (!NodeWallet) {
      throw new Error(
        'NodeWallet is only available in Node.js environments. ' +
          'For browser environments, use wallet adapters like @solana/wallet-adapter-react.'
      );
    }
    return new NodeWallet(keypair);
  }

  /**
   * Initializes a wallet from a file.
   *
   * **Node.js only** - This function requires file system access and will throw in browser environments.
   *
   * @param {string} filePath - The path to the file containing the wallet's secret key.
   * @returns {Promise<[Wallet, web3.Keypair]>} A promise that resolves to a tuple containing the wallet and the keypair.
   * @throws {Error} When called in a browser environment
   */
  static initWalletFromFile(filePath: string) {
    const keypair = AnchorUtils.initKeypairFromFile(filePath);
    const wallet = AnchorUtils.initWalletFromKeypair(keypair);
    return [wallet, keypair] as const;
  }

  /**
   * Initializes a keypair from a file.
   *
   * **Node.js only** - This function requires file system access and will throw in browser environments.
   *
   * @param {string} filePath - The path to the file containing the keypair's secret key.
   * @returns {Promise<web3.Keypair>} A promise that resolves to the keypair.
   * @throws {Error} When called in a browser environment
   */
  static initKeypairFromFile(filePath: string): web3.Keypair {
    const secretKeyString = getFs().readFileSync(filePath, {
      encoding: 'utf8',
    });
    const secretKey: Uint8Array = Uint8Array.from(JSON.parse(secretKeyString));
    const keypair = web3.Keypair.fromSecretKey(secretKey);
    return keypair;
  }

  /**
   * Loads an Anchor program from a connection.
   *
   * @param {web3.Connection} connection - The connection to load the program from.
   * @returns {Promise<Program>} A promise that resolves to the loaded Anchor program.
   */
  static async loadProgramFromConnection(
    connection: web3.Connection,
    wallet?: Wallet,
    programId?: web3.PublicKey
  ) {
    const provider = new AnchorProvider(connection, wallet ?? readonlyWallet);
    return AnchorUtils.loadProgramFromProvider(provider, programId);
  }

  /**
   * Loads an Anchor program from a provider.
   *
   * @param {Provider} provider - The provider to load the program from.
   * @param {web3.PublicKey} programId - An optional program ID to load the program from.
   * @returns {Promise<Program>} A promise that resolves to the loaded Anchor program.
   */
  static async loadProgramFromProvider(
    provider: Provider,
    programId?: web3.PublicKey
  ) {
    const pid = await (async () => {
      if (programId) return programId;
      const isSolanaDevnet = await isDevnetConnection(provider.connection);
      return isSolanaDevnet ? ON_DEMAND_DEVNET_PID : ON_DEMAND_MAINNET_PID;
    })();
    return await Program.at(pid, provider);
  }

  /**
   * Loads an Anchor program from the environment.
   *
   * @returns {Promise<Program>} A promise that resolves to the loaded Anchor program.
   */
  static async loadProgramFromEnv(): Promise<Program> {
    const config = await AnchorUtils.loadEnv();
    const isDevnet = await isDevnetConnection(config.connection);
    const pid = isDevnet ? ON_DEMAND_DEVNET_PID : ON_DEMAND_MAINNET_PID;
    return Program.at(pid, config.provider);
  }

  /**
   * Loads the same environment set for the Solana CLI.
   *
   * **Node.js only** - This function requires file system access and will throw in browser environments.
   *
   * @returns {Promise<SolanaConfig>} A promise that resolves to the Solana configuration.
   * @throws {Error} When called in a browser environment
   */
  static async loadEnv(): Promise<SolanaConfig> {
    if (!os || !path) {
      throw new Error(
        'AnchorUtils.loadEnv() is only available in Node.js environments. ' +
          'For browser environments, use loadProgramFromConnection() with your own connection and wallet.'
      );
    }
    const configPath = path.join(os.homedir(), '.config/solana/cli/config.yml');
    const fileContents = getFs().readFileSync(configPath, 'utf8');
    const data = yaml.load(fileContents);

    const commitment = data.commitment as web3.Commitment;
    const connection = new web3.Connection(data.json_rpc_url, {
      commitment,
      wsEndpoint: data.websocket_url,
    });

    const keypairPath = data.keypair_path;
    const crossbar = new CrossbarClient('http://crossbar.switchboard.xyz');

    const [wallet, keypair] = await AnchorUtils.initWalletFromFile(keypairPath);
    const provider = new AnchorProvider(connection, wallet);

    const isMainnet = await isMainnetConnection(connection);

    const pid = isMainnet ? ON_DEMAND_MAINNET_PID : ON_DEMAND_DEVNET_PID;

    const program = await Program.at(pid, provider);
    let queue = new Queue(program, Queue.DEFAULT_MAINNET_KEY);
    if (!isMainnet) {
      queue = new Queue(program, Queue.DEFAULT_DEVNET_KEY);
    }
    const gateway = await queue.fetchGatewayFromCrossbar(crossbar);

    return {
      rpcUrl: connection.rpcEndpoint,
      webSocketUrl: data.websocket_url,
      connection: connection,
      commitment: connection.commitment ?? 'confirmed',
      keypairPath: keypairPath,
      keypair: keypair,
      provider: provider,
      wallet: wallet,
      program: program,
      crossbar: crossbar,
      queue,
      gateway,
    };
  }

  /**
   * Parse out anchor events from the logs present in the program IDL.
   *
   * @param {Program} program - The Anchor program instance.
   * @param {string[]} logs - The array of logs to parse.
   * @returns {any[]} An array of parsed events.
   */
  static loggedEvents(program: Program, logs: string[]) {
    type LoggedEvent = ReturnType<BorshEventCoder['decode']>;

    const coder = new BorshEventCoder(program.idl);
    const out: LoggedEvent[] = [];
    logs.forEach(log => {
      if (log.startsWith('Program data: ')) {
        const strings = log.split(' ');
        if (strings.length !== 3) return;
        try {
          out.push(coder.decode(strings[2]));
        } catch {} // eslint-disable-line no-empty
      }
    });
    return out;
  }
}
