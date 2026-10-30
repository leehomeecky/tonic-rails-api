import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { WalletTypeEnum } from '../../enums';
import { Wallet } from '../entities';
import { AbstractRepository } from './abstract.repository';

export type WalletIdentifier =
  { walletId: string } | { email: string } | { phone: string };

@Injectable()
export class WalletRepository extends AbstractRepository<Wallet> {
  constructor(dataSource: DataSource) {
    super(Wallet, dataSource);
  }

  /** System wallets are internal ledger accounts and never visible through the API. */
  findUserWallet(
    identifier: WalletIdentifier,
    manager?: EntityManager,
  ): Promise<Wallet | null> {
    const repo = manager ? this.withManager(manager) : this;
    const where =
      'walletId' in identifier
        ? { id: identifier.walletId }
        : 'email' in identifier
          ? { email: identifier.email }
          : { phone: identifier.phone };
    return repo.findOne({ where: { ...where, type: WalletTypeEnum.USER } });
  }

  findUserWalletWithBalances(walletId: string): Promise<Wallet | null> {
    return this.createQueryBuilder('wallet')
      .leftJoinAndSelect('wallet.balances', 'balance')
      .where('wallet.id = :walletId', { walletId })
      .andWhere('wallet.type = :type', { type: WalletTypeEnum.USER })
      .orderBy('balance.currency', 'ASC')
      .getOne();
  }
}
