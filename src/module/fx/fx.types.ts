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
  fetchedAt: Date;
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
  isStale: boolean;
  rates: FxRateView[];
}
