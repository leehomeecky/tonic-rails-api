import { CURRENCY_CODES } from '../../shared/global/constants';
import { Balance, Wallet } from '../../shared/global/model/entities';
import { formatAmount } from '../../shared/util/money.util';

/** Every endpoint lists coins in the same canonical order, not the DB collation order. */
export function sortBalances<T extends Pick<Balance, 'currency'>>(
  balances: T[],
): T[] {
  return [...balances].sort(
    (a, b) =>
      CURRENCY_CODES.indexOf(a.currency) - CURRENCY_CODES.indexOf(b.currency),
  );
}

export function presentBalance(balance: Balance) {
  return {
    currency: balance.currency,
    available: formatAmount(balance.available),
  };
}

export function presentWallet(wallet: Wallet, balances: Balance[]) {
  return {
    id: wallet.id,
    email: wallet.email,
    phone: wallet.phone,
    createdAt: wallet.createdAt.toISOString(),
    balances: sortBalances(balances).map(presentBalance),
  };
}
