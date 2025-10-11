// Browser shim for @coral-xyz/anchor nodewallet
// This module should never be called in browser environments
export default class NodeWallet {
  constructor() {
    throw new Error(
      'NodeWallet is not available in browser environments. ' +
        'Use wallet adapters like @solana/wallet-adapter-react instead.'
    );
  }
}
