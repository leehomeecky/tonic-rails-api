export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';
export const REQUEST_ID_HEADER = 'x-request-id';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Postgres lock wait before a concurrent same-key request is answered with 409. */
export const IDEMPOTENCY_LOCK_TIMEOUT = '5s';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export const TRANSACTION_REFERENCE_PREFIX = 'TR';
export const TRANSACTION_RETRY_ATTEMPTS = 3;

export const DEFAULT_PHONE_REGION = 'NG';
export const MAX_NOTE_LENGTH = 140;
export const REQUEST_BODY_LIMIT = '100kb';
