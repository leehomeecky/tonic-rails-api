import { z } from 'zod';
import { CURRENCY_CODES, MONEY_SCALE } from '../constants';
import { CurrencyEnum, ErrorCodeEnum } from '../enums';
import { AMOUNT_PATTERN } from '../../util/money.util';

const MAX_INTEGER_DIGITS = 18;
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

function describeInput(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'an array';
  return `a ${typeof input}`;
}

/** "is required" when absent, otherwise `typeMessage`. */
function requiredOr(typeMessage: (input: unknown) => string) {
  return (issue: { input?: unknown }) =>
    issue.input === undefined ? 'is required' : typeMessage(issue.input);
}

/**
 * Amounts are decimal strings. A JSON number is rejected because it has
 * already passed through binary floating point before reaching the server.
 * Each failure gets its own message so the client knows exactly what to fix.
 */
export const amountSchema = z
  .string({
    error: requiredOr(
      (input) =>
        `must be a string such as "1500.25", not ${describeInput(input)}; send amounts as strings to avoid floating-point rounding`,
    ),
  })
  .trim()
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });

    if (!PLAIN_DECIMAL.test(value)) {
      return fail(
        `must be a plain decimal number such as "1500.25" (digits with an optional decimal point; no signs, commas, spaces or exponents), got "${value}"`,
      );
    }
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > MONEY_SCALE) {
      return fail(
        `must have at most ${MONEY_SCALE} decimal places, got ${fraction.length}`,
      );
    }
    if (whole.length > MAX_INTEGER_DIGITS) {
      return fail(
        `is too large: at most ${MAX_INTEGER_DIGITS} digits before the decimal point`,
      );
    }
    if (!AMOUNT_PATTERN.test(value)) return fail('must be greater than 0');
  })
  .describe(
    `Positive decimal string with at most ${MONEY_SCALE} decimal places, e.g. "1500.25"`,
  )
  .meta({ example: '1500.25' });

/** Trimmed and lower-cased before validation, so " Ama@Example.com " is accepted and stored canonically. */
export const emailSchema = z
  .string({
    error: requiredOr(
      (input) => `must be a string, not ${describeInput(input)}`,
    ),
  })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'must be a valid email address' }).max(254))
  .meta({ example: 'ama@example.com' });

export const phoneSchema = z
  .string({
    error: requiredOr(
      (input) => `must be a string, not ${describeInput(input)}`,
    ),
  })
  .trim()
  .min(5, 'is too short to be a phone number')
  .max(32, 'is too long to be a phone number')
  .describe('E.164 (+2348031234567) or Nigerian local format (0803 123 4567)')
  .meta({ example: '+2348031234567' });

export const currencySchema = z
  .enum(CurrencyEnum, {
    error: requiredOr(
      (input) =>
        `must be one of ${CURRENCY_CODES.join(', ')} (case-sensitive), got ${typeof input === 'string' ? `"${input}"` : describeInput(input)}`,
    ),
  })
  .describe('Supported stablecoin')
  .meta({ example: CurrencyEnum.cNGN });

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
