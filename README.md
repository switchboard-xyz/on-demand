<div align="center">

![Switchboard Logo](https://github.com/switchboard-xyz/switchboard/raw/main/website/static/img/icons/switchboard/avatar.png)

# Switchboard

</div>

# Switchboard On-Demand (typedoc: https://switchboard-docs.web.app)
See the full documentation at [Switchboard On-Demand Documentation](https://switchboard-labs.gitbook.io/switchboard-on-demand/)

Switchboard On-Demand is designed to support high-fidelity financial systems. It allows users to specify how data from both on-chain and off-chain sources is ingested and transformed.

Unlike many pull-based blockchain oracles that manage data consensus on their own Layer 1 (L1) and then propagate it to users—giving oracle operators an advantage—Switchboard Oracles operate inside confidential runtimes. This setup ensures that oracles cannot observe the data they are collecting or the operations they perform, giving the end user a 'first-look' advantage when data is propagated.

Switchboard On-Demand is ideal for blockchain-based financial applications and services, offering a solution that is cost-effective, trustless, and user-friendly.

## Key Features:
- **User-Created Oracles**: In Switchboard, users have the flexibility to build their own oracles according to their specific needs.
- **Confidential Runtimes**: Oracle operations are performed in a way that even the oracles themselves cannot observe, ensuring data integrity and user advantage.
- **High-Fidelity Financial Applications**: Designed with financial applications in mind, Switchboard ensures high accuracy and reliability for transactions and data handling.

## Browser Compatibility

This library is compatible with both **Node.js** and **browser** environments. However, some utility functions require Node.js file system access:

### Node.js-Only Functions
- `AnchorUtils.initKeypairFromFile()` - Use `web3.Keypair.fromSecretKey()` directly in browsers
- `AnchorUtils.initWalletFromFile()` - Use browser wallet adapters (e.g., Phantom, Solflare) instead
- `AnchorUtils.loadEnv()` - Use `loadProgramFromConnection()` with your own connection/wallet

### Browser Usage Example
```typescript
import * as sb from '@switchboard-xyz/on-demand';
import { Connection, clusterApiUrl } from '@solana/web3.js';

// Use browser wallet adapter instead of file-based keypair
const connection = new Connection(clusterApiUrl('mainnet-beta'));
const program = await sb.AnchorUtils.loadProgramFromConnection(
  connection,
  walletAdapter // From @solana/wallet-adapter-react or similar
);

// Rest of your code works identically in browser and Node.js
const [pullIx] = await feedAccount.fetchUpdateIx({ numSignatures: 3 });
```

## Getting Started
To start building your own on-demand oracle with Switchboard, you can refer to the oracle specification in our [documentation](https://protos.docs.switchboard.xyz/protos/OracleJob).

### Example Code Snippet:
```typescript
const [pullIx] = await feedAccount.fetchUpdateIx({ numSignatures: 3 });
const tx = await sb.asV0Tx({
    connection,
    ixs: [pullIx],
    signers: [payer],
    computeUnitPrice: 200_000,
    computeUnitLimitMultiple: 1.3,
});
await program.provider.connection.sendTransaction(tx, {
    // preflightCommitment is REQUIRED to be processed or disabled
    preflightCommitment: "processed",
});
```

## SwitchboardSurge - Real-time Price Streaming

The `SwitchboardSurge` class provides real-time price streaming capabilities through WebSocket connections to Switchboard gateways.

### Quick Start

```typescript
import { SwitchboardSurge } from '@switchboard-xyz/on-demand';

// Initialize and subscribe to price feeds
const surge = new SwitchboardSurge({
  apiKey: 'your-api-key',
  gatewayUrl: 'http://localhost:8082', // Your gateway URL
});

// Listen for price updates
surge.on('data', (update) => {
  console.log('Price update:', update.processed.values);
});

// Subscribe to feeds (validation happens automatically)
await surge.subscribe([
  { symbol: 'BTCUSDT', source: 'BINANCE' },
  { symbol: 'ETHUSDT', source: 'BINANCE' },
]);
```

### Event Handling

```typescript
surge.on('connected', () => {
  console.log('Connected to Switchboard Surge');
});

surge.on('data', (response) => {
  // response.processed: Ready for Solana transactions
  console.log('Feed values:', response.processed.values);
  console.log('Feed hashes:', response.processed.feedHashes);
});

surge.on('error', (error) => {
  console.error('Streaming error:', error.message);
});

surge.on('disconnected', (code, reason) => {
  console.log('Disconnected:', code, reason);
});
```

### Configuration

```typescript
const surge = new SwitchboardSurge({
  apiKey: 'your-api-key',
  gatewayUrl: 'http://localhost:8082',  // Your gateway URL
  autoReconnect: true,                  // Auto-reconnect on disconnect
  maxReconnectAttempts: 5,              // Max reconnection attempts
  reconnectDelay: 1000,                 // Delay between reconnects (ms)
});
```

## Oracle Quote Functionality

The `OracleQuote` class provides utilities for working with oracle quote accounts and verified oracle data.

### Deriving Oracle Quote Accounts

```typescript
import { OracleQuote } from '@switchboard-xyz/on-demand';

// Derive the canonical oracle quote account address from feed hashes
const feedHashes = [
  'your-feed-hash-1',
  'your-feed-hash-2'
];

const [oracleAccount, bump] = OracleQuote.getCanonicalPubkey(
  queueKey,   // Queue public key for canonical derivation (required)
  feedHashes  // Uses default program ID
);
console.log('Oracle Quote Account:', oracleAccount.toString());

// Or with a custom program ID:
const [customOracleAccount, customBump] = OracleQuote.getCanonicalPubkey(
  queueKey,
  feedHashes,
  customProgramId
);
```

The `OracleQuote.getCanonicalPubkey()` method:
- Takes a queue public key as the first parameter (required)
- Takes an array of feed hashes as the second parameter (32-byte hex strings or Buffers)
- Optionally takes a program ID as the third parameter
- Returns the program-derived address for the oracle quote account
- Uses the default quote program ID `orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz` if no program ID is provided
- Matches the Rust implementation for consistent address derivation (queue key + feed hashes as seeds)

### Feed Hash Format

Feed hashes must be provided as:
- **Hex strings**: 64-character hex strings (with or without '0x' prefix)
- **Buffers**: 32-byte Buffer objects

```typescript
// Valid formats
const feedHashes = [
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  Buffer.from('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'hex')
];
```

