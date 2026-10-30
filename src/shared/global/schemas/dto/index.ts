import { createZodDto } from 'nestjs-zod';
import { errorResponseSchema } from '../common.schema';
import {
  createWalletSchema,
  walletBalancesResponseSchema,
  walletResponseSchema,
} from '../wallet.schema';
import {
  depositSchema,
  swapSchema,
  transactionHistoryQuerySchema,
  transactionListResponseSchema,
  transactionResponseSchema,
  transferSchema,
} from '../transaction.schema';
import { fxRatesResponseSchema } from '../fx.schema';

// Request DTOs: validated by the global ZodValidationPipe.
export class CreateWalletDto extends createZodDto(createWalletSchema) {}
export class DepositDto extends createZodDto(depositSchema) {}
export class SwapDto extends createZodDto(swapSchema) {}
export class TransferDto extends createZodDto(transferSchema) {}
export class TransactionHistoryQueryDto extends createZodDto(
  transactionHistoryQuerySchema,
) {}

// Response DTOs: documentation only (OpenAPI).
export class WalletResponseDto extends createZodDto(walletResponseSchema) {}
export class WalletBalancesResponseDto extends createZodDto(
  walletBalancesResponseSchema,
) {}
export class TransactionResponseDto extends createZodDto(
  transactionResponseSchema,
) {}
export class TransactionListResponseDto extends createZodDto(
  transactionListResponseSchema,
) {}
export class FxRatesResponseDto extends createZodDto(fxRatesResponseSchema) {}
export class ErrorResponseDto extends createZodDto(errorResponseSchema) {}
