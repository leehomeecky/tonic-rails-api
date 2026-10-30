import { Injectable } from '@nestjs/common';
import { STATIC_USD_RATES } from '../global/constants';
import { FxSourceEnum } from '../global/enums';
import { IFxProvider, UsdRateQuote } from '../global/interfaces';

/** Fixed rate table: the last line of defence, and the deterministic provider for tests. */
@Injectable()
export class StaticFxUtil implements IFxProvider {
  readonly name = 'static';
  readonly source = FxSourceEnum.STATIC as const;

  fetchUsdRates(): Promise<UsdRateQuote> {
    return Promise.resolve({
      provider: this.name,
      source: this.source,
      usdRates: { ...STATIC_USD_RATES },
      providerTimestamp: null,
    });
  }
}
