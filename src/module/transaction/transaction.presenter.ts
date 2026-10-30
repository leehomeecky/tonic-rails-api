import {
  TransactionDirectionEnum,
  TransactionTypeEnum,
} from '../../shared/global/enums';
import { Wallet, WalletTransaction } from '../../shared/global/model/entities';
import { maskEmail, maskPhone } from '../../shared/util/identity.util';
import { formatAmount, formatRate } from '../../shared/util/money.util';

export interface PresentOptions {
  /** Wallet whose history is being listed; drives `direction`. */
  viewerWalletId?: string;
  sender?: Wallet | null;
  receiver?: Wallet | null;
}

function party(wallet: Wallet | null | undefined) {
  if (!wallet) return null;
  const identifier = wallet.email
    ? maskEmail(wallet.email)
    : wallet.phone
      ? maskPhone(wallet.phone)
      : '***';
  return { walletId: wallet.id, identifier };
}

function directionFor(
  tx: WalletTransaction,
  viewerWalletId: string,
): TransactionDirectionEnum {
  switch (tx.type) {
    case TransactionTypeEnum.DEPOSIT:
      return TransactionDirectionEnum.IN;
    case TransactionTypeEnum.SWAP:
      return TransactionDirectionEnum.SELF;
    case TransactionTypeEnum.TRANSFER:
      return tx.walletId === viewerWalletId
        ? TransactionDirectionEnum.OUT
        : TransactionDirectionEnum.IN;
  }
}

export function presentTransaction(
  tx: WalletTransaction,
  options: PresentOptions = {},
) {
  const isTransfer = tx.type === TransactionTypeEnum.TRANSFER;
  const converted = tx.sourceCurrency !== tx.destinationCurrency;

  return {
    id: tx.id,
    reference: tx.reference,
    type: tx.type,
    status: tx.status,
    ...(options.viewerWalletId
      ? { direction: directionFor(tx, options.viewerWalletId) }
      : {}),
    walletId: tx.walletId,
    source: {
      currency: tx.sourceCurrency,
      amount: formatAmount(tx.sourceAmount),
    },
    destination: {
      currency: tx.destinationCurrency,
      amount: formatAmount(tx.destinationAmount),
    },
    // Always present: the rate applied (1 when no conversion took place).
    rate: formatRate(tx.fxRate),
    fx:
      converted && tx.fxSource && tx.fxSnapshotId
        ? {
            rate: formatRate(tx.fxRate),
            source: tx.fxSource,
            snapshotId: tx.fxSnapshotId,
          }
        : null,
    sender: isTransfer ? party(options.sender ?? tx.wallet) : null,
    receiver: isTransfer
      ? party(options.receiver ?? tx.counterpartyWallet)
      : null,
    note: tx.metadata?.note ?? null,
    createdAt: tx.createdAt.toISOString(),
  };
}

export type TransactionView = ReturnType<typeof presentTransaction>;
