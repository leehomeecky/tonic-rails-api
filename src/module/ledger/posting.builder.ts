import { SYSTEM_WALLET_IDS } from '../../shared/global/constants';
import {
  CurrencyEnum,
  EntryDirectionEnum,
  SystemWalletCodeEnum,
} from '../../shared/global/enums';
import { Money } from '../../shared/util/money.util';

export interface Posting {
  walletId: string;
  currency: CurrencyEnum;
  direction: EntryDirectionEnum;
  amount: Money;
}

const { DEBIT, CREDIT } = EntryDirectionEnum;
const DEPOSIT_FUNDING = SYSTEM_WALLET_IDS[SystemWalletCodeEnum.DEPOSIT_FUNDING];
const FX_POOL = SYSTEM_WALLET_IDS[SystemWalletCodeEnum.FX_POOL];

/** Double-entry templates. Every template balances per currency by construction. */
export const PostingBuilder = {
  deposit(walletId: string, currency: CurrencyEnum, amount: Money): Posting[] {
    return [
      { walletId: DEPOSIT_FUNDING, currency, direction: DEBIT, amount },
      { walletId, currency, direction: CREDIT, amount },
    ];
  },

  /**
   * Moves value from (fromWallet, fromCurrency) to (toWallet, toCurrency).
   * Same currency: a direct pair of entries. Different currencies: the FX pool
   * takes the source leg and pays out the destination leg.
   */
  conversion(params: {
    fromWalletId: string;
    toWalletId: string;
    sourceCurrency: CurrencyEnum;
    sourceAmount: Money;
    destinationCurrency: CurrencyEnum;
    destinationAmount: Money;
  }): Posting[] {
    const {
      fromWalletId,
      toWalletId,
      sourceCurrency,
      sourceAmount,
      destinationCurrency,
      destinationAmount,
    } = params;

    if (sourceCurrency === destinationCurrency) {
      return [
        {
          walletId: fromWalletId,
          currency: sourceCurrency,
          direction: DEBIT,
          amount: sourceAmount,
        },
        {
          walletId: toWalletId,
          currency: destinationCurrency,
          direction: CREDIT,
          amount: sourceAmount,
        },
      ];
    }

    return [
      {
        walletId: fromWalletId,
        currency: sourceCurrency,
        direction: DEBIT,
        amount: sourceAmount,
      },
      {
        walletId: FX_POOL,
        currency: sourceCurrency,
        direction: CREDIT,
        amount: sourceAmount,
      },
      {
        walletId: FX_POOL,
        currency: destinationCurrency,
        direction: DEBIT,
        amount: destinationAmount,
      },
      {
        walletId: toWalletId,
        currency: destinationCurrency,
        direction: CREDIT,
        amount: destinationAmount,
      },
    ];
  },
};
