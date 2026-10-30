import { QueryFailedError } from 'typeorm';

export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
} as const;

export type PgErrorCode = (typeof PgErrorCode)[keyof typeof PgErrorCode];

interface PgDriverError {
  code?: string;
  constraint?: string;
}

function driverError(error: unknown): PgDriverError | undefined {
  if (!(error instanceof QueryFailedError)) return undefined;
  return error.driverError as PgDriverError;
}

export function isPgError(
  error: unknown,
  code: PgErrorCode,
  constraint?: string,
): boolean {
  const pg = driverError(error);
  if (!pg || pg.code !== code) return false;
  return constraint === undefined || pg.constraint === constraint;
}

export function pgErrorCode(error: unknown): string | undefined {
  return driverError(error)?.code;
}

export function pgConstraint(error: unknown): string | undefined {
  return driverError(error)?.constraint;
}

export function isRetryableTransactionError(error: unknown): boolean {
  return (
    isPgError(error, PgErrorCode.DEADLOCK_DETECTED) ||
    isPgError(error, PgErrorCode.SERIALIZATION_FAILURE)
  );
}
