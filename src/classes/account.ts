import { Program, web3 } from '@coral-xyz/anchor-31';

/**
 *  Base class for all Switchboard account types.
 */
export abstract class SbAccount<AccountData> {
  /**
   *  Returns the payer public key to use for this account's actions.
   *
   *  If a payer is provided, it will be used. Otherwise, the program provider's public key will be
   *  used. If no public key is set in the provider, the default public key will be returned.
   */
  private static getPayer(
    program: Program,
    payer?: web3.PublicKey
  ): web3.PublicKey {
    return payer ?? program.provider.publicKey ?? web3.PublicKey.default;
  }

  /**
   * The key of the account in the IDL.
   */
  protected abstract get accountKey(): string;

  constructor(
    readonly program: Program,
    readonly pubkey: web3.PublicKey
  ) {}

  /**
   * Get the payer PublicKey for the account.
   *
   * @param payer The payer to use.
   * @returns The payer.
   */
  protected getPayer(payer?: web3.PublicKey): web3.PublicKey {
    return SbAccount.getPayer(this.program, payer);
  }

  /**
   * Loads the account data from on chain.
   *
   * @returns A promise that resolves to the account data.
   * @throws if the account does not exist.
   */
  public async loadData(): Promise<AccountData> {
    return await this.program.account[this.accountKey].fetch(this.pubkey);
  }
}

/**
 *  Base class for all Switchboard account types that can be used to load multiple accounts.
 */
export abstract class SbMultipleLoadableAccount<
  AccountData,
> extends SbAccount<AccountData> {
  /**
   * Loads the account data from on chain for multiple accounts.
   *
   * @param program The program instance.
   * @param pubkeys The public keys of the accounts to load.
   * @returns A promise that resolves to an array of account data (or null if the account does not exist).
   */
  public static async loadMany<T>(
    this: new (
      program: Program,
      pubkey: web3.PublicKey
    ) => SbMultipleLoadableAccount<T>,
    program: Program,
    pubkeys: web3.PublicKey[]
  ): Promise<(T | null)[]> {
    const instance = new this(program, pubkeys[0]);
    return await program.account[instance.accountKey].fetchMultiple(pubkeys);
  }
}
