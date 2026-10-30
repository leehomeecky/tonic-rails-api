import { Currency } from './currency.entity';
import { Wallet } from './wallet.entity';
import { Balance } from './balance.entity';
import { FxRateSnapshot } from './fx-rate-snapshot.entity';
import { WalletTransaction } from './wallet-transaction.entity';
import { LedgerEntry } from './ledger-entry.entity';
import { IdempotencyKey } from './idempotency-key.entity';

export {
  Currency,
  Wallet,
  Balance,
  FxRateSnapshot,
  WalletTransaction,
  LedgerEntry,
  IdempotencyKey,
};

export const ENTITIES = [
  Currency,
  Wallet,
  Balance,
  FxRateSnapshot,
  WalletTransaction,
  LedgerEntry,
  IdempotencyKey,
];
