import { RecentSlotHashes } from "./../sysvars/recentSlothashes.js";
import * as spl from "./../utils/index.js";
import { Queue } from "./queue.js";
import { State } from "./state.js";

import type { BN, Program } from "@coral-xyz/anchor-30";
import type {
  AddressLookupTableState,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

/**
 *  A map of LUTs to their public keys.
 *
 *  Users can initialize to compact all oracle and feed keys they use into a single
 *  account, and then use the LUT to load all tx keys efficiently.
 */
export class LutMap {
  /**
   *  The public key of the LUT map account.
   */
  static async keyFromSeed(
    program: Program,
    queue: PublicKey,
    authority: PublicKey
  ): Promise<PublicKey> {
    const [lut] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("LutMapAccountData"),
        queue.toBuffer(),
        authority.toBuffer(),
      ],
      program.programId
    );
    return lut;
  }

  /**
   * Creating a LUT map account will allow a user or protocol to easy manage
   * and associate a common account grouping for their feeds to reduce the
   * total number of transaction bytes taken by Switchboard.
   * This will maximize the flexibility users have in their instructions.
   *
   * @param program - The program that owns the LUT map account.
   * @param queue - The queue account that the LUT map is associated with.
   * @param slot - The slot that the LUT map is associated with.
   * @returns A promise that resolves to the LUT map and the transaction signature.
   */
  static async create(
    program: Program,
    queue: PublicKey,
    slot: BN
  ): Promise<[LutMap, string]> {
    const payer = (program.provider as any).wallet.payer;
    const lutKey = await LutMap.keyFromSeed(program, queue, payer.publicKey);
    const sig = await program.rpc.lutMapInit(
      { slot },
      {
        accounts: {
          lutMap: lutKey,
          queue: queue,
          payer: payer.publicKey,
          authority: payer.publicKey,
          systemProgram: SystemProgram.programId,
        },
        signers: [payer],
      }
    );
    return [new LutMap(program, lutKey), sig];
  }

  constructor(readonly program: Program, readonly pubkey: PublicKey) {}

  async queueLutExtendIx(params: {
    queue: PublicKey;
    newKey: PublicKey;
    payer: PublicKey;
  }): Promise<TransactionInstruction> {
    const payer = (this.program.provider as any).wallet.payer;
    const queueAccount = new Queue(this.program, params.queue);
    const queueData = await queueAccount.loadData();
    const lutKey = await LutMap.keyFromSeed(
      this.program,
      params.queue,
      payer.publicKey
    );
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), params.queue.toBuffer()],
        this.program.programId
      )
    )[0];
    const ix = await this.program.instruction.queueLutExtend(
      { newKey: params.newKey },
      {
        accounts: {
          queue: params.queue,
          authority: queueData.authority,
          lutSigner,
          lut: lutKey,
          addressLookupTableProgram: AddressLookupTableProgram.programId,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        },
      }
    );
    return ix;
  }

  /**
   *  Loads the data for this {@linkcode LutMap} account from on chain.
   *
   *  @returns A promise that resolves to the data.
   *  @throws if the account does not exist.
   */
  async loadData(): Promise<any> {
    return await this.program.account["lutMapAccountData"].fetch(this.pubkey);
  }

  async loadLut(): Promise<[PublicKey, AddressLookupTableState]> {
    const data = await this.loadData();
    const lutKey = data.lut;
    const lutAccountInfo =
      await this.program.provider.connection.getAccountInfo(lutKey);
    const lutData = AddressLookupTableAccount.deserialize(lutAccountInfo!.data);
    return [lutKey, lutData];
  }

  async syncLut(feeds: PublicKey[]): Promise<void> {
    const wrapperData = await this.loadData();
    const [key, data] = await this.loadLut();
    const queueKey = wrapperData.queue;
    const queue = new Queue(this.program, queueKey);
    const queueData = await queue.loadData();
    const oracles = queueData.oracleKeys.slice(0, queueData.oracleKeysLen);
    const neededLutAccounts: PublicKey[] = [];
    neededLutAccounts.push(queueKey);
    neededLutAccounts.push(spl.NATIVE_MINT);
    neededLutAccounts.push(spl.TOKEN_PROGRAM_ID);
    neededLutAccounts.push(spl.ASSOCIATED_TOKEN_PROGRAM_ID);
    neededLutAccounts.push(State.keyFromSeed(this.program));
    for (const oracle of oracles) {
      for (const feed of feeds) {
        const [statsKey] = PublicKey.findProgramAddressSync(
          [Buffer.from("OracleFeedStats"), feed.toBuffer(), oracle.toBuffer()],
          this.program.programId
        );
        const feedRewardEscrow = await spl.getAssociatedTokenAddress(
          spl.NATIVE_MINT,
          feed
        );
        neededLutAccounts.push(statsKey);
        neededLutAccounts.push(feed);
        neededLutAccounts.push(oracle);
        neededLutAccounts.push(feedRewardEscrow);
      }
    }
    // TODO: do anneal here
  }
}
