import { Injectable } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';
import { IdempotencyKey } from '../entities';
import { AbstractRepository } from './abstract.repository';

@Injectable()
export class IdempotencyKeyRepository extends AbstractRepository<IdempotencyKey> {
  constructor(dataSource: DataSource) {
    super(IdempotencyKey, dataSource);
  }

  async deleteExpired(now: Date = new Date()): Promise<number> {
    const result = await this.delete({ expiresAt: LessThan(now) });
    return result.affected ?? 0;
  }
}
