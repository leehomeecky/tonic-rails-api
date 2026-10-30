import { z } from 'zod';
import { CurrencyEnum, ErrorCodeEnum } from '../enums';
import { AMOUNT_PATTERN } from '../../util/money.util';

/** Amounts are decimal strings; JSON numbers are rejected because they are already inexact. */
export const amountSchema = z
  .string({ error: 'must be a decimal string, e.g. "1500.25"' })
  .trim()
  .regex(
    AMOUNT_PATTERN,
    'must be a positive decimal string with at most 6 decimal places',
  )
  .describe('Positive decimal string, at most 6 decimal places');

/** Trimmed and lower-cased before validation, so " Ama@Example.com " is accepted and stored canonically. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const phoneSchema = z.string().trim().min(5).max(32);

export const currencySchema = z
  .enum(CurrencyEnum)
  .describe('Supported stablecoin');

export const moneyOutSchema = z
  .string()
  .describe('Exact ledger value as a decimal string, trailing zeros trimmed');

export const isoDateSchema = z.string().describe('ISO-8601 UTC timestamp');

export function envelope<T extends z.ZodType>(data: T) {
  return z.object({ message: z.string(), data });
}

export const errorResponseSchema = z.object({
  statusCode: z.number().int(),
  code: z.enum(ErrorCodeEnum),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  path: z.string(),
  requestId: z.string().optional(),
  timestamp: isoDateSchema,
});
