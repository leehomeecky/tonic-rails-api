import { z } from 'zod';
import { FxSourceEnum } from '../enums';
import { currencySchema, envelope, isoDateSchema } from './common.schema';

export const fxRatesViewSchema = z.object({
  base: currencySchema,
  source: z.enum(FxSourceEnum),
  provider: z.string(),
  refreshedAt: isoDateSchema,
  isStale: z.boolean(),
  rates: z.array(
    z.object({
      from: currencySchema,
      to: currencySchema,
      rate: z.string().describe('Units of `to` per 1 unit of `from`'),
      refreshedAt: isoDateSchema,
    }),
  ),
});

export const fxRatesResponseSchema = envelope(fxRatesViewSchema);
