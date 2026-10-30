import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { AppConfig } from '../../shared/config/env/app-config';
import {
  CurrencyEnum,
  ErrorCodeEnum,
  FxSourceEnum,
  IdempotentOperationEnum,
  SuccessMessageEnum,
  TransactionStatusEnum,
  TransactionTypeEnum,
} from '../../shared/global/enums';
import { DomainException } from '../../shared/global/errors';
import { Wallet, WalletTransaction } from '../../shared/global/model/entities';
import {
  WalletIdentifier,
  WalletRepository,
} from '../../shared/global/model/repositories';
import { DepositDto, SwapDto, TransferDto } from '../../shared/global/schemas';
import {
  normalizeEmail,
  normalizePhone,
} from '../../shared/util/identity.util';
import {
  Money,
  ONE,
  formatAmount,
  parseAmount,
} from '../../shared/util/money.util';
import { generateReference } from '../../shared/util/reference.util';
import { FxService } from '../fx/fx.service';
import { FxSnapshot } from '../fx/fx.types';
import {
  IdempotencyService,
  IdempotentResponse,
} from '../idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { PostingBuilder } from '../ledger/posting.builder';
import { TransactionView, presentTransaction } from './transaction.presenter';

export interface TransactionEnvelope {
  message: SuccessMessageEnum;
  data: TransactionView;
}

type Result = IdempotentResponse<TransactionEnvelope>;

interface Quote {
  rate: Money;
  destinationAmount: Money;
  snapshot: FxSnapshot;
}

/**
 * Money-moving use cases. Each one is a single idempotent DB transaction:
 * claim key → insert transaction row → post balanced ledger entries → store response.
 */
@Injectable()
export class TransactionService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly wallets: WalletRepository,
    private readonly config: AppConfig,
  ) {}

  deposit(walletId: string, dto: DepositDto, key: string): Promise<Result> {
    const amount = parseAmount(dto.amount);
    const ctx = this.idempotency.context(
      walletId,
      IdempotentOperationEnum.DEPOSIT,
      key,
      dto,
    );

    return this.idempotency.execute(
      ctx,
      async () => {
        await this.requireWallet(walletId);
        const snapshot = await this.fx.getSnapshot();
        this.assertWithinLimit(snapshot, dto.currency, amount);
      },
      async (manager) => {
        const tx = await this.insertTransaction(manager, {
          type: TransactionTypeEnum.DEPOSIT,
          walletId,
          counterpartyWalletId: null,
          sourceCurrency: dto.currency,
          sourceAmount: amount,
          destinationCurrency: dto.currency,
          destinationAmount: amount,
          fxRate: ONE,
          fxSnapshotId: null,
          fxSource: null,
          idempotencyKey: key,
          metadata: {},
        });
        await this.ledger.post(
          manager,
          tx.id,
          PostingBuilder.deposit(walletId, dto.currency, amount),
        );
        return this.created(SuccessMessageEnum.DEPOSIT_COMPLETED, tx);
      },
    );
  }

  swap(walletId: string, dto: SwapDto, key: string): Promise<Result> {
    if (dto.fromCurrency === dto.toCurrency) {
      throw new DomainException(ErrorCodeEnum.SAME_CURRENCY_SWAP);
    }
    const amount = parseAmount(dto.amount);
    const ctx = this.idempotency.context(
      walletId,
      IdempotentOperationEnum.SWAP,
      key,
      dto,
    );

    return this.idempotency.execute(
      ctx,
      async () => {
        await this.requireWallet(walletId);
        return this.quote(dto.fromCurrency, dto.toCurrency, amount);
      },
      async (manager, quote) => {
        const tx = await this.insertTransaction(manager, {
          type: TransactionTypeEnum.SWAP,
          walletId,
          counterpartyWalletId: null,
          sourceCurrency: dto.fromCurrency,
          sourceAmount: amount,
          destinationCurrency: dto.toCurrency,
          destinationAmount: quote.destinationAmount,
          fxRate: quote.rate,
          fxSnapshotId: quote.snapshot.id,
          fxSource: quote.snapshot.rateSource,
          idempotencyKey: key,
          metadata: {},
        });
        await this.ledger.post(
          manager,
          tx.id,
          PostingBuilder.conversion({
            fromWalletId: walletId,
            toWalletId: walletId,
            sourceCurrency: dto.fromCurrency,
            sourceAmount: amount,
            destinationCurrency: dto.toCurrency,
            destinationAmount: quote.destinationAmount,
          }),
        );
        return this.created(SuccessMessageEnum.SWAP_COMPLETED, tx);
      },
    );
  }

  transfer(walletId: string, dto: TransferDto, key: string): Promise<Result> {
    const amount = parseAmount(dto.amount);
    const destinationCurrency = dto.destinationCurrency ?? dto.sourceCurrency;
    const ctx = this.idempotency.context(
      walletId,
      IdempotentOperationEnum.TRANSFER,
      key,
      dto,
    );

    return this.idempotency.execute(
      ctx,
      async () => {
        const sender = await this.requireWallet(walletId);
        const receiver = await this.resolveRecipient(dto.recipient);
        if (receiver.id === sender.id) {
          throw new DomainException(ErrorCodeEnum.SELF_TRANSFER_NOT_ALLOWED);
        }
        const quote = await this.quote(
          dto.sourceCurrency,
          destinationCurrency,
          amount,
        );
        return { sender, receiver, quote };
      },
      async (manager, { sender, receiver, quote }) => {
        const converted = dto.sourceCurrency !== destinationCurrency;
        const tx = await this.insertTransaction(manager, {
          type: TransactionTypeEnum.TRANSFER,
          walletId,
          counterpartyWalletId: receiver.id,
          sourceCurrency: dto.sourceCurrency,
          sourceAmount: amount,
          destinationCurrency,
          destinationAmount: quote.destinationAmount,
          fxRate: quote.rate,
          fxSnapshotId: converted ? quote.snapshot.id : null,
          fxSource: converted ? quote.snapshot.rateSource : null,
          idempotencyKey: key,
          metadata: dto.note ? { note: dto.note } : {},
        });
        await this.ledger.post(
          manager,
          tx.id,
          PostingBuilder.conversion({
            fromWalletId: walletId,
            toWalletId: receiver.id,
            sourceCurrency: dto.sourceCurrency,
            sourceAmount: amount,
            destinationCurrency,
            destinationAmount: quote.destinationAmount,
          }),
        );
        return this.created(SuccessMessageEnum.TRANSFER_COMPLETED, tx, {
          sender,
          receiver,
        });
      },
    );
  }

  /** One snapshot per operation, so the limit check, rate and amount can never disagree. */
  private async quote(
    from: CurrencyEnum,
    to: CurrencyEnum,
    amount: Money,
  ): Promise<Quote> {
    const snapshot = await this.fx.getSnapshot();
    this.assertWithinLimit(snapshot, from, amount);

    const rate = this.fx.rate(snapshot, from, to);
    const destinationAmount = this.fx.convert(snapshot, from, to, amount);
    if (destinationAmount.isZero()) {
      throw new DomainException(ErrorCodeEnum.AMOUNT_TOO_SMALL, {
        currency: to,
        rate: rate.toFixed(),
      });
    }
    return { rate, destinationAmount, snapshot };
  }

  private assertWithinLimit(
    snapshot: FxSnapshot,
    currency: CurrencyEnum,
    amount: Money,
  ): void {
    const max = new Money(this.config.maxTransactionAmountUsd);
    const usd = this.fx.toUsd(snapshot, currency, amount);
    if (usd.gt(max)) {
      throw new DomainException(ErrorCodeEnum.AMOUNT_LIMIT_EXCEEDED, {
        maxUsd: formatAmount(max),
        amountUsd: formatAmount(usd),
      });
    }
  }

  private async requireWallet(walletId: string): Promise<Wallet> {
    const wallet = await this.wallets.findUserWallet({ walletId });
    if (!wallet) throw new DomainException(ErrorCodeEnum.WALLET_NOT_FOUND);
    return wallet;
  }

  private async resolveRecipient(
    recipient: TransferDto['recipient'],
  ): Promise<Wallet> {
    let identifier: WalletIdentifier;
    if (recipient.walletId !== undefined) {
      identifier = { walletId: recipient.walletId };
    } else if (recipient.email !== undefined) {
      identifier = { email: normalizeEmail(recipient.email) };
    } else {
      const phone = normalizePhone(recipient.phone ?? '');
      if (!phone) throw new DomainException(ErrorCodeEnum.INVALID_PHONE);
      identifier = { phone };
    }
    const wallet = await this.wallets.findUserWallet(identifier);
    if (!wallet) throw new DomainException(ErrorCodeEnum.RECIPIENT_NOT_FOUND);
    return wallet;
  }

  private async insertTransaction(
    manager: EntityManager,
    fields: Omit<
      WalletTransaction,
      | 'id'
      | 'reference'
      | 'status'
      | 'createdAt'
      | 'wallet'
      | 'counterpartyWallet'
    > & { fxSource: FxSourceEnum | null },
  ): Promise<WalletTransaction> {
    const tx = manager.getRepository(WalletTransaction).create({
      ...fields,
      id: randomUUID(),
      reference: generateReference(),
      status: TransactionStatusEnum.COMPLETED,
    });
    // updateEntity(false): TypeORM would otherwise copy RETURNING values onto the
    // entity untransformed (e.g. fx_rate as a raw string). Only created_at is needed,
    // and it comes from the DB clock so history ordering has one time source.
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(WalletTransaction)
      .values(tx)
      .updateEntity(false)
      .returning('created_at')
      .execute();
    const [row] = result.raw as Array<{ created_at: Date }>;
    tx.createdAt = row.created_at;
    return tx;
  }

  private created(
    message: SuccessMessageEnum,
    tx: WalletTransaction,
    parties: { sender?: Wallet; receiver?: Wallet } = {},
  ) {
    return {
      statusCode: HttpStatus.CREATED,
      body: { message, data: presentTransaction(tx, parties) },
      transactionId: tx.id,
    };
  }
}
