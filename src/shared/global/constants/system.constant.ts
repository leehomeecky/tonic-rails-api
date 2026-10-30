import { SystemWalletCodeEnum } from '../enums';

/**
 * System wallets are seeded by migration with fixed ids so the ledger can
 * reference them without a lookup. Their balances may go negative.
 */
export const SYSTEM_WALLET_IDS: Readonly<Record<SystemWalletCodeEnum, string>> =
  {
    [SystemWalletCodeEnum.DEPOSIT_FUNDING]:
      '00000000-0000-4000-8000-000000000001',
    [SystemWalletCodeEnum.FX_POOL]: '00000000-0000-4000-8000-000000000002',
  };

export const SYSTEM_WALLET_ID_SET: ReadonlySet<string> = new Set(
  Object.values(SYSTEM_WALLET_IDS),
);

/** Seeded snapshot holding the static fallback rate table. */
export const STATIC_FX_SNAPSHOT_ID = '00000000-0000-4000-8000-0000000000f1';
