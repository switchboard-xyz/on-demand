export * from "./TypescriptUtils.js";
import { Oracle } from "../accounts/oracle.js";
import type { PullFeed } from "../accounts/pullFeed.js";
import { Queue } from "../accounts/queue.js";

import * as anchor from "@coral-xyz/anchor-30";
import type { AddressLookupTableAccount } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type { IOracleJob } from "@switchboard-xyz/common";
import { CrossbarClient } from "@switchboard-xyz/common";

export async function loadLookupTables(
  accounts: any[]
): Promise<AddressLookupTableAccount[]> {
  const out: Promise<any>[] = [];
  for (const account of accounts) {
    if (account.loadLookupTable) {
      out.push(account.loadLookupTable());
    }
  }
  return Promise.all(out);
}

// Mainnet ID's
export const ON_DEMAND_MAINNET_PID =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv";
export const ON_DEMAND_MAINNET_GUARDIAN_QUEUE =
  "B7WgdyAgzK7yGoxfsBaNnY6d41bTybTzEh4ZuQosnvLK";
export const ON_DEMAND_MAINNET_QUEUE =
  "A43DyUGA7s8eXPxqEjJY6EBu1KKbNgfxF8h17VAHn13w";

// Devnet ID's
export const ON_DEMAND_DEVNET_PID =
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv";
export const ON_DEMAND_DEVNET_GUARDIAN_QUEUE =
  "Did69tHXs3NTTomR4ZBzttKjB6W3dssavL8uafVbJ1Q";
export const ON_DEMAND_DEVNET_QUEUE =
  "FfD96yeXs4cxZshoPPSKhSPgVQxLAJUT3gefgh84m1Di";

/**
 * Get the default devnet queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default devnet queue
 */
export async function getDefaultDevnetQueue(
  solanaRPCUrl: string = "https://api.devnet.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_DEVNET_PID.toString(),
    ON_DEMAND_DEVNET_QUEUE.toString()
  );
}

/**
 * Get the default devnet guardian queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default devnet guardian queue
 */
export async function getDefaultDevnetGuardianQueue(
  solanaRPCUrl: string = "https://api.devnet.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_DEVNET_PID.toString(),
    ON_DEMAND_DEVNET_GUARDIAN_QUEUE.toString()
  );
}

/**
 * Get the default queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default queue
 * @NOTE - SWITCHBOARD PID AND QUEUE PUBKEY ARE WRONG
 */
export async function getDefaultQueue(
  solanaRPCUrl: string = "https://api.mainnet-beta.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_MAINNET_PID.toString(),
    ON_DEMAND_MAINNET_QUEUE.toString()
  );
}

/**
 * Get the default guardian queue for the Switchboard program
 * @param solanaRPCUrl - (optional) string: The Solana RPC URL
 * @returns - Promise<Queue> - The default guardian queue
 * @NOTE - SWITCHBOARD PID AND GUARDIAN QUEUE PUBKEY ARE WRONG
 */
export async function getDefaultGuardianQueue(
  solanaRPCUrl: string = "https://api.mainnet-beta.solana.com"
): Promise<Queue> {
  return getQueue(
    solanaRPCUrl,
    ON_DEMAND_MAINNET_PID.toString(),
    ON_DEMAND_MAINNET_GUARDIAN_QUEUE.toString()
  );
}

/**
 * Get the queue for the Switchboard program
 * @param solanaRPCUrl - string: The Solana RPC URL
 * @param switchboardProgramId - string: The Switchboard program ID
 * @param queueAddress - string: The queue address
 * @returns - Promise<Queue> - The queue
 */
export async function getQueue(
  solanaRPCUrl: string,
  switchboardProgramId: string,
  queueAddress: string
): Promise<Queue> {
  const { PublicKey, Keypair, Connection } = anchor.web3;
  const wallet: anchor.Wallet = new anchor.Wallet(new Keypair());
  const connection = new Connection(solanaRPCUrl, "confirmed");
  const PID = new PublicKey(switchboardProgramId);
  const queue = new PublicKey(queueAddress);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  const idl = (await anchor.Program.fetchIdl(PID, provider))!;
  const program = new anchor.Program(idl, provider);
  const queueAccount = new Queue(program, queue);
  return queueAccount;
}

/**
 * Get the unique LUT keys for the queue, all oracles in the queue, and all feeds
 * provided
 * @param queue - Queue: The queue
 * @param feeds - PullFeed[]: The feeds
 * @returns - Promise<PublicKey[]>: The unique LUT keys
 */
export async function fetchAllLutKeys(
  queue: Queue,
  feeds: PullFeed[]
): Promise<PublicKey[]> {
  const oracles = await queue.fetchOracleKeys();
  const lutOwners: any[] = [];
  lutOwners.push(queue);
  for (const feed of feeds) {
    lutOwners.push(feed);
  }
  for (const oracle of oracles) {
    lutOwners.push(new Oracle(queue.program, oracle));
  }
  const lutPromises = lutOwners.map((lutOwner) => {
    return lutOwner.loadLookupTable();
  });
  const luts = await Promise.all(lutPromises);
  const keyset = new Set<PublicKey>();
  for (const lut of luts) {
    for (const key of lut.state.addresses) {
      keyset.add(key.toString());
    }
  }
  return Array.from(keyset).map((key) => new PublicKey(key));
}

/**
 *
 * @param queue Queue pubkey as base58 string
 * @param jobs Array of jobs to store (Oracle Jobs Object)
 * @param crossbarUrl
 * @returns
 */
export async function storeFeed(
  queue: string,
  jobs: IOracleJob[],
  crossbarUrl: string = "https://crossbar.switchboard.xyz"
): Promise<{
  cid: string;
  feedHash: string;
  queueHex: string;
}> {
  const crossbar = crossbarUrl.endsWith("/")
    ? crossbarUrl.slice(0, -1)
    : crossbarUrl;

  const x = new CrossbarClient(crossbar);
  return await x.store(queue, jobs);
}

export async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): Promise<PublicKey> {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer()))
    throw new Error("TokenOwnerOffCurveError");

  const [address] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  );

  return address;
}

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer()))
    throw new Error("TokenOwnerOffCurveError");

  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  );

  return address;
}

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** Address of the SPL Token 2022 program */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** Address of the SPL Associated Token Account program */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** Address of the special mint for wrapped native SOL in spl-token */
export const NATIVE_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

/** Address of the special mint for wrapped native SOL in spl-token-2022 */
export const NATIVE_MINT_2022 = new PublicKey(
  "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP"
);
