import { Injectable } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { CurrencyEnum, TransactionTypeEnum } from '../../enums';
import { WalletTransaction } from '../entities';
import { AbstractRepository } from './abstract.repository';
import { KeysetCursor } from '../../../util/cursor.util';

export interface TransactionHistoryFilter {
  walletId: string;
  type?: TransactionTypeEnum;
  currency?: CurrencyEnum;
  from?: Date;
  to?: Date;
  cursor?: KeysetCursor;
  limit: number;
}

@Injectable()
export class TransactionRepository extends AbstractRepository<WalletTransaction> {
  constructor(dataSource: DataSource) {
    super(WalletTransaction, dataSource);
  }

  private withParties() {
    return this.createQueryBuilder('tx')
      .leftJoinAndSelect('tx.wallet', 'wallet')
      .leftJoinAndSelect('tx.counterpartyWallet', 'counterparty');
  }

  findByIdOrReference(idOrReference: string, isUuid: boolean) {
    return this.withParties()
      .where(isUuid ? 'tx.id = :value' : 'tx.reference = :value', {
        value: idOrReference,
      })
      .getOne();
  }

  /**
   * Newest first, keyset-paginated on (created_at, id). Includes transfers the
   * wallet received. Fetches limit + 1 rows so the caller can detect another page.
   */
  findHistory(filter: TransactionHistoryFilter): Promise<WalletTransaction[]> {
    const query = this.withParties()
      .where(
        new Brackets((qb) =>
          qb
            .where('tx.wallet_id = :walletId')
            .orWhere('tx.counterparty_wallet_id = :walletId'),
        ),
      )
      .setParameter('walletId', filter.walletId);

    if (filter.type) query.andWhere('tx.type = :type', { type: filter.type });
    if (filter.currency) {
      query.andWhere(
        '(tx.source_currency = :currency OR tx.destination_currency = :currency)',
        { currency: filter.currency },
      );
    }
    if (filter.from)
      query.andWhere('tx.created_at >= :from', { from: filter.from });
    if (filter.to) query.andWhere('tx.created_at <= :to', { to: filter.to });
    if (filter.cursor) {
      query.andWhere('(tx.created_at, tx.id) < (:cursorAt, :cursorId)', {
        cursorAt: filter.cursor.createdAt,
        cursorId: filter.cursor.id,
      });
    }

    // Both joins are many-to-one, so LIMIT on the joined rows is exact.
    return query
      .orderBy('tx.created_at', 'DESC')
      .addOrderBy('tx.id', 'DESC')
      .limit(filter.limit + 1)
      .getMany();
  }
}
