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
  .strict()
  .meta({ example: { currency: 'cNGN', amount: '150000' } });

export const swapSchema = z
  .object({
    fromCurrency: currencySchema,
    toCurrency: currencySchema,
    amount: amountSchema,
  })
  .strict()
  .meta({
    example: { fromCurrency: 'cNGN', toCurrency: 'USDx', amount: '15300' },
  });

export const recipientSchema = z
  .object(
    {
      walletId: z.uuid({ error: 'must be a valid UUID' }).optional(),
      email: emailSchema.optional(),
      phone: phoneSchema.optional(),
    },
    {
      error: (issue) =>
        issue.input === undefined
          ? 'is required'
          : 'must be an object such as { "walletId": "…" }',
    },
  )
  .strict()
  .superRefine((r, ctx) => {
    const given = [r.walletId, r.email, r.phone].filter(
      (value) => value !== undefined,
    ).length;
    if (given !== 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          given === 0
            ? 'one of walletId, email or phone is required'
            : 'provide only one of walletId, email or phone',
      });
    }
  });

export const transferSchema = z
  .object({
    recipient: recipientSchema,
    sourceCurrency: currencySchema,
    destinationCurrency: currencySchema
      .optional()
      .describe('Defaults to sourceCurrency; converts when different'),
    amount: amountSchema,
    note: z
      .string()
      .trim()
      .max(MAX_NOTE_LENGTH, `must be at most ${MAX_NOTE_LENGTH} characters`)
      .optional(),
  })
  .strict()
  .meta({
    example: {
      recipient: { email: 'kofi@example.com' },
      sourceCurrency: 'cNGN',
      destinationCurrency: 'cGHS',
      amount: '50000',
      note: 'School fees',
    },
  });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date ("2026-10-29") or a date-time with offset. A date-only `to` covers
 * the whole day, so from=to=2026-10-29 returns that day's transactions.
 */
export function parseQueryDate(value: string, endOfDay: boolean): Date {
  if (DATE_ONLY.test(value)) {
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  return new Date(value);
}

const queryDateSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })], {
    error:
      'must be an ISO-8601 date (2026-10-29) or date-time (2026-10-29T10:00:00Z)',
  })
  .optional();

const PAGE_LIMIT_MESSAGE = `must be a whole number from 1 to ${MAX_PAGE_LIMIT}`;

export const transactionHistoryQuerySchema = z
  .object({
    type: z
      .enum(TransactionTypeEnum, {
        error: 'must be one of DEPOSIT, SWAP, TRANSFER',
      })
      .optional(),
    currency: currencySchema.optional(),
    from: queryDateSchema,
    to: queryDateSchema,
    cursor: z.string().max(512).optional(),
    limit: z.coerce
      .number({ error: PAGE_LIMIT_MESSAGE })
      .int(PAGE_LIMIT_MESSAGE)
      .min(1, PAGE_LIMIT_MESSAGE)
      .max(MAX_PAGE_LIMIT, PAGE_LIMIT_MESSAGE)
      .default(DEFAULT_PAGE_LIMIT),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (
      query.from &&
      query.to &&
      parseQueryDate(query.from, false) > parseQueryDate(query.to, true)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'must be on or before "to"',
      });
    }
  });

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
  rate: z
    .string()
    .describe(
      'Rate applied: destination units per 1 source unit ("1" when no conversion)',
    ),
  fx: z
    .object({
      rate: z.string(),
      source: z.enum(FxSourceEnum),
      snapshotId: z.uuid(),
    })
    .nullable()
    .describe(
      'Pricing provenance; present when a currency conversion took place',
    ),
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
