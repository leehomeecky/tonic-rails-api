import {
  CurrencyEnum,
  FxSourceEnum,
  IsoCurrencyEnum,
} from '../../shared/global/enums';
import { Money } from '../../shared/util/money.util';

/** Serialisable snapshot as held in memory and Redis. */
export interface CachedFxSnapshot {
  id: string;
  source: FxSourceEnum.LIVE | FxSourceEnum.STATIC;
  provider: string;
  usdRates: Record<IsoCurrencyEnum, string>;
  providerTimestamp: string | null;
  fetchedAt: string;
}

/** A snapshot ready for arithmetic, classified for the client at serve time. */
export interface FxSnapshot {
  id: string;
  provider: string;
  usdRates: Record<IsoCurrencyEnum, Money>;
  /** When we fetched the rates. */
  fetchedAt: Date;
  /** When the provider says it last updated them (null for the static table). */
  providerUpdatedAt: Date | null;
  rateSource: FxSourceEnum;
  isStale: boolean;
}

export interface FxRateView {
  from: CurrencyEnum;
  to: CurrencyEnum;
  rate: string;
  refreshedAt: string;
}

export interface FxRatesView {
  base: CurrencyEnum;
  source: FxSourceEnum;
  provider: string;
  refreshedAt: string;
  providerUpdatedAt: string | null;
  isStale: boolean;
  rates: FxRateView[];
}
