export const idempotencyError = {
  IDEMPOTENCY_KEY_REQUIRED:
    'Idempotency-Key header is required for deposits, swaps and transfers',
  IDEMPOTENCY_KEY_INVALID:
    'Idempotency-Key must be 8-128 characters of letters, digits, "-" or "_"',
  IDEMPOTENCY_KEY_REUSED:
    'This Idempotency-Key was already used with a different request body; use a new key for a new request',
  IDEMPOTENCY_KEY_EXPIRED:
    'This Idempotency-Key was already used and its stored result has expired; use a new key for a new request',
  IDEMPOTENCY_REQUEST_IN_PROGRESS:
    'A request with this Idempotency-Key is still being processed; retry shortly',
};
