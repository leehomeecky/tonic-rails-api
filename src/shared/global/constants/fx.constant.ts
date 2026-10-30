import { IsoCurrencyEnum } from '../enums';

export const PRIMARY_FX_PROVIDER = 'PRIMARY_FX_PROVIDER';
export const FALLBACK_FX_PROVIDER = 'FALLBACK_FX_PROVIDER';

export const FX_CACHE_KEY = 'fx:snapshot:latest';
export const FX_REFRESH_LOCK_KEY = 'fx:refresh:lock';
export const FX_REFRESH_JOB_NAME = 'fx-refresh';

export const FX_PROVIDER_MAX_ATTEMPTS = 2;
export const FX_CIRCUIT_FAILURE_THRESHOLD = 3;
export const FX_CIRCUIT_OPEN_MS = 60_000;

/**
 * Static fallback table: units of each ISO currency per 1 USD.
 * Indicative mid-market values; XAF is derived from its fixed EUR peg (655.957).
 */
export const STATIC_USD_RATES: Readonly<Record<IsoCurrencyEnum, string>> = {
  [IsoCurrencyEnum.USD]: '1',
  [IsoCurrencyEnum.NGN]: '1500',
  [IsoCurrencyEnum.GHS]: '15',
  [IsoCurrencyEnum.EUR]: '0.92',
  [IsoCurrencyEnum.XAF]: '603.48044',
};
