import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../config/env/app-config';
import { FxSourceEnum, IsoCurrencyEnum } from '../global/enums';
import {
  FxProviderError,
  IFxProvider,
  UsdRateQuote,
} from '../global/interfaces';

const responseSchema = z.object({
  result: z.literal('success'),
  base_code: z.literal('USD'),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number().positive()),
});

/**
 * Live USD-based rates from open.er-api.com (free, no API key).
 * The provider returns JSON numbers; each is converted to a string straight
 * away and never used in arithmetic as a float.
 */
@Injectable()
export class OpenErApiFxUtil implements IFxProvider {
  readonly name = 'open.er-api.com';
  readonly source = FxSourceEnum.LIVE as const;

  constructor(private readonly config: AppConfig) {}

  async fetchUsdRates(signal?: AbortSignal): Promise<UsdRateQuote> {
    const { url, timeoutMs } = this.config.fx;
    const timeout = AbortSignal.timeout(timeoutMs);

    let body: unknown;
    try {
      const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new FxProviderError(`HTTP ${response.status} from ${this.name}`);
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof FxProviderError) throw error;
      throw new FxProviderError(`Request to ${this.name} failed`, error);
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new FxProviderError(
        `Unexpected payload from ${this.name}`,
        parsed.error,
      );
    }

    const usdRates = {} as Record<IsoCurrencyEnum, string>;
    for (const iso of Object.values(IsoCurrencyEnum)) {
      const rate = parsed.data.rates[iso];
      if (rate === undefined) {
        throw new FxProviderError(`${this.name} did not quote ${iso}`);
      }
      usdRates[iso] = String(rate);
    }

    return {
      provider: this.name,
      source: this.source,
      usdRates,
      providerTimestamp: new Date(parsed.data.time_last_update_unix * 1000),
    };
  }
}
