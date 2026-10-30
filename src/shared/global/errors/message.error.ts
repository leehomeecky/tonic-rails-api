import { HttpStatus } from '@nestjs/common';
import { ErrorCodeEnum } from '../enums';
import { walletError } from './wallet.error';
import { transactionError } from './transaction.error';
import { idempotencyError } from './idempotency.error';

/** Default messages. Errors that carry specifics (amounts, currencies) override them at the throw site. */
export const ErrorMessage: Readonly<Record<ErrorCodeEnum, string>> = {
  ...walletError,
  ...transactionError,
  ...idempotencyError,
  VALIDATION_FAILED: 'Request validation failed',
  INVALID_JSON: 'Request body is not valid JSON',
  BAD_REQUEST: 'Bad request',
  INVALID_ID: 'Wallet id must be a valid UUID',
  ROUTE_NOT_FOUND: 'Route not found',
  CONFLICT: 'Request conflicts with the current state of the resource',
  PAYLOAD_TOO_LARGE: 'Request body is too large (limit 100kb)',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be application/json',
  RATE_LIMITED: 'Too many requests; slow down and retry shortly',
  INTERNAL_ERROR: 'Internal server error',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable; please retry',
};

export const ErrorStatus: Readonly<Record<ErrorCodeEnum, HttpStatus>> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  INVALID_JSON: HttpStatus.BAD_REQUEST,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  INVALID_ID: HttpStatus.BAD_REQUEST,
  INVALID_PHONE: HttpStatus.BAD_REQUEST,
  INVALID_CURSOR: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_KEY_REQUIRED: HttpStatus.BAD_REQUEST,
  IDEMPOTENCY_KEY_INVALID: HttpStatus.BAD_REQUEST,
  SELF_TRANSFER_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  SAME_CURRENCY_SWAP: HttpStatus.BAD_REQUEST,
  ROUTE_NOT_FOUND: HttpStatus.NOT_FOUND,
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  RECIPIENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  TRANSACTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  IDEMPOTENCY_REQUEST_IN_PROGRESS: HttpStatus.CONFLICT,
  CONFLICT: HttpStatus.CONFLICT,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  UNSUPPORTED_MEDIA_TYPE: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  IDEMPOTENCY_KEY_REUSED: HttpStatus.UNPROCESSABLE_ENTITY,
  IDEMPOTENCY_KEY_EXPIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  INSUFFICIENT_FUNDS: HttpStatus.UNPROCESSABLE_ENTITY,
  AMOUNT_TOO_SMALL: HttpStatus.UNPROCESSABLE_ENTITY,
  AMOUNT_LIMIT_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  LEDGER_INVARIANT_VIOLATION: HttpStatus.INTERNAL_SERVER_ERROR,
};
