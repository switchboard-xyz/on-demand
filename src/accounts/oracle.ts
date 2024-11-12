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
  lut: AddressLookupTableAccount | null;

  constructor(readonly program: Program, readonly pubkey: PublicKey) {
    this.lut = null;
  }

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
    const [delegationGroup] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Group"),
        stateKey.toBuffer(),
        state.stakePool.toBuffer(),
        params.queue.toBuffer(),
      ],
      state.stakeProgram
    );

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
          authority: payer.publicKey,
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
          delegationGroup,
        },
      }
    );
    return [new Oracle(program, oracle.publicKey), [ix, ix2], oracle];
  }

  /**
   * Creates a new oracle account for SVM chains (non-solana). linked to the specified queue.
   * After creation the oracle still must receive run approval and verify their
   * enclave measurement.
   * @param program - The program that owns the oracle account.
   * @param params.queue - The queue that the oracle will be linked to.
   * @returns A promise that resolves to a tuple containing the oracle account
   * and the transaction signature.
   *
   */
  static async createSVM(
    program: Program,
    params: {
      queue: PublicKey;
      sourceOracleKey: PublicKey;
    }
  ): Promise<[Oracle, TransactionInstruction[]]> {
    const stateKey = State.keyFromSeed(program);
    const state = await State.loadData(program);
    const payer = (program.provider as any).wallet.payer;
    // Generate the queue PDA for the given source queue key
    const [oracle] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Oracle"),
        params.queue.toBuffer(),
        params.sourceOracleKey.toBuffer(),
      ],
      program.programId
    );
    const oracleStats = (
      await PublicKey.findProgramAddress(
        [Buffer.from("OracleStats"), oracle.toBuffer()],
        program.programId
      )
    )[0];
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), oracle.toBuffer()],
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
    const [delegationGroup] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Group"),
        stateKey.toBuffer(),
        state.stakePool.toBuffer(),
        params.queue.toBuffer(),
      ],
      state.stakeProgram
    );

    const ix = program.instruction.oracleInitSvm(
      {
        recentSlot: new BN(recentSlot.toString()),
        authority: payer.publicKey,
        queue: params.queue,
        secpAuthority: null,
        sourceOracleKey: params.sourceOracleKey,
      },
      {
        accounts: {
          oracle: oracle,
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
            oracle,
            true
          ),
          switchVault: spl.getAssociatedTokenAddressSync(
            state.switchMint,
            oracle,
            true
          ),
          stakeProgram: state.stakeProgram,
          stakePool: state.stakePool,
        },
      }
    );

    return [new Oracle(program, oracle), [ix]];
  }

  /**
   * ATODO: wrap this one up with the gateway bridge oracle fn
   * @param params
   * @returns
   */
  static async quoteVerifySvmIx(
    program: Program,
    params: {
      chain?: string; // Unused atm
      network?: "mainnet" | "mainnet-beta" | "testnet" | "devnet";
      queue: PublicKey; // Solana queue
      attestee: PublicKey; // Solana attestee
      attester: PublicKey; // Solana attester guardian we're requesting from
    }
  ): Promise<TransactionInstruction> {
    // const [queuePDA, queueBump] = await PublicKey.findProgramAddress(
    //   [Buffer.from("Queue"), params.queue.toBuffer()],
    //   program.programId
    // );

    // timestamp handled by bridge fn
    // mrEnclave handled by bridge fn
    // secp256k1Key handled by bridge fn
    // slot has to be handled by us I think
    // signature has to be handled by bridge fn
    // recoveryId has to be handled by bridge fn

    // guardian key & oracle key

    // source oracle key handled by us:

    // source oracle queue key handled by us:

    // source guardian queue key handled by us:

    // const ix = await program.instruction.guardianQuoteVerifySvm(
    //   {
    //     timestamp: new anchor.BN(params.timestamp),
    //     mrEnclave: params.mrEnclave, // 32-byte array
    //     _reserved1: params._reserved1, // 32-bit unsigned integer
    //     secp256k1Key: params.secp256k1Key, // 64-byte array
    //     slot: new anchor.BN(params.slot), // Slot as u64
    //     signature: params.signature, // 64-byte array
    //     recoveryId: params.recoveryId, // u8
    //     sourceOracleKey: params.sourceOracleKey, // Pubkey of source oracle
    //     sourceOracleQueueKey: params.sourceOracleQueueKey, // Pubkey of oracle queue
    //     sourceGuardianQueueKey: params.sourceGuardianQueueKey, // Pubkey of guardian queue
    //     oracleBump: params.oracleBump, // Bump for oracle PDA
    //     oracleQueueBump: params.oracleQueueBump, // Bump for oracle queue PDA
    //     guardianQueueBump: params.guardianQueueBump, // Bump for guardian queue PDA
    //   },
    //   {
    //     accounts: {
    //       guardian: guardianAccountLoader, // AccountLoader for OracleAccountData
    //       oracle: oracleAccountLoader, // AccountLoader for OracleAccountData
    //       oracleStats: oracleStatsAccountLoader, // AccountLoader for OracleStatsAccountData
    //       payer: payer.publicKey, // Signer for transaction
    //       systemProgram: SystemProgram.programId, // System program ID
    //       oracleQueue: oracleQueueAccountLoader, // AccountLoader for QueueAccountData
    //       guardianQueue: guardianQueueAccountLoader, // AccountLoader for QueueAccountData
    //       state: stateAccountLoader, // AccountLoader for State
    //       recentSlothashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY, // Sysvar slot hashes
    //       lutSigner: lutSignerAccount, // AccountInfo for lut signer
    //       lut: lutAccount, // AccountInfo for lut (lookup table)
    //       programState: programStateAccountLoader, // AccountLoader for State
    //     },
    //     signers: [payer], // Add payer as the signer for the instruction
    //   }
    // );

    throw new Error("Quote verify SVM not implemented yet.");
  }

  async updateDelegationRewardPoolsIx(params: {
    overrideStakePool?: PublicKey;
    overrideMint?: PublicKey;
    authority: PublicKey;
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
    console.log("stakepool", stakePool.toBase58());
    console.log("delegationPool", delegationPool.toBase58());
    const lutSlot = oracleData.lutSlot.toNumber();
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: payer.publicKey,
      recentSlot: lutSlot,
    });
    const [delegationGroup] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Group"),
        stateKey.toBuffer(),
        state.stakePool.toBuffer(),
        oracleData.queue.toBuffer(),
      ],
      stakeProgram
    );
    const ix = await program.instruction.oracleUpdateDelegation(
      {
        recentSlot: new BN(lutSlot.toString()),
      },
      {
        accounts: {
          oracle: this.pubkey,
          oracleStats,
          queue: oracleData.queue,
          authority: params.authority,
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
          delegationGroup,
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

  async fetchGateway(): Promise<string> {
    const data = await this.loadData();
    const gw = Buffer.from(data.gatewayUri).toString();
    return gw.replace(/\0+$/, "");
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

  /**
   * Get the pubkey of the stats account for this oracle.
   * @returns A promise that resolves to the pubkey of the stats account.
   */
  async statsKey(): Promise<PublicKey> {
    return (
      await PublicKey.findProgramAddress(
        [Buffer.from("OracleStats"), this.pubkey.toBuffer()],
        this.program.programId
      )
    )[0];
  }

  async lutKey(): Promise<PublicKey> {
    const data = await this.loadData();
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
        this.program.programId
      )
    )[0];
    const [_, lutKey] = await AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: PublicKey.default,
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
    if (this.lut !== null && this.lut !== undefined) {
      return this.lut;
    }
    const lutKey = await this.lutKey();
    const accnt = await this.program.provider.connection.getAddressLookupTable(
      lutKey
    );
    this.lut = accnt.value!;
    return this.lut!;
  }
}
