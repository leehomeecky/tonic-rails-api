export const transactionError = {
  TRANSACTION_NOT_FOUND: 'Transaction not found',
  RECIPIENT_NOT_FOUND: 'Recipient wallet not found',
  SELF_TRANSFER_NOT_ALLOWED:
    'A wallet cannot transfer to itself; use a swap instead',
  SAME_CURRENCY_SWAP: 'Swap currencies must be different',
  INSUFFICIENT_FUNDS: 'Insufficient balance',
  AMOUNT_TOO_SMALL: 'Amount is too small to convert at the current rate',
  AMOUNT_LIMIT_EXCEEDED: 'Amount exceeds the maximum allowed per transaction',
  INVALID_CURSOR: 'Pagination cursor is not valid',
  LEDGER_INVARIANT_VIOLATION: 'Ledger postings are not balanced',
};
