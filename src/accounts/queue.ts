import { SB_ON_DEMAND_PID } from "../constants.js";
import type {
  FeedEvalResponse,
  FetchSignaturesMultiResponse,
} from "../oracle-interfaces/gateway.js";
import { Gateway } from "../oracle-interfaces/gateway.js";

import * as spl from "./../utils/index.js";
import type { SwitchboardPermission } from "./permission.js";
import { Permission } from "./permission.js";
import type { FeedRequest } from "./pullFeed.js";
import { State } from "./state.js";

import * as anchor from "@coral-xyz/anchor-30";
import { BorshAccountsCoder, type Program, utils } from "@coral-xyz/anchor-30";
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
import { FeedHash, type OracleJob } from "@switchboard-xyz/common";

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  // Create a timeout promise that resolves to null after timeoutMs milliseconds
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(resolve, timeoutMs, null)
  );

  // Race the timeout promise against the original promise
  return Promise.race([promise, timeoutPromise]);
}
/**
 *  Removes trailing null bytes from a string.
 *
 *  @param input The input string.
 *  @returns The input string with trailing null bytes removed.
 */
function removeTrailingNullBytes(input: string): string {
  // Regular expression to match trailing null bytes
  const trailingNullBytesRegex = /\x00+$/;
  // Remove trailing null bytes using the replace() method
  return input.replace(trailingNullBytesRegex, "");
}

function runWithTimeout<T>(
  task: Promise<T>,
  timeoutMs: number
): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    // Set up the timeout
    const timer = setTimeout(() => {
      resolve("timeout");
    }, timeoutMs);

    task.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 *  Abstraction around the Switchboard-On-Demand Queue account
 *
 *  This account is used to store the queue data for a given feed.
 */
export class Queue {
  static async createIx(
    program: Program,
    params: {
      allowAuthorityOverrideAfter?: number;
      requireAuthorityHeartbeatPermission?: boolean;
      requireUsagePermission?: boolean;
      maxQuoteVerificationAge?: number;
      reward?: number;
      nodeTimeout?: number;
      lutSlot?: number;
    }
  ): Promise<[Queue, Keypair, TransactionInstruction]> {
    const stateKey = State.keyFromSeed(program);
    const state = await State.loadData(program);
    const queue = Keypair.generate();
    const allowAuthorityOverrideAfter =
      params.allowAuthorityOverrideAfter ?? 60 * 60;
    const requireAuthorityHeartbeatPermission =
      params.requireAuthorityHeartbeatPermission ?? true;
    const requireUsagePermission = params.requireUsagePermission ?? false;
    const maxQuoteVerificationAge =
      params.maxQuoteVerificationAge ?? 60 * 60 * 24 * 7;
    const reward = params.reward ?? 1000000;
    const nodeTimeout = params.nodeTimeout ?? 300;
    const payer = (program.provider as any).wallet.payer;
    // Prepare accounts for the transaction
    const lutSigner = (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), queue.publicKey.toBuffer()],
        program.programId
      )
    )[0];
    const [delegationGroup] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Group"),
        stateKey.toBuffer(),
        state.stakePool.toBuffer(),
        queue.publicKey.toBuffer(),
      ],
      state.stakeProgram
    );
    const recentSlot =
      params.lutSlot ??
      (await program.provider.connection.getSlot("finalized"));
    const [_, lut] = AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: payer.publicKey,
      recentSlot,
    });

    let stakePool = state.stakePool;
    if (stakePool.equals(PublicKey.default)) {
      stakePool = payer.publicKey;
    }
    const queueAccount = new Queue(program, queue.publicKey);
    const ix = await program.instruction.queueInit(
      {
        allowAuthorityOverrideAfter,
        requireAuthorityHeartbeatPermission,
        requireUsagePermission,
        maxQuoteVerificationAge,
        reward,
        nodeTimeout,
        recentSlot: new anchor.BN(recentSlot),
      },
      {
        accounts: {
          queue: queue.publicKey,
          queueEscrow: await spl.getAssociatedTokenAddress(
            spl.NATIVE_MINT,
            queue.publicKey
          ),
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          nativeMint: spl.NATIVE_MINT,
          programState: State.keyFromSeed(program),
          lutSigner: await queueAccount.lutSigner(),
          lut: await queueAccount.lutKey(recentSlot),
          addressLookupTableProgram: AddressLookupTableProgram.programId,
          delegationGroup,
          stakeProgram: state.stakeProgram,
          stakePool: stakePool,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        },
        signers: [payer, queue],
      }
    );
    return [new Queue(program, queue.publicKey), queue, ix];
  }

  async initDelegationGroupIx(params: {
    lutSlot?: number;
    overrideStakePool?: PublicKey;
  }): Promise<TransactionInstruction> {
    const queueAccount = new Queue(this.program, this.pubkey);
    const lutSlot = params.lutSlot ?? (await this.loadData()).lutSlot;
    const payer = (this.program.provider as any).wallet.payer;
    const stateKey = State.keyFromSeed(this.program);
    const state = await State.loadData(this.program);
    const stakePool = params.overrideStakePool ?? state.stakePool;
    const [delegationGroup] = await PublicKey.findProgramAddress(
      [
        Buffer.from("Group"),
        stateKey.toBuffer(),
        stakePool.toBuffer(),
        this.pubkey.toBuffer(),
      ],
      state.stakeProgram
    );
    const [queueEscrowSigner] = await PublicKey.findProgramAddress(
      [Buffer.from("Signer"), this.pubkey.toBuffer()],
      SB_ON_DEMAND_PID
    );
    const ix = await this.program.instruction.queueInitDelegationGroup(
      {},
      {
        accounts: {
          queue: this.pubkey,
          queueEscrow: await spl.getAssociatedTokenAddress(
            spl.NATIVE_MINT,
            this.pubkey
          ),
          queueEscrowSigner,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          nativeMint: spl.NATIVE_MINT,
          programState: stateKey,
          lutSigner: await this.lutSigner(),
          lut: await this.lutKey(lutSlot),
          addressLookupTableProgram: AddressLookupTableProgram.programId,
          delegationGroup: delegationGroup,
          stakeProgram: state.stakeProgram,
          stakePool: stakePool,
        },
      }
    );
    return ix;
  }

  /**
   *  Fetches signatures from a random gateway on the queue.
   *
   *  REST API endpoint: /api/v1/fetch_signatures
   *
   *  @param recentHash The chain metadata to sign with. Blockhash or slothash.
   *  @param jobs The oracle jobs to perform.
   *  @param numSignatures The number of oracles to fetch signatures from.
   *  @returns A promise that resolves to the feed evaluation responses.
   *  @throws if the request fails.
   */
  static async fetchSignatures(
    program: Program,
    params: {
      gateway?: string;
      queue: PublicKey;
      recentHash?: string;
      jobs: OracleJob[];
      numSignatures?: number;
      maxVariance?: number;
      minResponses?: number;
    }
  ): Promise<{ responses: FeedEvalResponse[]; failures: string[] }> {
    const queueAccount = new Queue(program, params.queue);
    return queueAccount.fetchSignatures(params);
  }

  static async fetchSignaturesMulti(
    program: Program,
    params: {
      gateway?: string;
      queue: PublicKey;
      recentHash?: string;
      feedConfigs: FeedRequest[];
      minResponses?: number;
    }
  ): Promise<FetchSignaturesMultiResponse> {
    const queueAccount = new Queue(program, params.queue!);
    return queueAccount.fetchSignaturesMulti(params);
  }

  /**
   * @deprecated
   * Deprecated. Use {@linkcode @switchboard-xyz/common#FeedHash.compute} instead.
   */
  static async fetchFeedHash(
    program: Program,
    params: {
      gateway?: string;
      queue: PublicKey;
      recentHash?: string;
      jobs: OracleJob[];
      numSignatures?: number;
      maxVariance?: number;
      minResponses?: number;
    }
  ): Promise<Buffer> {
    const queueAccount = new Queue(program, params.queue);
    const oracleSigs = await queueAccount.fetchSignatures(params);
    return Buffer.from(oracleSigs[0].feed_hash, "hex");
  }

  /**
   *  Constructs a `OnDemandQueue` instance.
   *
   *  @param program The Anchor program instance.
   *  @param pubkey The public key of the queue account.
   */
  constructor(readonly program: Program, readonly pubkey: PublicKey) {
    if (this.pubkey === undefined) {
      throw new Error("NoPubkeyProvided");
    }
  }

  /**
   *  Loads the queue data from on chain and returns the listed oracle keys.
   *
   *  @returns A promise that resolves to an array of oracle public keys.
   */
  async fetchOracleKeys(): Promise<PublicKey[]> {
    const program = this.program;
    const queueData = (await program.account["queueAccountData"].fetch(
      this.pubkey
    )) as any;
    const oracles = queueData.oracleKeys.slice(0, queueData.oracleKeysLen);
    return oracles;
  }

  /**
   *  Loads the queue data from on chain and returns the listed gateways.
   *
   *  @returns A promise that resolves to an array of gateway URIs.
   */
  async fetchAllGateways(): Promise<Gateway[]> {
    const queue = this.pubkey;
    const program = this.program;
    const coder = new BorshAccountsCoder(program.idl);
    const oracles = await this.fetchOracleKeys();
    const oracleAccounts = await utils.rpc.getMultipleAccounts(
      program.provider.connection,
      oracles
    );
    const gatewayUris = oracleAccounts
      .map((x: any) => coder.decode("oracleAccountData", x.account.data))
      .map((x: any) => String.fromCharCode(...x.gatewayUri))
      .map((x: string) => removeTrailingNullBytes(x))
      .filter((x: string) => x.length > 0)
      .filter((x: string) => !x.includes("infstones"));

    const tests: any = [];
    for (const i in gatewayUris) {
      const gw = new Gateway(program, gatewayUris[i], oracles[i]);
      tests.push(gw.test());
    }

    let gateways: any = [];
    for (let i = 0; i < tests.length; i++) {
      try {
        const isGood = await withTimeout(tests[i], 2000);
        if (isGood) {
          gateways.push(new Gateway(program, gatewayUris[i], oracles[i]));
        }
      } catch (e) {
        console.log("Timeout", e);
      }
    }
    gateways = gateways.sort(() => Math.random() - 0.5);
    return gateways as Gateway[];
  }

  /**
   *  Loads the queue data from on chain and returns a random gateway.
   *  @returns A promise that resolves to a gateway interface
   */
  async fetchGateway(): Promise<Gateway> {
    const gateways = await this.fetchAllGateways();
    if (gateways.length === 0) {
      throw new Error("NoGatewayAvailable");
    }
    return gateways[Math.floor(Math.random() * gateways.length)];
  }

  /**
   *  Fetches signatures from a random gateway on the queue.
   *
   *  REST API endpoint: /api/v1/fetch_signatures
   *
   *  @param gateway The gateway to fetch signatures from. If not provided, a gateway will be automatically selected.
   *  @param recentHash The chain metadata to sign with. Blockhash or slothash.
   *  @param jobs The oracle jobs to perform.
   *  @param numSignatures The number of oracles to fetch signatures from.
   *  @returns A promise that resolves to the feed evaluation responses.
   *  @throws if the request fails.
   */
  async fetchSignatures(params: {
    gateway?: string;
    recentHash?: string;
    jobs: OracleJob[];
    numSignatures?: number;
    maxVariance?: number;
    minResponses?: number;
  }): Promise<{ responses: FeedEvalResponse[]; failures: string[] }> {
    let gateway = new Gateway(this.program, params.gateway ?? "");
    if (params.gateway === undefined) {
      gateway = await this.fetchGateway();
    }
    return await gateway.fetchSignatures(params);
  }

  async fetchSignaturesMulti(params: {
    gateway?: string;
    queue: PublicKey;
    recentHash?: string;
    feedConfigs: FeedRequest[];
    minResponses?: number;
  }): Promise<FetchSignaturesMultiResponse> {
    let gateway = new Gateway(this.program, params.gateway ?? "");
    if (params.gateway === undefined) {
      gateway = await this.fetchGateway();
    }
    return await gateway.fetchSignaturesMulti(params);
  }

  /**
   *  Loads the queue data for this {@linkcode Queue} account from on chain.
   *
   *  @returns A promise that resolves to the queue data.
   *  @throws if the queue account does not exist.
   */
  async loadData(): Promise<any> {
    return await this.program.account["queueAccountData"].fetch(this.pubkey);
  }

  /**
   *  Adds a new MR enclave to the queue.
   *  This will allow the queue to accept signatures from the given MR enclave.
   *  @param mrEnclave The MR enclave to add.
   *  @returns A promise that resolves to the transaction instruction.
   *  @throws if the request fails.
   *  @throws if the MR enclave is already added.
   *  @throws if the MR enclave is invalid.
   *  @throws if the MR enclave is not a valid length.
   */
  async addMrEnclaveIx(params: {
    mrEnclave: Uint8Array;
  }): Promise<TransactionInstruction> {
    const stateKey = State.keyFromSeed(this.program);
    const state = await State.loadData(this.program);
    const programAuthority = state.authority;
    const { authority } = await this.loadData();
    const ix = await this.program.instruction.queueAddMrEnclave(
      { mrEnclave: params.mrEnclave },
      {
        accounts: {
          queue: this.pubkey,
          authority,
          programAuthority,
          state: stateKey,
        },
      }
    );
    return ix;
  }

  /**
   *  Removes an MR enclave from the queue.
   *  This will prevent the queue from accepting signatures from the given MR enclave.
   *  @param mrEnclave The MR enclave to remove.
   *  @returns A promise that resolves to the transaction instruction.
   *  @throws if the request fails.
   *  @throws if the MR enclave is not present.
   */
  async rmMrEnclaveIx(params: {
    mrEnclave: Uint8Array;
  }): Promise<TransactionInstruction> {
    const stateKey = State.keyFromSeed(this.program);
    const state = await State.loadData(this.program);
    const programAuthority = state.authority;
    const { authority } = await this.loadData();
    const ix = await this.program.instruction.queueRemoveMrEnclave(
      { mrEnclave: params.mrEnclave },
      {
        accounts: {
          queue: this.pubkey,
          authority,
          programAuthority,
          state: stateKey,
        },
      }
    );
    return ix;
  }

  /**
   * Sets the queue configurations.
   * @param params.authority The new authority for the queue.
   * @param params.reward The new reward for the queue.
   * @param params.nodeTimeout The new node timeout for the queue.
   * @returns A promise that resolves to the transaction instruction.
   */
  async setConfigsIx(params: {
    authority?: PublicKey;
    reward?: number;
    nodeTimeout?: number;
  }): Promise<TransactionInstruction> {
    const data = await this.loadData();
    const stateKey = State.keyFromSeed(this.program);
    let nodeTimeout: anchor.BN | null = null;
    if (params.nodeTimeout !== undefined) {
      nodeTimeout = new anchor.BN(params.nodeTimeout);
    }
    const ix = await this.program.instruction.queueSetConfigs(
      {
        authority: params.authority ?? null,
        reward: params.reward ?? null,
        nodeTimeout: nodeTimeout,
      },
      {
        accounts: {
          queue: this.pubkey,
          authority: data.authority,
          state: stateKey,
        },
      }
    );
    return ix;
  }

  /**
   * Sets the oracle permission on the queue.
   * @param params.oracle The oracle to set the permission for.
   * @param params.permission The permission to set.
   * @param params.enabled Whether the permission is enabled.
   * @returns A promise that resolves to the transaction instruction   */
  async setOraclePermissionIx(params: {
    oracle: PublicKey;
    permission: SwitchboardPermission;
    enable: boolean;
  }): Promise<TransactionInstruction> {
    const data = await this.loadData();
    return Permission.setIx(this.program, {
      authority: data.authority,
      grantee: params.oracle,
      granter: this.pubkey,
      permission: params.permission,
      enable: params.enable,
    });
  }

  /**
   *  Removes all MR enclaves from the queue.
   *  @returns A promise that resolves to an array of transaction instructions.
   *  @throws if the request fails.
   */
  async rmAllMrEnclaveIxs(): Promise<Array<TransactionInstruction>> {
    const { mrEnclaves, mrEnclavesLen } = await this.loadData();
    const activeEnclaves = mrEnclaves.slice(0, mrEnclavesLen);
    const ixs: Array<TransactionInstruction> = [];
    for (const mrEnclave of activeEnclaves) {
      ixs.push(
        await this.rmMrEnclaveIx({
          mrEnclave,
        })
      );
    }
    return ixs;
  }

  /**
   *  Fetches most recently added and verified Oracle Key.
   *  @returns A promise that resolves to an oracle public key.
   *  @throws if the request fails.
   */
  async fetchFreshOracle(): Promise<PublicKey> {
    const coder = new BorshAccountsCoder(this.program.idl);
    const now = Math.floor(+new Date() / 1000);
    const oracles = await this.fetchOracleKeys();
    const oracleAccounts = await utils.rpc.getMultipleAccounts(
      this.program.provider.connection,
      oracles
    );
    const zip: any = [];
    for (let i = 0; i < oracles.length; i++) {
      zip.push({
        data: coder.decode(
          "oracleAccountData",
          oracleAccounts[i]!.account!.data
        ),
        key: oracles[i],
      });
    }
    const validOracles = zip
      .filter((x: any) => x.data.enclave.verificationStatus === 4) // value 4 is for verified
      .filter((x: any) => x.data.enclave.validUntil > now + 3600); // valid for 1 hour at least
    const chosen =
      validOracles[Math.floor(Math.random() * validOracles.length)];
    return chosen.key;
  }

  async lutSigner(): Promise<PublicKey> {
    return (
      await PublicKey.findProgramAddress(
        [Buffer.from("LutSigner"), this.pubkey.toBuffer()],
        this.program.programId
      )
    )[0];
  }

  async lutKey(lutSlot: number): Promise<PublicKey> {
    const lutSigner = await this.lutSigner();
    const [_, lutKey] = await AddressLookupTableProgram.createLookupTable({
      authority: lutSigner,
      payer: PublicKey.default,
      recentSlot: lutSlot,
    });
    return lutKey;
  }

  async loadLookupTable(): Promise<AddressLookupTableAccount> {
    const data = await this.loadData();
    const lutKey = await this.lutKey(data.lutSlot);
    const accnt = await this.program.provider.connection.getAddressLookupTable(
      lutKey
    );
    return accnt.value!;
  }
}
