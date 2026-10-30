import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CURRENCY_CODES } from '../../shared/global/constants';
import { ErrorCodeEnum, WalletTypeEnum } from '../../shared/global/enums';
import { DomainException } from '../../shared/global/errors';
import { Balance, Wallet } from '../../shared/global/model/entities';
import {
  BalanceRepository,
  WalletRepository,
} from '../../shared/global/model/repositories';
import { CreateWalletDto } from '../../shared/global/schemas';
import {
  normalizeEmail,
  normalizePhone,
} from '../../shared/util/identity.util';
import { ZERO, formatAmount } from '../../shared/util/money.util';
import { PgErrorCode, isPgError } from '../../shared/util/pg-error.util';
import { FxService } from '../fx/fx.service';
import { presentWallet } from './wallet.presenter';

@Injectable()
export class WalletService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly wallets: WalletRepository,
    private readonly balances: BalanceRepository,
    private readonly fx: FxService,
  ) {}

  /** Creates the wallet and a zero balance per supported coin in one transaction. */
  async createWallet(dto: CreateWalletDto) {
    const identity = this.normalizeIdentity(dto);
    try {
      const { wallet, balances } = await this.dataSource.transaction(
        async (manager) => {
          const wallet = await manager.getRepository(Wallet).save(
            manager.getRepository(Wallet).create({
              type: WalletTypeEnum.USER,
              email: identity.email,
              phone: identity.phone,
            }),
          );
          const balances = await manager.getRepository(Balance).save(
            CURRENCY_CODES.map((currency) =>
              manager.getRepository(Balance).create({
                walletId: wallet.id,
                currency,
                available: ZERO,
                allowNegative: false,
              }),
            ),
          );
          return { wallet, balances };
        },
      );
      return presentWallet(wallet, balances);
    } catch (error) {
      // The partial unique indexes are the source of truth, which also covers concurrent creates.
      if (isPgError(error, PgErrorCode.UNIQUE_VIOLATION)) {
        throw new DomainException(ErrorCodeEnum.WALLET_ALREADY_EXISTS);
      }
      throw error;
    }
  }

  async getWallet(walletId: string) {
    const wallet = await this.wallets.findUserWalletWithBalances(walletId);
    if (!wallet) throw new DomainException(ErrorCodeEnum.WALLET_NOT_FOUND);
    return presentWallet(wallet, wallet.balances ?? []);
  }

  /** Balances valued in USD with a single rate snapshot, so the total is internally consistent. */
  async getBalances(walletId: string) {
    const wallet = await this.wallets.findUserWallet({ walletId });
    if (!wallet) throw new DomainException(ErrorCodeEnum.WALLET_NOT_FOUND);

    const [balances, snapshot] = await Promise.all([
      this.balances.findByWallet(walletId),
      this.fx.getSnapshot(),
    ]);

    let totalUsd = ZERO;
    const valued = balances.map((balance) => {
      const usdValue = this.fx.toUsd(
        snapshot,
        balance.currency,
        balance.available,
      );
      totalUsd = totalUsd.plus(usdValue);
      return {
        currency: balance.currency,
        available: formatAmount(balance.available),
        usdValue: formatAmount(usdValue),
      };
    });

    return {
      walletId,
      balances: valued,
      totalUsd: formatAmount(totalUsd),
      rates: {
        source: snapshot.rateSource,
        refreshedAt: snapshot.fetchedAt.toISOString(),
        isStale: snapshot.isStale,
      },
    };
  }

  private normalizeIdentity(dto: CreateWalletDto): {
    email: string | null;
    phone: string | null;
  } {
    if (dto.email !== undefined) {
      return { email: normalizeEmail(dto.email), phone: null };
    }
    const phone = normalizePhone(dto.phone ?? '');
    if (!phone) throw new DomainException(ErrorCodeEnum.INVALID_PHONE);
    return { email: null, phone };
  }
}
