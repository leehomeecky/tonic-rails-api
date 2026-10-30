import { z } from 'zod';
import {
  FxSourceEnum,
  TransactionDirectionEnum,
  TransactionStatusEnum,
  TransactionTypeEnum,
} from '../enums';
import {
  MAX_NOTE_LENGTH,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
} from '../constants';
import {
  amountSchema,
  currencySchema,
  emailSchema,
  envelope,
  phoneSchema,
  isoDateSchema,
  moneyOutSchema,
} from './common.schema';

export const depositSchema = z
  .object({ currency: currencySchema, amount: amountSchema })
  .strict();

export const swapSchema = z
  .object({
    fromCurrency: currencySchema,
    toCurrency: currencySchema,
    amount: amountSchema,
  })
  .strict();

export const recipientSchema = z
  .object({
    walletId: z.uuid().optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .strict()
  .refine(
    (r) =>
      [r.walletId, r.email, r.phone].filter((value) => value !== undefined)
        .length === 1,
    { message: 'Provide exactly one of walletId, email or phone' },
  );

export const transferSchema = z
  .object({
    recipient: recipientSchema,
    sourceCurrency: currencySchema,
    destinationCurrency: currencySchema.optional(),
    amount: amountSchema,
    note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
  })
  .strict();

export const transactionHistoryQuerySchema = z
  .object({
    type: z.enum(TransactionTypeEnum).optional(),
    currency: currencySchema.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_LIMIT)
      .default(DEFAULT_PAGE_LIMIT),
  })
  .strict();

const legSchema = z.object({
  currency: currencySchema,
  amount: moneyOutSchema,
});
const partySchema = z.object({
  walletId: z.uuid(),
  identifier: z.string().describe('Masked email or phone'),
});

export const transactionViewSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  type: z.enum(TransactionTypeEnum),
  status: z.enum(TransactionStatusEnum),
  direction: z
    .enum(TransactionDirectionEnum)
    .optional()
    .describe('Relative to the wallet whose history is listed'),
  walletId: z.uuid(),
  source: legSchema,
  destination: legSchema,
  fx: z
    .object({
      rate: z.string(),
      source: z.enum(FxSourceEnum),
      snapshotId: z.uuid(),
    })
    .nullable()
    .describe('Present when a currency conversion took place'),
  sender: partySchema.nullable(),
  receiver: partySchema.nullable(),
  note: z.string().nullable(),
  createdAt: isoDateSchema,
});

export const transactionResponseSchema = envelope(transactionViewSchema);
export const transactionListResponseSchema = envelope(
  z.array(transactionViewSchema),
).extend({
  meta: z.object({
    limit: z.number().int(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});
