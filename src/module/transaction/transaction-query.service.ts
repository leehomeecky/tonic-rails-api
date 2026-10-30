import { Injectable } from '@nestjs/common';
import { ErrorCodeEnum } from '../../shared/global/enums';
import { DomainException } from '../../shared/global/errors';
import {
  TransactionRepository,
  WalletRepository,
} from '../../shared/global/model/repositories';
import { TransactionHistoryQueryDto } from '../../shared/global/schemas';
import { decodeCursor, encodeCursor } from '../../shared/util/cursor.util';
import { presentTransaction } from './transaction.presenter';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TransactionQueryService {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly wallets: WalletRepository,
  ) {}

  async list(walletId: string, query: TransactionHistoryQueryDto) {
    const wallet = await this.wallets.findUserWallet({ walletId });
    if (!wallet) throw new DomainException(ErrorCodeEnum.WALLET_NOT_FOUND);

    const rows = await this.transactions.findHistory({
      walletId,
      type: query.type,
      currency: query.currency,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      data: page.map((tx) =>
        presentTransaction(tx, { viewerWalletId: walletId }),
      ),
      meta: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      },
    };
  }

  /** Accepts the UUID or the human-readable reference (e.g. TR-20261029-7F3K9QAB). */
  async getOne(idOrReference: string) {
    const tx = await this.transactions.findByIdOrReference(
      idOrReference,
      UUID_PATTERN.test(idOrReference),
    );
    if (!tx) throw new DomainException(ErrorCodeEnum.TRANSACTION_NOT_FOUND);
    return presentTransaction(tx);
  }
}
