import { Queue } from "./queue.js";

import type { BN, Program } from "@coral-xyz/anchor-30";
import type { TransactionInstruction } from "@solana/web3.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";

/**
 *  Abstraction around the Switchboard-On-Demand State account
 *
 *  This account is used to store the state data for a given program.
 */
export class State {
  public pubkey: PublicKey;

  /**
   *  Derives a state PDA (Program Derived Address) from the program.
   *
   *  @param program The Anchor program instance.
   *  @returns A promise that resolves to the derived state account's public key.
   */
  static keyFromSeed(program: Program): PublicKey {
    const [state] = PublicKey.findProgramAddressSync(
      [Buffer.from("STATE")],
      program.programId
    );
    return state;
  }

  /**
   *  Initializes the state account.
   *
   *  @param program The Anchor program instance.
   *  @returns A promise that resolves to the state account and the transaction signature.
   */
  static async create(program: Program): Promise<[State, String]> {
    const payer = (program.provider as any).wallet.payer;
    const sig = await program.rpc.stateInit(
      {},
      {
        accounts: {
          state: State.keyFromSeed(program),
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        },
        signers: [payer],
      }
    );

    return [new State(program), sig];
  }

  /**
   *  Constructs a `State` instance.
   *
   *  @param program The Anchor program instance.
   */
  constructor(readonly program: Program) {
    const pubkey = State.keyFromSeed(program);
    this.pubkey = pubkey;
  }

  /**
   * Set program wide configurations.
   * @param params.guardianQueue The guardian queue account.
   * @param params.newAuthority The new authority account.
   * @param params.minQuoteVerifyVotes The minimum number of votes required to verify a quote.
   */
  async setConfigsIx(params: {
    guardianQueue?: PublicKey;
    newAuthority?: PublicKey;
    minQuoteVerifyVotes?: BN;
    stakeProgram?: PublicKey;
    stakePool?: PublicKey;
    permitAdvisory?: number;
    denyAdvisory?: number;
    testOnlyDisableMrEnclaveCheck?: boolean;
    switchMint?: PublicKey;
    epochLength?: BN;
    resetEpochs?: boolean;
    enableStaking?: boolean;
  }): Promise<TransactionInstruction> {
    const state = await this.loadData();
    const queue = params.guardianQueue ?? state.guardianQueue;
    const program = this.program;
    const payer = (program.provider as any).wallet.payer;
    const testOnlyDisableMrEnclaveCheck =
      params.testOnlyDisableMrEnclaveCheck ??
      state.testOnlyDisableMrEnclaveCheck;
    const resetEpochs = params.resetEpochs ?? false;
    const ix = await this.program.instruction.stateSetConfigs(
      {
        newAuthority: params.newAuthority ?? state.authority,
        testOnlyDisableMrEnclaveCheck: testOnlyDisableMrEnclaveCheck ? 1 : 0,
        stakePool: params.stakePool ?? state.stakePool,
        stakeProgram: params.stakeProgram ?? state.stakeProgram,
        addAdvisory: params.permitAdvisory,
        rmAdvisory: params.denyAdvisory,
        epochLength: params.epochLength ?? state.epochLength,
        resetEpochs: resetEpochs,
        lutSlot: state.lutSlot,
        switchMint: params.switchMint ?? state.switchMint,
        enableStaking: params.enableStaking ?? state.enableStaking,
        authority: params.newAuthority ?? state.authority,
      },
      {
        accounts: {
          state: this.pubkey,
          authority: state.authority,
          queue,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        },
      }
    );
    return ix;
  }

  /**
   * Register a guardian with the global guardian queue.
   * @param params.guardian The guardian account.
   * @returns A promise that resolves to the transaction instruction
   */
  async registerGuardianIx(params: {
    guardian: PublicKey;
  }): Promise<TransactionInstruction> {
    const state = await this.loadData();
    const program = this.program;
    const payer = (program.provider as any).wallet.payer;
    const ix = await this.program.instruction.guardianRegister(
      {},
      {
        accounts: {
          oracle: params.guardian,
          state: this.pubkey,
          guardianQueue: state.guardianQueue,
          authority: state.authority,
        },
        signers: [payer],
      }
    );
    return ix;
  }

  /**
   * Unregister a guardian from the global guardian queue.
   * @param params.guardian The guardian account.
   * @returns A promise that resolves to the transaction instruction
   */
  async unregisterGuardianIx(params: {
    guardian: PublicKey;
  }): Promise<TransactionInstruction> {
    const state = await this.loadData();
    const guardianQueue = new Queue(this.program, state.guardianQueue);
    const queueData = await guardianQueue.loadData();
    const idx = queueData.guardians.findIndex((key) =>
      key.equals(params.guardian)
    );
    const program = this.program;
    const payer = (program.provider as any).wallet.payer;
    const ix = await this.program.instruction.guardianUnregister(
      { idx },
      {
        accounts: {
          oracle: params.guardian,
          state: this.pubkey,
          guardianQueue: state.guardianQueue,
          authority: state.authority,
        },
        signers: [payer],
      }
    );
    return ix;
  }

  /**
   *  Loads the state data from on chain.
   *
   *  @returns A promise that resolves to the state data.
   *  @throws if the state account does not exist.
   */
  async loadData(): Promise<any> {
    return await this.program.account["state"].fetch(this.pubkey);
  }

  /**
   *  Loads the state data from on chain.
   *
   *  @returns A promise that resolves to the state data.
   *  @throws if the state account does not exist.
   */
  static async loadData(program: Program): Promise<any> {
    const state = new State(program);
    return await state.loadData();
  }
}
