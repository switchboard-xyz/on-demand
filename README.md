<div align="center">

![Switchboard Logo](https://github.com/switchboard-xyz/switchboard/raw/main/website/static/img/icons/switchboard/avatar.png)

# Switchboard

</div>

# Switchboard On-Demand
See the full documentation at [Switchboard On-Demand Documentation](https://switchboard-labs.gitbook.io/switchboard-on-demand/)

Switchboard On-Demand is designed to support high-fidelity financial systems. It allows users to specify how data from both on-chain and off-chain sources is ingested and transformed.

Unlike many pull-based blockchain oracles that manage data consensus on their own Layer 1 (L1) and then propagate it to users—giving oracle operators an advantage—Switchboard Oracles operate inside confidential runtimes. This setup ensures that oracles cannot observe the data they are collecting or the operations they perform, giving the end user a 'first-look' advantage when data is propagated.

Switchboard On-Demand is ideal for blockchain-based financial applications and services, offering a solution that is cost-effective, trustless, and user-friendly.

## Key Features:
- **User-Created Oracles**: In Switchboard, users have the flexibility to build their own oracles according to their specific needs.
- **Confidential Runtimes**: Oracle operations are performed in a way that even the oracles themselves cannot observe, ensuring data integrity and user advantage.
- **High-Fidelity Financial Applications**: Designed with financial applications in mind, Switchboard ensures high accuracy and reliability for transactions and data handling.

## Getting Started
To start building your own on-demand oracle with Switchboard, you can refer to the oracle specification in our [documentation](https://docs.switchboard.xyz/api/protos/Task).

### Example Code Snippet:
```typescript
function buildBinanceComJob(pair: String): OracleJob {
  const tasks = [
    OracleJob.Task.create({
      httpTask: OracleJob.HttpTask.create({
        url: `https://www.binance.com/api/v3/ticker/price?symbol=${pair}`,
      }),
    }),
    OracleJob.Task.create({
      jsonParseTask: OracleJob.JsonParseTask.create({ path: "$.price" }),
    }),
  ];
  return OracleJob.create({ tasks });
}

// ...
const [ix] = await pullFeed.fetchUpdateIx(program, {
  feed: feedKp.publicKey,
  queue,
  jobs: [buildBinanceComJob("BTCUSDT")],
  numSignatures: 1,
  maxVariance: 1, // don't respond if sources give > 1% variance
  minResponses: 1, // minimum job responses to resolve
  numSignatures: 3,
});
const tx = await InstructionUtils.asV0Tx(program, [ix]);
tx.sign([payer]);
await program.provider.connection.sendTransaction(tx, {
// preflightCommitment is REQUIRED to be processed or disabled
preflightCommitment: "processed",
});

