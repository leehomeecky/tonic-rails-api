import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Balance } from '../entities';
import { AbstractRepository } from './abstract.repository';

@Injectable()
export class BalanceRepository extends AbstractRepository<Balance> {
  constructor(dataSource: DataSource) {
    super(Balance, dataSource);
  }

  findByWallet(walletId: string): Promise<Balance[]> {
    return this.find({ where: { walletId }, order: { currency: 'ASC' } });
  }
}
