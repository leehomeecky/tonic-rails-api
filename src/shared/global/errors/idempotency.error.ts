export const idempotencyError = {
  IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key header is required',
  IDEMPOTENCY_KEY_INVALID:
    'Idempotency-Key must be 8-128 characters of letters, digits, "-" or "_"',
  IDEMPOTENCY_KEY_REUSED:
    'Idempotency-Key was already used with a different request',
  IDEMPOTENCY_REQUEST_IN_PROGRESS:
    'A request with this Idempotency-Key is still being processed',
};
