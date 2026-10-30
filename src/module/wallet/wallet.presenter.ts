import { Balance, Wallet } from '../../shared/global/model/entities';
import { formatAmount } from '../../shared/util/money.util';

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
    balances: balances.map(presentBalance),
  };
}
