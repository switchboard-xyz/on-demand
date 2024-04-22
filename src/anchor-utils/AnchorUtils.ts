import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";

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
    const secretKeyString = fs.readFileSync(filePath, { encoding: "utf8" });
    const secretKey: Uint8Array = Uint8Array.from(JSON.parse(secretKeyString));
    const keypair: Keypair = Keypair.fromSecretKey(secretKey);
    const wallet: anchor.Wallet = new anchor.Wallet(keypair);
    return [wallet, keypair];
  }
}
