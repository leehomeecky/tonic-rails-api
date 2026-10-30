export enum WalletTypeEnum {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

export enum SystemWalletCodeEnum {
  /** Counter-account for simulated fiat on-ramp deposits. */
  DEPOSIT_FUNDING = 'DEPOSIT_FUNDING',
  /** Liquidity pool on the other side of every currency conversion. */
  FX_POOL = 'FX_POOL',
}
