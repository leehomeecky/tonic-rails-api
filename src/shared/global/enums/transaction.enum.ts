export enum TransactionTypeEnum {
  DEPOSIT = 'DEPOSIT',
  SWAP = 'SWAP',
  TRANSFER = 'TRANSFER',
}

/** Every operation settles synchronously today; PENDING/FAILED are reserved for async rails. */
export enum TransactionStatusEnum {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** Direction of a transaction relative to the wallet viewing it. */
export enum TransactionDirectionEnum {
  IN = 'IN',
  OUT = 'OUT',
  SELF = 'SELF',
}

export enum EntryDirectionEnum {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}
