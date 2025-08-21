import {
  SOL_NATIVE_MINT,
  SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
} from '../constants.js';
import type { Secp256k1Signature } from '../instruction-utils/Secp256k1InstructionUtils.js';
import { Secp256k1InstructionUtils } from '../instruction-utils/Secp256k1InstructionUtils.js';
import type {
  FeedEvalResponse,
  FetchSignaturesBatchResponse,
  FetchSignaturesConsensusResponse,
  FetchSignaturesMultiResponse,
} from '../oracle-interfaces/gateway.js';
import type { FeedRequest } from '../oracle-interfaces/gateway.js';
import { Gateway } from '../oracle-interfaces/gateway.js';
import { getAssociatedTokenAddress, getNodePayer } from '../utils/index.js';
import { getLutKey, getLutSigner } from '../utils/lookupTable.js';

import { Oracle, OracleAccountData } from './oracle.js';
import type { SwitchboardPermission } from './permission.js';
import { Permission } from './permission.js';
import { State } from './state.js';

import type { Program } from '@coral-xyz/anchor-31';
import { BN, web3 } from '@coral-xyz/anchor-31';
import { CrossbarClient } from '@switchboard-xyz/common';
import { AsyncUtils, type IOracleJob, toUtf8 } from '@switchboard-xyz/common';
import { Buffer } from 'buffer';

/**
 * On-chain queue account data structure
 *
 * The queue account is the core configuration for a set of oracle operators.
 * It defines which oracles are authorized to sign data and various security
 * parameters for the oracle network.
 *
 * @interface QueueAccountData
 */
export interface QueueAccountData {
  /** Authority that can modify the queue configuration */
  authority: web3.PublicKey;
  /** Intel SGX enclave measurements for TEE verification */
  mrEnclaves: Uint8Array[];
  /** Public keys of authorized oracle operators */
  oracleKeys: web3.PublicKey[];
  /** Maximum age for TEE quote verification */
  maxQuoteVerificationAge: BN;
  /** Last heartbeat timestamp from authority */
  lastHeartbeat: BN;
  /** Timeout period for oracle nodes */
  nodeTimeout: BN;
  /** Minimum stake required for oracle operators */
  oracleMinStake: BN;
  /** Time after which authority can override without permission */
  allowAuthorityOverrideAfter: BN;
  /** Number of valid enclave measurements */
  mrEnclavesLen: number;
  /** Number of registered oracle keys */
  oracleKeysLen: number;
  /** Reward amount for oracle operators */
  reward: number;
  /** Current oracle index for round-robin selection */
  currIdx: number;
  /** Garbage collection index */
  gcIdx: number;
  /** Whether authority heartbeat permission is required */
  requireAuthorityHeartbeatPermission: boolean;
  /** Whether authority verify permission is required */
  requireAuthorityVerifyPermission: boolean;
  /** Whether usage permissions are enforced */
  requireUsagePermissions: boolean;
  /** PDA bump for the queue signer account */
  signerBump: number;
  /** Token mint for rewards and fees */
  mint: web3.PublicKey;
  /** Slot when the lookup table was last updated */
  lutSlot: BN;
  /** Whether subsidies are allowed for this queue */
  allowSubsidies: boolean;
  /** Network configuration node (NCN) account */
  ncn: web3.PublicKey;
}

/**
 * Queue account management for Switchboard On-Demand
 *
 * The Queue class is the primary interface for interacting with oracle operators
 * in the Switchboard network. It manages:
 *
 * - Oracle operator authorization and verification
 * - Bundle fetching and signature verification
 * - Address lookup table management
 * - Gateway interactions for data retrieval
 *
 * ## Key Features
 *
 * - **Oracle Management**: Track and verify authorized oracle signers
 * - **Bundle Operations**: Fetch signed data bundles from oracle operators
 * - **LUT Optimization**: Automatic address lookup table management
 * - **Network Detection**: Automatic mainnet/devnet queue selection
 *
 * @example
 * ```typescript
 * // Load the default queue for your network
 * const queue = await Queue.loadDefault(program);
 *
 * // Fetch a bundle for specific feeds
 * const [sigVerifyIx, bundle] = await queue.fetchUpdateBundleIx(
 *   gateway,
 *   crossbar,
 *   ['0x1234...', '0x5678...'] // Feed hashes
 * );
 * ```
 *
 * @class Queue
 */
export class Queue {
  private data: QueueAccountData | null = null;
  private lookupTable: web3.AddressLookupTableAccount | null = null;
  private lookupTableRefreshTime: number = 0;
  static readonly DEFAULT_DEVNET_KEY: web3.PublicKey = new web3.PublicKey(
    'EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7'
  );
  static readonly DEFAULT_MAINNET_KEY: web3.PublicKey = new web3.PublicKey(
    'A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w'
  );

  /**
   * Loads the default queue for the current network
   *
   * Automatically detects whether you're on mainnet or devnet and loads
   * the appropriate default queue. This is the recommended way to get
   * started with Switchboard On-Demand.
   *
   * @param {Program} program - Anchor program instance
   * @returns {Promise<Queue>} The default queue for your network
   *
   * @example
   * ```typescript
   * const queue = await Queue.loadDefault(program);
   * console.log('Using queue:', queue.pubkey.toBase58());
   * ```
   */
  static async loadDefault(program: Program): Promise<Queue> {
    try {
      const queue = new Queue(program, Queue.DEFAULT_MAINNET_KEY);
      await queue.loadData();
      return queue;
    } catch {
      // do nothing
    }
    const queue = new Queue(program, Queue.DEFAULT_DEVNET_KEY);
    return queue;
  }

  /**
   * Fetches a gateway URL from the Crossbar network
   *
   * The gateway is the interface to oracle operators. This method
   * automatically detects your network and returns an appropriate
   * gateway for fetching oracle data.
   *
   * @param {CrossbarClient} crossbar - Crossbar client instance
   * @returns {Promise<Gateway>} Gateway instance for oracle communication
   *
   * @example
   * ```typescript
   * const crossbar = CrossbarClient.default();
   * const gateway = await queue.fetchGatewayFromCrossbar(crossbar);
   * ```
   */
  async fetchGatewayFromCrossbar(crossbar: CrossbarClient): Promise<Gateway> {
    let network = 'mainnet';
    try {
      const queue = new Queue(this.program, Queue.DEFAULT_MAINNET_KEY);
      await queue.loadData();
    } catch {
      network = 'devnet';
    }
    const gatewayUrl = (await crossbar.fetchGateways(network))[0];
    const gateway = new Gateway(this.program, gatewayUrl!);
    return gateway;
  }

  /**
   * Creates a new queue account
   *
   * @param {Program} program - Anchor program instance
   * @param {Object} params - Queue configuration parameters
   * @returns {Promise<[Queue, web3.Keypair, web3.TransactionInstruction]>}
   *          Tuple of [Queue instance, keypair, creation instruction]
   */
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
  ): Promise<[Queue, web3.Keypair, web3.TransactionInstruction]> {
    const queue = web3.Keypair.generate();
    const allowAuthorityOverrideAfter =
      params.allowAuthorityOverrideAfter ?? 60 * 60;
    const requireAuthorityHeartbeatPermission =
      params.requireAuthorityHeartbeatPermission ?? true;
    const requireUsagePermission = params.requireUsagePermission ?? false;
    const maxQuoteVerificationAge =
      params.maxQuoteVerificationAge ?? 60 * 60 * 24 * 7;
    const reward = params.reward ?? 1000000;
    const nodeTimeout = params.nodeTimeout ?? 300;
    const payer = getNodePayer(program);
    // Prepare accounts for the transaction
    const lutSigner = getLutSigner(program.programId, queue.publicKey);
    const recentSlot =
      params.lutSlot ??
      (await program.provider.connection.getSlot('finalized'));
    const lutKey = getLutKey(lutSigner, recentSlot);

    const ix = await program.instruction.queueInit(
      {
        allowAuthorityOverrideAfter,
        requireAuthorityHeartbeatPermission,
        requireUsagePermission,
        maxQuoteVerificationAge,
        reward,
        nodeTimeout,
        recentSlot: new BN(recentSlot),
      },
      {
        accounts: {
          queue: queue.publicKey,
          queueEscrow: await getAssociatedTokenAddress(
            SOL_NATIVE_MINT,
            queue.publicKey
          ),
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          nativeMint: SOL_NATIVE_MINT,
          programState: State.keyFromSeed(program),
          lutSigner: lutSigner,
          lut: lutKey,
          addressLookupTableProgram: web3.AddressLookupTableProgram.programId,
          associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
        },
        signers: [payer, queue],
      }
    );
    return [new Queue(program, queue.publicKey), queue, ix];
  }

  /**
   * Creates a new instance of the `Queue` account with a PDA for SVM (non-solana) chains.
   * @param program The anchor program instance.
   * @param params The initialization parameters for the queue.
   * @returns
   */
  static async createIxSVM(
    program: Program,
    params: {
      sourceQueueKey: web3.PublicKey;
      allowAuthorityOverrideAfter?: number;
      requireAuthorityHeartbeatPermission?: boolean;
      requireUsagePermission?: boolean;
      maxQuoteVerificationAge?: number;
      reward?: number;
      nodeTimeout?: number;
      lutSlot?: number;
    }
  ): Promise<[Queue, web3.TransactionInstruction]> {
    // Generate the queue PDA for the given source queue key
    const [queue] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('Queue'), params.sourceQueueKey.toBuffer()],
      program.programId
    );
    const allowAuthorityOverrideAfter =
      params.allowAuthorityOverrideAfter ?? 60 * 60;
    const requireAuthorityHeartbeatPermission =
      params.requireAuthorityHeartbeatPermission ?? true;
    const requireUsagePermission = params.requireUsagePermission ?? false;
    const maxQuoteVerificationAge =
      params.maxQuoteVerificationAge ?? 60 * 60 * 24 * 7;
    const reward = params.reward ?? 1000000;
    const nodeTimeout = params.nodeTimeout ?? 300;
    const payer = getNodePayer(program);
    // Prepare accounts for the transaction
    const lutSigner = getLutSigner(program.programId, queue);
    const recentSlot =
      params.lutSlot ??
      (await program.provider.connection.getSlot('finalized'));
    const lutKey = getLutKey(lutSigner, recentSlot);

    const ix = program.instruction.queueInitSvm(
      {
        allowAuthorityOverrideAfter,
        requireAuthorityHeartbeatPermission,
        requireUsagePermission,
        maxQuoteVerificationAge,
        reward,
        nodeTimeout,
        recentSlot: new BN(recentSlot),
        sourceQueueKey: params.sourceQueueKey,
      },
      {
        accounts: {
          queue: queue,
          queueEscrow: await getAssociatedTokenAddress(
            SOL_NATIVE_MINT,
            queue,
            true
          ),
          authority: payer.publicKey,
          payer: payer.publicKey,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          nativeMint: SOL_NATIVE_MINT,
          programState: State.keyFromSeed(program),
          lutSigner: lutSigner,
          lut: lutKey,
          addressLookupTableProgram: web3.AddressLookupTableProgram.programId,
          associatedTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
        },
        signers: [payer],
      }
    );
    return [new Queue(program, queue), ix];
  }

  /**
   * Add an Oracle to a queue and set permissions
   * @param program
   * @param params
   */
  async overrideSVM(params: {
    oracle: web3.PublicKey;
    secp256k1Signer: Buffer;
    maxQuoteVerificationAge: number;
    mrEnclave: Buffer;
    slot: number;
  }) {
    const stateKey = State.keyFromSeed(this.program);
    const { authority } = await this.loadData();

    const ix = this.program.instruction.queueOverrideSvm(
      {
        secp256K1Signer: Array.from(params.secp256k1Signer),
        maxQuoteVerificationAge: new BN(params.maxQuoteVerificationAge),
        mrEnclave: params.mrEnclave,
        slot: new BN(params.slot),
      },
      {
        accounts: {
          queue: this.pubkey,
          oracle: params.oracle,
          authority,
          state: stateKey,
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
      queue: web3.PublicKey;
      recentHash?: string;
      jobs: IOracleJob[];
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
      queue: web3.PublicKey;
      recentHash?: string;
      feedConfigs: FeedRequest[];
      minResponses?: number;
    }
  ): Promise<FetchSignaturesMultiResponse> {
    const queueAccount = new Queue(program, params.queue!);
    return queueAccount.fetchSignaturesMulti(params);
  }

  static async fetchSignaturesBatch(
    program: Program,
    params: {
      gateway?: string;
      queue: web3.PublicKey;
      recentHash?: string;
      feedConfigs: FeedRequest[];
      minResponses?: number;
    }
  ): Promise<FetchSignaturesBatchResponse> {
    const queueAccount = new Queue(program, params.queue!);
    return queueAccount.fetchSignaturesBatch(params);
  }

  static async fetchSignaturesConsensus(
    program: Program,
    params: {
      gateway?: string;
      queue: web3.PublicKey;
      feedConfigs: FeedRequest[];
      useTimestamp?: boolean;
      numSignatures?: number;
    }
  ): Promise<FetchSignaturesConsensusResponse> {
    const queueAccount = new Queue(program, params.queue!);
    return queueAccount.fetchSignaturesConsensus({
      gateway: params.gateway,
      feedConfigs: params.feedConfigs,
      useTimestamp: params.useTimestamp,
      numSignatures: params.numSignatures,
    });
  }

  /**
   * @deprecated
   * Deprecated. Use {@linkcode @switchboard-xyz/common#FeedHash.compute} instead.
   */
  static async fetchFeedHash(
    program: Program,
    params: {
      gateway?: string;
      queue: web3.PublicKey;
      recentHash?: string;
      jobs: IOracleJob[];
      numSignatures?: number;
      maxVariance?: number;
      minResponses?: number;
    }
  ): Promise<Buffer> {
    const queueAccount = new Queue(program, params.queue);
    const oracleSigs = await queueAccount.fetchSignatures(params);
    return Buffer.from(oracleSigs[0].feed_hash, 'hex');
  }

  /**
   *  Constructs a `OnDemandQueue` instance.
   *
   *  @param program The Anchor program instance.
   *  @param pubkey The public key of the queue account.
   */
  constructor(
    readonly program: Program,
    readonly pubkey: web3.PublicKey
  ) {
    if (this.pubkey === undefined) {
      throw new Error('NoPubkeyProvided');
    }
  }

  /**
   *  Loads the queue data from on chain and returns the listed oracle keys.
   *
   *  @returns A promise that resolves to an array of oracle public keys.
   */
  async fetchOracleKeys(): Promise<web3.PublicKey[]> {
    const data = await this.loadData();
    const oracles = data.oracleKeys.slice(0, data.oracleKeysLen);
    return oracles;
  }

  /**
   *  Loads the queue data from on chain and returns the listed gateways.
   *
   *  @returns A promise that resolves to an array of gateway URIs.
   */
  async fetchAllGateways(): Promise<Gateway[]> {
    const program = this.program;
    const oracles = await this.fetchOracleKeys();
    const oracleAccounts = await Oracle.loadMany(program, oracles);
    const gatewayUris = oracleAccounts
      .map(oracleAccount =>
        oracleAccount ? toUtf8(oracleAccount.gatewayUri) : ''
      )
      .filter(gatewayUri => gatewayUri.length > 0)
      .filter(gatewayUri => !gatewayUri.includes('infstones'));

    const tests: { gateway: Gateway; promise: Promise<boolean> }[] = [];
    for (const i in gatewayUris) {
      const gw = new Gateway(program, gatewayUris[i], oracles[i]);
      tests.push({ gateway: gw, promise: gw.test() });
    }

    let gateways: Gateway[] = [];
    for (const test of tests) {
      try {
        const { gateway, promise } = test;
        // Test gateways to see if they are good. Timeout after 2 seconds.
        const isGood = await AsyncUtils.promiseWithTimeout(2000, promise);
        if (!isGood) continue;

        // If the gateway is good, add it to the list
        gateways.push(gateway);
      } catch (e) {
        console.log('Timeout', e);
      }
    }
    gateways = gateways.sort(() => Math.random() - 0.5);
    return gateways as Gateway[];
  }

  /**
   * Fetches a gateway interface for interacting with oracle nodes.
   *
   * @param gatewayUrl - Optional URL of a specific gateway to use. If not provided,
   *                     a random gateway will be selected from the queue's available gateways.
   * @returns Gateway - A Gateway instance for making oracle requests
   * @throws {Error} If no gateways are available on the queue when selecting randomly
   */
  async fetchGateway(gatewayUrl?: string): Promise<Gateway> {
    if (gatewayUrl) return new Gateway(this.program, gatewayUrl);

    const gateways = await this.fetchAllGateways();
    if (gateways.length === 0) throw new Error('NoGatewayAvailable');
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
   *  @param maxVariance The maximum variance allowed in the responses.
   *  @param minResponses The minimum number of responses to attempt to fetch.
   *  @returns A promise that resolves to the feed evaluation responses.
   *  @throws if the request fails.
   */
  async fetchSignatures(params: {
    gateway?: string;
    recentHash?: string;
    jobs: IOracleJob[];
    numSignatures?: number;
    maxVariance?: number;
    minResponses?: number;
    useTimestamp?: boolean;
  }): Promise<{ responses: FeedEvalResponse[]; failures: string[] }> {
    const gateway = await this.fetchGateway(params.gateway);
    return await gateway.fetchSignatures({
      recentHash: params.recentHash,
      jobs: params.jobs,
      numSignatures: params.numSignatures,
      maxVariance: params.maxVariance,
      minResponses: params.minResponses,
      useTimestamp: params.useTimestamp,
    });
  }

  async fetchSignaturesMulti(params: {
    gateway?: string;
    recentHash?: string;
    feedConfigs: FeedRequest[];
    numSignatures?: number;
    useTimestamp?: boolean;
  }): Promise<FetchSignaturesMultiResponse> {
    const gateway = await this.fetchGateway(params.gateway);
    return await gateway.fetchSignaturesMulti({
      recentHash: params.recentHash,
      feedConfigs: params.feedConfigs,
      numSignatures: params.numSignatures,
      useTimestamp: params.useTimestamp,
    });
  }

  async fetchSignaturesConsensus(params: {
    gateway?: string;
    feedConfigs: FeedRequest[];
    useTimestamp?: boolean;
    numSignatures?: number;
  }): Promise<FetchSignaturesConsensusResponse> {
    const gateway = await this.fetchGateway(params.gateway);
    return await gateway.fetchSignaturesConsensus({
      feedConfigs: params.feedConfigs,
      useTimestamp: params.useTimestamp,
      numSignatures: params.numSignatures,
    });
  }

  async fetchSignaturesBatch(params: {
    gateway?: string;
    recentHash?: string;
    feedConfigs: FeedRequest[];
    numSignatures?: number;
    useTimestamp?: boolean;
  }): Promise<FetchSignaturesBatchResponse> {
    const gateway = await this.fetchGateway(params.gateway);
    return await gateway.fetchSignaturesBatch({
      recentHash: params.recentHash,
      feedConfigs: params.feedConfigs,
      numSignatures: params.numSignatures,
      useTimestamp: params.useTimestamp,
    });
  }

  /**
   *  Loads the queue data for this {@linkcode Queue} account from on chain.
   *
   *  @returns A promise that resolves to the queue data.
   *  @throws if the queue account does not exist.
   */
  static loadData(
    program: Program,
    pubkey: web3.PublicKey
  ): Promise<QueueAccountData> {
    return program.account['queueAccountData'].fetch(pubkey);
  }

  /**
   *  Loads the queue data for this {@linkcode Queue} account from on chain.
   *
   *  @returns A promise that resolves to the queue data.
   *  @throws if the queue account does not exist.
   */
  async loadData(): Promise<QueueAccountData> {
    if (this.data === null || this.data === undefined) {
      this.data = await Queue.loadData(this.program, this.pubkey);
    }
    return this.data;
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
  }): Promise<web3.TransactionInstruction> {
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
  }): Promise<web3.TransactionInstruction> {
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
    authority?: web3.PublicKey;
    reward?: number;
    nodeTimeout?: number;
  }): Promise<web3.TransactionInstruction> {
    const data = await this.loadData();
    const stateKey = State.keyFromSeed(this.program);
    const nodeTimeout = params.nodeTimeout ? new BN(params.nodeTimeout) : null;
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

  async setNcnIx(params: {
    ncn: web3.PublicKey;
  }): Promise<web3.TransactionInstruction> {
    const data = await this.loadData();
    const authority = data.authority;
    const state = State.keyFromSeed(this.program);
    return this.program.instruction.queueSetNcn(
      {},
      {
        accounts: {
          queue: this.pubkey,
          authority,
          state,
          ncn: params.ncn,
        },
      }
    );
  }

  async setVaultIx(params: {
    vault: web3.PublicKey;
    enable: boolean;
  }): Promise<web3.TransactionInstruction> {
    const data = await this.loadData();
    const authority = data.authority;
    const state = State.keyFromSeed(this.program);
    const ncn = data.ncn;
    return this.program.instruction.queueSetVault(
      {
        enable: params.enable,
      },
      {
        accounts: {
          queue: this.pubkey,
          authority,
          state,
          ncn,
          vault: params.vault,
        },
      }
    );
  }

  async allowSubsidyIx(params: {
    enable: boolean;
  }): Promise<web3.TransactionInstruction> {
    const data = await this.loadData();
    const authority = data.authority;
    const state = State.keyFromSeed(this.program);
    return this.program.instruction.queueAllowSubsidies(
      {
        allowSubsidies: params.enable,
      },
      {
        accounts: {
          queue: this.pubkey,
          authority,
          state,
        },
      }
    );
  }

  /**
   * Sets the oracle permission on the queue.
   * @param params.oracle The oracle to set the permission for.
   * @param params.permission The permission to set.
   * @param params.enabled Whether the permission is enabled.
   * @returns A promise that resolves to the transaction instruction   */
  async setOraclePermissionIx(params: {
    oracle: web3.PublicKey;
    permission: SwitchboardPermission;
    enable: boolean;
  }): Promise<web3.TransactionInstruction> {
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
  async rmAllMrEnclaveIxs(): Promise<Array<web3.TransactionInstruction>> {
    const { mrEnclaves, mrEnclavesLen } = await this.loadData();
    const activeEnclaves = mrEnclaves.slice(0, mrEnclavesLen);
    const ixs: Array<web3.TransactionInstruction> = [];
    for (const mrEnclave of activeEnclaves) {
      ixs.push(await this.rmMrEnclaveIx({ mrEnclave }));
    }
    return ixs;
  }

  /**
   *  Fetches most recently added and verified Oracle Key.
   *  @returns A promise that resolves to an oracle public key.
   *  @throws if the request fails.
   */
  async fetchFreshOracle(): Promise<web3.PublicKey> {
    const now = Math.floor(+new Date() / 1000);
    const oracles = await this.fetchOracleKeys();
    const oracleAccounts = await Oracle.loadMany(this.program, oracles);
    const oracleUris = oracleAccounts
      .map(data => toUtf8(data!.gatewayUri))
      .filter(gatewayUri => gatewayUri.length);

    const tests: Promise<boolean>[] = [];
    for (const i in oracleUris) {
      const gw = new Gateway(this.program, oracleUris[i], oracles[i]);
      tests.push(gw.test());
    }

    const zip: { key: web3.PublicKey; data: OracleAccountData }[] = [];
    for (let i = 0; i < oracles.length; i++) {
      try {
        // Test gateways to see if they are good. Timeout after 2 seconds.
        const isGood = await AsyncUtils.promiseWithTimeout(2000, tests[i]);
        if (!isGood) continue;
      } catch (e) {
        console.log('Gateway Timeout', e);
      }
      zip.push({ data: oracleAccounts[i]!, key: oracles[i] });
    }

    const validOracles = zip
      .filter(x => x.data.enclave.verificationStatus === 4) // value 4 is for verified
      .filter(x => x.data.enclave.validUntil.gt(new BN(now + 3600))); // valid for 1 hour at least
    if (validOracles.length === 0) throw new Error('NoValidOracles');

    const chosen =
      validOracles[Math.floor(Math.random() * validOracles.length)];
    return chosen.key;
  }

  /**
   * Get the PDA for the queue (SVM chains that are not solana)
   * @returns Queue PDA Pubkey
   */
  queuePDA(): web3.PublicKey {
    return Queue.queuePDA(this.program, this.pubkey);
  }

  /**
   * Get the PDA for the queue (SVM chains that are not solana)
   * @param program Anchor program
   * @param pubkey Queue pubkey
   * @returns Queue PDA Pubkey
   */
  static queuePDA(program: Program, pubkey: web3.PublicKey): web3.PublicKey {
    const [queuePDA] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('Queue'), pubkey.toBuffer()],
      program.programId
    );
    return queuePDA;
  }

  // auto refresh lookup table if it is older than 5 minutes
  async loadLookupTable(): Promise<web3.AddressLookupTableAccount> {
    const now = Date.now();
    if (this.lookupTable && now - this.lookupTableRefreshTime < 5 * 60 * 1000) {
      return this.lookupTable;
    }
    const data = await this.loadData();
    const lutSigner = getLutSigner(this.program.programId, this.pubkey);
    const lutKey = getLutKey(lutSigner, data.lutSlot);
    const accnt =
      await this.program.provider.connection.getAddressLookupTable(lutKey);
    this.lookupTable = accnt.value;
    return accnt.value!;
  }

  /**
   * Fetches oracle bundle and creates verification instruction
   *
   * This is the primary method for fetching oracle data in the bundle approach.
   * It retrieves signed price data from oracle operators and creates the
   * instruction to verify signatures on-chain.
   *
   * @param {Gateway} gateway - Gateway instance for oracle communication
   * @param {CrossbarClient} crossbar - Crossbar client for data routing
   * @param {string[]} feedHashes - Array of feed hashes to fetch (hex strings)
   * @param {number} numSignatures - Number of oracle signatures required (default: 1)
   * @returns {Promise<[web3.TransactionInstruction, Buffer]>}
   *          Tuple of [signature verification instruction, bundle data]
   *
   * @example
   * ```typescript
   * // Fetch prices for BTC and ETH
   * const [sigVerifyIx, bundle] = await queue.fetchUpdateBundleIx(
   *   gateway,
   *   crossbar,
   *   ['0x1234...', '0x5678...'], // Feed hashes
   *   3 // Require 3 oracle signatures
   * );
   *
   * // Use in your transaction
   * const tx = await asV0Tx({
   *   connection,
   *   ixs: [sigVerifyIx, yourProgramIx],
   *   signers: [payer],
   * });
   * ```
   */
  async fetchUpdateBundleIx(
    gateway: Gateway,
    crossbar: CrossbarClient,
    feedHashes: string[],
    numSignatures: number = 1
  ): Promise<[web3.TransactionInstruction, Buffer]> {
    const response = await gateway.fetchUpdateBundle(
      crossbar,
      feedHashes,
      numSignatures
    );

    // Check if oracle_responses is empty
    if (!response.oracle_responses || response.oracle_responses.length === 0) {
      throw new Error(
        'No oracle responses available for creating secp256k1 signatures'
      );
    }

    const secpSignatures: Secp256k1Signature[] =
      response.oracle_responses.map<Secp256k1Signature>(oracleResponse => {
        return {
          ethAddress: Buffer.from(oracleResponse.eth_address, 'hex'),
          signature: Buffer.from(oracleResponse.signature, 'base64'),
          message: Buffer.from(oracleResponse.checksum, 'base64'),
          recoveryId: oracleResponse.recovery_id,
        };
      });
    const secpInstruction = Secp256k1InstructionUtils.buildSecp256k1Instruction(
      secpSignatures,
      0
    );

    // Prepare the instruction data for the `pullFeedSubmitResponseManySecp` instruction.
    const data = {
      slotLower: Number(response.slot) & 0xff,
      feedInfos: response.median_responses.map(
        ({ value, feed_hash, num_oracles }) => {
          return {
            value: new BN(value),
            checksum: Buffer.from(feed_hash, 'hex'),
            numOracles: num_oracles,
          };
        }
      ),
    };
    // // Prepare the accounts for the `pullFeedSubmitResponseManySecp` instruction.
    // const accounts = {
    // queue: queue!,
    // recentSlothashes: SPL_SYSVAR_SLOT_HASHES_ID,
    // ixSysvar: SPL_SYSVAR_INSTRUCTIONS_ID,
    // };
    //
    // const verifyIx = this.program.instruction.pullFeedVerifyResponse(
    // instructionData,
    // {
    // accounts,
    // }
    // );

    // Load the lookup tables for the feeds and oracles.
    return [secpInstruction, serializeBundleData(data)];
  }
}

export function serializeBundleData(data: {
  slotLower: number;
  feedInfos: { value: BN; checksum: Buffer; numOracles: number }[];
}): Buffer {
  const buffers: Buffer[] = [];

  // slotLower: 1 byte
  const slotBuffer = Buffer.alloc(1);
  slotBuffer.writeUInt8(data.slotLower);
  buffers.push(slotBuffer);

  for (const feed of data.feedInfos) {
    // checksum: 32 bytes
    if (feed.checksum.length !== 32) {
      throw new Error('Checksum must be 32 bytes');
    }
    buffers.push(feed.checksum);

    // value: 16-byte little-endian i128
    const valueBuf = feed.value.toTwos(128).toArrayLike(Buffer, 'le', 16);
    buffers.push(valueBuf);
    buffers.push(Buffer.from([feed.numOracles]));
  }

  return Buffer.concat(buffers);
}
