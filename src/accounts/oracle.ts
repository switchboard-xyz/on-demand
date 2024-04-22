import { State } from "./state.js";

import type { Program } from "@coral-xyz/anchor";
import { BN, BorshAccountsCoder, utils } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Keypair, SystemProgram } from "@solana/web3.js";

/**
 *  This class represents an oracle account on chain.
 */
export class Oracle {
  /**
   * Creates a new oracle account. linked to the specified queue.
   * After creation the oracle still must receive run approval and verify their
   * enclave measurement.
   * @param program - The program that owns the oracle account.
   * @param params.queue - The queue that the oracle will be linked to.
   * @returns A promise that resolves to a tuple containing the oracle account
   * and the transaction signature.
   *
   */
  static async create(
    program: Program,
    params: {
      queue: PublicKey;
    }
  ): Promise<[Oracle, string]> {
    const payer = (program.provider as any).wallet.payer;
    const oracle = Keypair.generate();
    const oracleStats = (
      await PublicKey.findProgramAddress(
        [Buffer.from("OracleStats"), oracle.publicKey.toBuffer()],
        program.programId
      )
    )[0];
    const sig = await program.rpc.oracleInit(
      {},
      {
        accounts: {
          oracle: oracle.publicKey,
          oracleStats,
          queue: params.queue,
          authority: payer.publicKey,
          programState: await State.keyFromSeed(program),
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          tokenMint: spl.NATIVE_MINT,
          stakeProgram: PublicKey.default,
          stakePool: PublicKey.default,
          delegationPool: PublicKey.default,
        },
        signers: [payer, oracle],
      }
    );
    return [new Oracle(program, oracle.publicKey), sig];
  }

  constructor(readonly program: Program, readonly pubkey: PublicKey) {}

  /**
   *  Loads the oracle data for this {@linkcode Oracle} account from on chain.
   *
   *  @returns A promise that resolves to the oracle data.
   *  @throws if the oracle account does not exist.
   */
  async loadData(): Promise<any> {
    return await this.program.account.oracleAccountData.fetch(this.pubkey);
  }

  /**
   * Loads the oracle data for a list of {@linkcode Oracle} accounts from on chain.
   *
   * @param program - The program that owns the oracle accounts.
   * @param keys - The public keys of the oracle accounts to load.
   * @returns A promise that resolves to an array of oracle data.
   * @throws if any of the oracle accounts do not exist.
   */
  static async loadMany(program: Program, keys: PublicKey[]): Promise<any[]> {
    const coder = new BorshAccountsCoder(program.idl);
    const accountType = "OracleAccountData";
    const oracleDatas = await utils.rpc
      .getMultipleAccounts(program.provider.connection, keys)
      .then((o) => o.map((x) => coder.decode(accountType, x!.account.data)));
    return oracleDatas;
  }

  /**
   * Loads the oracle data and checks if the oracle is verified.
   *
   * @returns A promise that resolves to a tuple containing a boolean indicating
   * if the oracle is verified and the expiration time of the verification.
   * @throws if the oracle account does not exist.
   */
  async verificationStatus(): Promise<[boolean, number]> {
    const data = await this.loadData();
    const now = +new Date() / 1000;
    const status = data.enclave.verificationStatus;
    const expiration = data.enclave.validUntil;
    return [status === 4 && now < expiration, expiration.toNumber()];
  }
}
