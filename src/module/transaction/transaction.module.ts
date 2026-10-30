import { Module } from '@nestjs/common';
import {
  TransactionRepository,
  WalletRepository,
} from '../../shared/global/model/repositories';
import { FxModule } from '../fx/fx.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionQueryService } from './transaction-query.service';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { WalletTransactionController } from './wallet-transaction.controller';

@Module({
  imports: [FxModule, LedgerModule, IdempotencyModule],
  controllers: [WalletTransactionController, TransactionController],
  providers: [
    TransactionService,
    TransactionQueryService,
    TransactionRepository,
    WalletRepository,
  ],
})
export class TransactionModule {}
