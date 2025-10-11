import { BN } from '@coral-xyz/anchor-31';
import * as web3 from '@solana/web3.js';
import { Buffer } from 'buffer';

export const QUOTE_PROGRAM_ID = new web3.PublicKey(
  'orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz'
);

export interface OracleQuoteData {
  signedSlothash: Buffer;
  feedInfos: FeedInfo[];
  oracleIndexes: number[];
  recentSlot: BN;
  version: number;
  discriminator: string;
}

export interface FeedInfo {
  feedHash: Buffer;
  value: bigint;
  minOracleSamples: number;
}

export class OracleQuote {
  static getCanonicalPubkey(
    queueKey: web3.PublicKey,
    feedHashes: Array<string | Buffer>,
    programId?: web3.PublicKey
  ): [web3.PublicKey, number] {
    // Convert feed hashes to seed buffers (feed IDs)
    // This matches the Rust logic: self.feeds().iter().map(|info| info.feed_id().as_slice())
    const feedIdSeeds = feedHashes.map(hash => {
      if (typeof hash === 'string') {
        if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(hash)) {
          throw new Error(`Invalid feed hash format: ${hash}`);
        }
        return Buffer.from(hash.replace('0x', ''), 'hex');
      } else if (Buffer.isBuffer(hash)) {
        if (hash.length !== 32) {
          throw new Error(
            `Feed hash buffer must be 32 bytes, got ${hash.length}`
          );
        }
        return hash;
      }
      throw new Error('Feed hash must be a hex string or Buffer');
    });

    // Build seeds array with queue key first, then feed IDs
    // This matches Rust logic: seeds.push(queue_key.as_ref()); for (id in feed_ids) seeds.push(id.as_slice());
    const seedRefs: Buffer[] = [
      Buffer.from(queueKey.toBytes()),
      ...feedIdSeeds,
    ];

    // Derive the oracle account using queue key + feed IDs as seeds
    // This matches: Pubkey::find_program_address(&seed_refs, program_id)
    const [quoteAccount, bump] = web3.PublicKey.findProgramAddressSync(
      seedRefs,
      programId ?? QUOTE_PROGRAM_ID
    );

    return [quoteAccount, bump];
  }

  /**
   * Decodes oracle quote data from the Ed25519 instruction sysvar buffer
   *
   * The instruction data format is:
   * 1. count (1 byte) - number of signatures
   * 2. padding (1 byte)
   * 3. signature offsets (14 bytes each)
   * 4. signatures (64 bytes each)
   * 5. pubkeys (32 bytes each)
   * 6. message (variable length):
   *    - signed_slothash (32 bytes)
   *    - feed_infos (49 bytes each): feed_hash (32) + value (16) + min_oracle_samples (1)
   * 7. oracle indexes (1 byte each)
   * 8. recent_slot (8 bytes, u64 LE)
   * 9. version (1 byte, u8)
   * 10. discriminator (4 bytes, "SBOD")
   *
   * @param buffer - The Ed25519 instruction data buffer
   * @returns Decoded oracle quote data
   */
  static decode(buffer: Buffer): OracleQuoteData {
    if (!buffer || buffer.length === 0) {
      throw new Error('Invalid buffer: cannot be empty');
    }

    const SLOT_SIZE = 8;
    const VERSION_SIZE = 1;
    const DISCRIMINATOR_SIZE = 4;

    // 1. Read count (number of signatures)
    const count = buffer[0];
    if (count === 0) {
      throw new Error('Invalid count: must be greater than 0');
    }

    // Calculate offsets
    const SIGNATURE_OFFSETS_START = 2;
    const ED25519_SIGNATURE_OFFSETS_SIZE = 14;

    // Read message offset from first signature's offsets
    const firstOffsetBlock = buffer.slice(
      SIGNATURE_OFFSETS_START,
      SIGNATURE_OFFSETS_START + ED25519_SIGNATURE_OFFSETS_SIZE
    );

    // Message offset is at bytes 8-9 (LE u16)
    const messageOffset = firstOffsetBlock.readUInt16LE(8);

    // Message size is at bytes 10-11 (LE u16)
    const messageSize = firstOffsetBlock.readUInt16LE(10);

    // Extract the full message
    const message = buffer.slice(messageOffset, messageOffset + messageSize);

    // Parse message structure:
    // 1. signed_slothash (32 bytes)
    const signedSlothash = message.slice(0, 32);

    // 2. feed_infos (49 bytes each)
    const feedInfosData = message.slice(32);
    const FEED_INFO_SIZE = 49; // 32 (feed_hash) + 16 (value) + 1 (min_oracle_samples)
    const numFeeds = Math.floor(feedInfosData.length / FEED_INFO_SIZE);

    const feedInfos: FeedInfo[] = [];
    for (let i = 0; i < numFeeds; i++) {
      const offset = i * FEED_INFO_SIZE;
      const feedInfoBuffer = feedInfosData.slice(
        offset,
        offset + FEED_INFO_SIZE
      );

      const feedHash = feedInfoBuffer.slice(0, 32);
      const valueBytes = feedInfoBuffer.slice(32, 48);

      // Convert 16-byte little-endian to bigint
      let value = BigInt(0);
      for (let j = 0; j < 16; j++) {
        value |= BigInt(valueBytes[j]) << (BigInt(j) * BigInt(8));
      }

      const minOracleSamples = feedInfoBuffer[48];

      feedInfos.push({
        feedHash,
        value,
        minOracleSamples,
      });
    }

    // 3. Oracle indexes (after message)
    const oracleIndexesOffset = messageOffset + messageSize;
    const oracleIndexes: number[] = [];
    for (let i = 0; i < count; i++) {
      oracleIndexes.push(buffer[oracleIndexesOffset + i]);
    }

    // 4. Recent slot (8 bytes u64 LE)
    const slotOffset = oracleIndexesOffset + count;
    const slotBuffer = buffer.slice(slotOffset, slotOffset + SLOT_SIZE);
    const recentSlot = new BN(slotBuffer.readBigUInt64LE(0).toString());

    // 5. Version (1 byte u8)
    const versionOffset = slotOffset + SLOT_SIZE;
    const version = buffer[versionOffset];

    // 6. Discriminator (4 bytes)
    const discriminatorOffset = versionOffset + VERSION_SIZE;
    const discriminatorBuffer = buffer.slice(
      discriminatorOffset,
      discriminatorOffset + DISCRIMINATOR_SIZE
    );
    const discriminator = discriminatorBuffer.toString('utf8');

    return {
      signedSlothash,
      feedInfos,
      oracleIndexes,
      recentSlot,
      version,
      discriminator,
    };
  }
}
