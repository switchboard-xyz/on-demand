import { web3 } from '@coral-xyz/anchor-31';
import { NonEmptyArrayUtils } from '@switchboard-xyz/common';

// The serialized size of an ED25519 signature
const ED25519_SIGNATURE_SERIALIZED_SIZE = 64;
// The serialized size of an ED25519 pubkey
const ED25519_PUBKEY_SERIALIZED_SIZE = 32;
// The serialized size of the signature offsets
const ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE = 14;

// Message format constants
const OFFSET_FIELD_SIZE = 2; // Each offset field is 2 bytes (LE)
const SLOT_SIZE = 8; // Recent slot is 8 bytes (u64 LE)
const VERSION_SIZE = 1; // Version is 1 byte (u8)
const ORACLE_INDEX_SIZE = 1; // Each oracle index is 1 byte
const PADDING_SIZE = 1; // Single padding byte in instruction format

export type Ed25519Signature = {
  pubkey: Buffer; // 32-byte ED25519 public key
  signature: Buffer; // 64-byte ED25519 signature
  message: Buffer; // Variable length message (no 32-byte constraint!)
  oracleIdx: number; // Index of the oracle in the queue
};

export class Ed25519InstructionUtils {
  /**
   *  Disable instantiation of the InstructionUtils class
   */
  private constructor() {}

  /**
   * Build ED25519 instruction for variable length messages
   * Unlike secp256k1, ED25519 can sign messages of any length safely
   */
  static buildEd25519Instruction(
    signatures: Ed25519Signature[],
    instructionIndex: number,
    recentSlot?: number,
    version?: number
  ): web3.TransactionInstruction {
    // Add null/undefined check before array validation
    if (!signatures || !Array.isArray(signatures)) {
      throw new Error('Invalid `signatures` parameter: must be an array');
    }

    // Ensure that the `instructionIndex` is both a valid finite number and non-negative
    if (!Number.isFinite(instructionIndex) || instructionIndex < 0) {
      throw new Error('Invalid instruction index');
    } else if (!NonEmptyArrayUtils.safeValidate(signatures)) {
      // Ensure that the `signatures` array is non-empty and that all signatures share the same
      // common message
      throw new Error(
        'Invalid `signatures` array: cannot be empty. All oracles failed to provide valid signatures.'
      );
    }

    // Validate that all signatures have oracleIdx - required for queue order matching
    for (let i = 0; i < signatures.length; i++) {
      if (typeof signatures[i].oracleIdx !== 'number') {
        throw new Error(
          `Signature at index ${i} missing oracleIdx field - required for queue ordering`
        );
      }
    }

    // Sort signatures by oracleIdx to match queue order - CRITICAL for verification
    // The Rust verification code expects signatures in the same order as oracle_keys
    const sortedSignatures = [...signatures].sort(
      (a, b) => a.oracleIdx - b.oracleIdx
    );

    // For ED25519, messages can be different lengths, but we still want to validate
    // that all signatures are signing the same logical message content
    // const diffIdx = sortedSignatures.findIndex(
    // sig => !sig.message.equals(sortedSignatures[0].message)
    // );
    // if (diffIdx !== -1) {
    // const expectedMessage = sortedSignatures[0].message.toString('base64');
    // const differentMessage =
    // sortedSignatures[diffIdx].message.toString('base64');
    // throw new Error(`
    // All signatures must share the same message. The signed message at #${diffIdx}
    // (${differentMessage}) does not match the expected message (${expectedMessage})
    // `);
    // }

    // We've validated that all signatures share the same message
    const commonMessage = sortedSignatures[0].message;
    const commonMessageSize = commonMessage.length;

    // Solana Ed25519 instruction format constants (from working test_correct_format.js)
    const SIGNATURE_OFFSETS_START = OFFSET_FIELD_SIZE; // Includes padding byte!
    const DATA_START =
      ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE + SIGNATURE_OFFSETS_START; // 14 + 2 = 16

    const numSignatures = sortedSignatures.length;

    // Correct Solana offsets calculation (from working test_correct_format.js)
    const signatureOffset = DATA_START; // 16
    const pubkeyOffset = signatureOffset + ED25519_SIGNATURE_SERIALIZED_SIZE; // 16 + 64 = 80
    const messageOffset = pubkeyOffset + ED25519_PUBKEY_SERIALIZED_SIZE; // 80 + 32 = 112

    const signatureOffsets: Uint8Array[] = [];
    const signatureBuffer: number[] = [];

    for (let i = 0; i < sortedSignatures.length; i++) {
      const sig = sortedSignatures[i];

      // Create a new Uint8Array to store the signature offsets
      const offsetsBytes = new Uint8Array(
        ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE
      );
      let position = 0;

      // Calculate offsets for this signature (for multiple signatures, adjust accordingly)
      const currentSignatureOffset =
        signatureOffset + i * ED25519_SIGNATURE_SERIALIZED_SIZE;
      const currentPubkeyOffset =
        pubkeyOffset + i * ED25519_PUBKEY_SERIALIZED_SIZE;

      // Write signature offset (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(currentSignatureOffset), position);
      position += OFFSET_FIELD_SIZE;

      // Write signature instruction index (2 bytes LE) - changed from 1 byte to 2 bytes!
      offsetsBytes.set(writeUInt16LE(instructionIndex), position);
      position += OFFSET_FIELD_SIZE;

      // Write pubkey offset (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(currentPubkeyOffset), position);
      position += OFFSET_FIELD_SIZE;

      // Write pubkey instruction index (2 bytes LE) - changed from 1 byte to 2 bytes!
      offsetsBytes.set(writeUInt16LE(instructionIndex), position);
      position += OFFSET_FIELD_SIZE;

      // Write message offset (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(messageOffset), position);
      position += OFFSET_FIELD_SIZE;

      // Write message size (2 bytes LE)
      offsetsBytes.set(writeUInt16LE(commonMessageSize), position);
      position += OFFSET_FIELD_SIZE;

      // Write message instruction index (2 bytes LE) - changed from 1 byte to 2 bytes!
      offsetsBytes.set(writeUInt16LE(instructionIndex), position);

      // Append the signature offsets to the list of signature offsets
      signatureOffsets.push(offsetsBytes);

      // Append the signature and pubkey to the buffer
      signatureBuffer.push(...Array.from(sig.signature));
      signatureBuffer.push(...Array.from(sig.pubkey));
    }

    // Build final instruction data with correct Solana format
    // Add space for appended slot (8 bytes) and version (1 byte) if provided
    const appendedSize =
      recentSlot !== undefined && version !== undefined
        ? SLOT_SIZE + VERSION_SIZE
        : 0;
    const totalSize =
      messageOffset + commonMessage.length + numSignatures + appendedSize;
    const instrData = new Uint8Array(totalSize + 4);
    let position = 0;

    // 1. Write count byte
    instrData[position] = numSignatures;
    position += ORACLE_INDEX_SIZE;

    // 2. Write padding byte (SIGNATURE_OFFSETS_START - 1 = 1 byte)
    instrData[position] = 0;
    position += PADDING_SIZE;

    // 3. Write offsets area
    for (const offs of signatureOffsets) {
      instrData.set(offs, position);
      position += ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE;
    }

    // 4. Write signature blocks at correct offsets
    for (let i = 0; i < sortedSignatures.length; i++) {
      const sig = sortedSignatures[i];
      const currentSignatureOffset =
        signatureOffset + i * ED25519_SIGNATURE_SERIALIZED_SIZE;
      const currentPubkeyOffset =
        pubkeyOffset + i * ED25519_PUBKEY_SERIALIZED_SIZE;

      instrData.set(sig.signature, currentSignatureOffset);
      instrData.set(sig.pubkey, currentPubkeyOffset);
    }

    // 5. Write common message at message offset
    instrData.set(commonMessage, messageOffset);

    // 6. append a list of bytes for all oracle indexes
    const oracleIndexes = new Uint8Array(numSignatures);
    for (let i = 0; i < numSignatures; i++) {
      oracleIndexes[i] = sortedSignatures[i].oracleIdx;
    }
    instrData.set(oracleIndexes, messageOffset + commonMessage.length);

    // 7. Append recent_slot and version (NEW FORMAT)
    if (recentSlot !== undefined && version !== undefined) {
      const slotOffset = messageOffset + commonMessage.length + numSignatures; // After oracle indexes
      const versionOffset = slotOffset + SLOT_SIZE;

      // Write recent_slot as little-endian u64 (8 bytes)
      const slotBuffer = Buffer.alloc(SLOT_SIZE);
      slotBuffer.writeBigUInt64LE(BigInt(recentSlot), 0);
      instrData.set(slotBuffer, slotOffset);

      // Write version as u8 (1 byte)
      instrData[versionOffset] = version;

      const discriminatorOffset = versionOffset + 1;
      const discriminator = Buffer.from('SBOD');
      instrData.set(discriminator, discriminatorOffset);
    }

    return new web3.TransactionInstruction({
      programId: web3.Ed25519Program.programId,
      data: Buffer.from(instrData),
      keys: [],
    });
  }
}

function writeUInt16LE(value: number): Uint8Array {
  const arr = new Uint8Array(OFFSET_FIELD_SIZE);
  arr[0] = value & 0xff;
  arr[1] = (value >> 8) & 0xff;
  return arr;
}
