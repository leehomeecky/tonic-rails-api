import { FxSourceEnum, IsoCurrencyEnum } from '../enums';

export interface UsdRateQuote {
  provider: string;
  source: FxSourceEnum.LIVE | FxSourceEnum.STATIC;
  /** Units of each ISO currency per 1 USD, as decimal strings. */
  usdRates: Record<IsoCurrencyEnum, string>;
  providerTimestamp: Date | null;
}

export interface IFxProvider {
  readonly name: string;
  readonly source: FxSourceEnum.LIVE | FxSourceEnum.STATIC;
  /** Throws FxProviderError on timeout, transport or validation failure. */
  fetchUsdRates(signal?: AbortSignal): Promise<UsdRateQuote>;
}

export class FxProviderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'FxProviderError';
  }
}
