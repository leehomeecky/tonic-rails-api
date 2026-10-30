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
  .refine((body) => (body.email === undefined) !== (body.phone === undefined), {
    message: 'Provide exactly one of email or phone',
    path: ['email'],
  });

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
