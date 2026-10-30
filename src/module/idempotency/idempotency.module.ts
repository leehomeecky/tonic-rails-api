import { Module } from '@nestjs/common';
import { IdempotencyKeyRepository } from '../../shared/global/model/repositories';
import { IdempotencyService } from './idempotency.service';

@Module({
  providers: [IdempotencyService, IdempotencyKeyRepository],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
