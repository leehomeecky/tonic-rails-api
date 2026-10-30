import { z } from 'zod';
import { FxSourceEnum } from '../enums';
import {
  currencySchema,
  emailSchema,
  envelope,
  phoneSchema,
  isoDateSchema,
  moneyOutSchema,
} from './common.schema';

export const createWalletSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.email !== undefined && body.phone !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'provide either email or phone, not both',
      });
    } else if (body.email === undefined && body.phone === undefined) {
      ctx.addIssue({ code: 'custom', message: 'email or phone is required' });
    }
  })
  // A whole-body example, so Swagger's "Try it out" does not send both identifiers.
  .meta({ example: { email: 'ama@example.com' } });

export const balanceSchema = z.object({
  currency: currencySchema,
  available: moneyOutSchema,
});

export const walletViewSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: isoDateSchema,
  balances: z.array(balanceSchema),
});

export const walletBalancesViewSchema = z.object({
  walletId: z.uuid(),
  balances: z.array(balanceSchema.extend({ usdValue: moneyOutSchema })),
  totalUsd: moneyOutSchema,
  rates: z.object({
    source: z.enum(FxSourceEnum),
    refreshedAt: isoDateSchema,
    isStale: z.boolean(),
  }),
});

export const walletResponseSchema = envelope(walletViewSchema);
export const walletBalancesResponseSchema = envelope(walletBalancesViewSchema);
