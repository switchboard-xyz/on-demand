import { InstructionUtils } from "./../instruction-utils/InstructionUtils.js";
import * as spl from "./../utils/index.js";
import { Queue } from "./queue.js";
import { State } from "./state.js";

import type { Program } from "@coral-xyz/anchor-30";
import { BN, BorshAccountsCoder, utils } from "@coral-xyz/anchor-30";
import type {
  AddressLookupTableAccount,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

/**
 *  This class represents an oracle account on chain.
 */
export class Oracle {
  constructor(readonly program: Program, readonly pubkey: PublicKey) {}

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
  ): Promise<[Oracle, TransactionInstruction[], Keypair]> {
    const stateKey = State.keyFromSeed(program);
    const state = await State.loadData(program);
    const payer = (program.provider as any).wallet.payer;
    const oracle = Keypair.generate();
    const oracleStats = (
      await PublicKey.findProgramAddress(
        [Buffer.from("OracleStats"), oracle.publicKey.toBuffer()],
        program.programId
      )
    )[0];
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), oracle.publicKey.toBuffer()],
        program.programId
      )
    )[0];
    const [delegationPool] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Delegation"),
        stateKey.toBuffer(),
        oracleStats.toBuffer(),
        state.stakePool.toBuffer(),
      ],
      state.stakeProgram
    );
    const recentSlot = await program.provider.connection.getSlot("finalized");
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: payer.publicKey,
      recentSlot,
    });
    const ix = await program.instruction.oracleInit(
      {
        recentSlot: new BN(recentSlot.toString()),
        authority: payer.publicKey,
        queue: params.queue,
        secpAuthority: null,
      },
      {
        accounts: {
          oracle: oracle.publicKey,
          oracleStats,
          authority: payer.publicKey,
          programState: stateKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          tokenMint: spl.NATIVE_MINT,
          delegationPool,
          lutSigner,
          lut,
          addressLookupTableProgram: AddressLookupTableProgram.programId,
          switchMint: state.switchMint,
          wsolVault: spl.getAssociatedTokenAddressSync(
            spl.NATIVE_MINT,
            oracle.publicKey
          ),
          switchVault: spl.getAssociatedTokenAddressSync(
            state.switchMint,
            oracle.publicKey
          ),
          stakeProgram: state.stakeProgram,
          stakePool: state.stakePool,
        },
      }
    );
    const ix2 = await program.instruction.oracleUpdateDelegation(
      {
        recentSlot: new BN(recentSlot.toString()),
      },
      {
        accounts: {
          oracle: oracle.publicKey,
          oracleStats,
          queue: params.queue,
          authority: stateKey,
          programState: stateKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          delegationPool,
          lutSigner,
          lut,
          addressLookupTableProgram: AddressLookupTableProgram.programId,
          switchMint: state.switchMint,
          nativeMint: spl.NATIVE_MINT,
          wsolVault: PublicKey.findProgramAddressSync(
            [
              Buffer.from("RewardPool"),
              delegationPool.toBuffer(),
              spl.NATIVE_MINT.toBuffer(),
            ],
            state.stakeProgram
          )[0],
          switchVault: PublicKey.findProgramAddressSync(
            [
              Buffer.from("RewardPool"),
              delegationPool.toBuffer(),
              state.switchMint.toBuffer(),
            ],
            state.stakeProgram
          )[0],
          stakeProgram: state.stakeProgram,
          stakePool: state.stakePool,
        },
      }
    );
    return [new Oracle(program, oracle.publicKey), [ix, ix2], oracle];
  }

  async updateDelegationRewardPoolsIx(params: {
    overrideStakePool?: PublicKey;
    overrideMint?: PublicKey;
  }): Promise<TransactionInstruction> {
    const program = this.program;
    const stateKey = State.keyFromSeed(program);
    const state = await State.loadData(program);
    const switchMint = params.overrideMint ?? state.switchMint;
    const stakePool = params.overrideStakePool ?? state.stakePool;
    const stakeProgram = state.stakeProgram;
    const payer = (program.provider as any).wallet.payer;
    const oracleData = await this.loadData();
    const oracleStats = (
      await PublicKey.findProgramAddress(
        [Buffer.from("OracleStats"), this.pubkey.toBuffer()],
        program.programId
      )
    )[0];
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
        program.programId
      )
    )[0];
    const [delegationPool] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Delegation"),
        stateKey.toBuffer(),
        oracleStats.toBuffer(),
        stakePool.toBuffer(),
      ],
      stakeProgram
    );
    const lutSlot = oracleData.lutSlot.toNumber();
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: payer.publicKey,
      recentSlot: lutSlot,
    });
    const ix = await program.instruction.oracleUpdateDelegation(
      {
        recentSlot: new BN(lutSlot.toString()),
      },
      {
        accounts: {
          oracle: this.pubkey,
          oracleStats,
          queue: oracleData.queue,
          authority: stateKey,
          programState: stateKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          delegationPool,
          lutSigner,
          lut,
          addressLookupTableProgram: AddressLookupTableProgram.programId,
          switchMint: switchMint,
          nativeMint: spl.NATIVE_MINT,
          wsolVault: PublicKey.findProgramAddressSync(
            [
              Buffer.from("RewardPool"),
              delegationPool.toBuffer(),
              spl.NATIVE_MINT.toBuffer(),
            ],
            stakeProgram
          )[0],
          switchVault: PublicKey.findProgramAddressSync(
            [
              Buffer.from("RewardPool"),
              delegationPool.toBuffer(),
              switchMint.toBuffer(),
            ],
            stakeProgram
          )[0],
          stakeProgram: stakeProgram,
          stakePool: stakePool,
        },
      }
    );
    return ix;
  }

  async setConfigsIx(params: {
    authority: PublicKey;
  }): Promise<TransactionInstruction> {
    const data = await this.loadData();
    const ix = await this.program.instruction.oracleSetConfigs(
      {
        authority: params.authority,
        newSecpAuthority: null,
      },
      {
        accounts: {
          oracle: this.pubkey,
          authority: params.authority,
        },
      }
    );
    return ix;
  }

  /**
   *  Loads the oracle data for this {@linkcode Oracle} account from on chain.
   *
   *  @returns A promise that resolves to the oracle data.
   *  @throws if the oracle account does not exist.
   */
  async loadData(): Promise<any> {
    return await this.program.account["oracleAccountData"].fetch(this.pubkey);
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
    const accountType = "oracleAccountData";
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

  async lutKey(): Promise<PublicKey> {
    const payer = (this.program.provider as any).wallet.payer;
    const data = await this.loadData();
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
        this.program.programId
      )
    )[0];
    const [_, lutKey] = await AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: payer.publicKey,
      recentSlot: data.lutSlot,
    });
    return lutKey;
  }

  public lookupTableKey(data: any): PublicKey {
    const lutSigner = PublicKey.findProgramAddressSync(
      [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
      this.program.programId
    )[0];
    const [_, lutKey] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: PublicKey.default,
      recentSlot: data.lutSlot,
    });
    return lutKey;
  }

  async loadLookupTable(): Promise<AddressLookupTableAccount> {
    const lutKey = await this.lutKey();
    const accnt = await this.program.provider.connection.getAddressLookupTable(
      lutKey
    );
    return accnt.value!;
  }
}
