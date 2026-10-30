import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../../shared/config/env/app-config';
import { IDEMPOTENCY_LOCK_TIMEOUT } from '../../shared/global/constants';
import {
  ErrorCodeEnum,
  IdempotencyStatusEnum,
  IdempotentOperationEnum,
} from '../../shared/global/enums';
import {
  DomainErrorPayload,
  DomainException,
} from '../../shared/global/errors';
import { IdempotencyKey } from '../../shared/global/model/entities';
import { IdempotencyKeyRepository } from '../../shared/global/model/repositories';
import { queryRows, withTransactionRetry } from '../../shared/util/db.util';
import { hashRequest } from '../../shared/util/hash.util';
import { PgErrorCode, isPgError } from '../../shared/util/pg-error.util';

export interface IdempotencyContext {
  scope: string;
  key: string;
  requestHash: string;
}

export interface WorkResult<T> {
  statusCode: number;
  body: T;
  transactionId: string | null;
}

export interface IdempotentResponse<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

/** Thrown inside the transaction when another request already owns the key. */
class ClaimLostError extends Error {}

/** Outcomes of these codes describe the key itself, not the request, so they are never stored. */
const NON_RECORDABLE = new Set<ErrorCodeEnum>([
  ErrorCodeEnum.IDEMPOTENCY_KEY_REUSED,
  ErrorCodeEnum.IDEMPOTENCY_KEY_EXPIRED,
  ErrorCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS,
]);

/**
 * Exactly-once execution for money-moving requests (Stripe-style keys).
 *
 * The key is claimed with INSERT ... ON CONFLICT DO NOTHING inside the same
 * transaction that moves the money, so the two commit or roll back together.
 * A concurrent request with the same key blocks on the unique index until the
 * first one finishes, then replays its stored response.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly keys: IdempotencyKeyRepository,
    private readonly config: AppConfig,
  ) {}

  context(
    walletId: string,
    operation: IdempotentOperationEnum,
    key: string,
    payload: unknown,
  ): IdempotencyContext {
    return {
      scope: `${walletId}:${operation}`,
      key,
      requestHash: hashRequest({ walletId, operation, payload }),
    };
  }

  /**
   * 1. A completed key is replayed before anything else runs.
   * 2. `prepare` runs outside any DB transaction (FX lookups, recipient resolution);
   *    its errors depend on changing state (rates) and are not recorded.
   * 3. `work` runs in the same transaction that claims the key.
   */
  async execute<T, P>(
    ctx: IdempotencyContext,
    prepare: () => Promise<P>,
    work: (manager: EntityManager, prepared: P) => Promise<WorkResult<T>>,
  ): Promise<IdempotentResponse<T>> {
    const existing = await this.find(ctx);
    if (existing) return this.replay<T>(existing, ctx);

    const prepared = await prepare();

    try {
      return await withTransactionRetry(this.dataSource, async (manager) => {
        await manager.query(
          `SET LOCAL lock_timeout = '${IDEMPOTENCY_LOCK_TIMEOUT}'`,
        );
        const claimed = await queryRows(
          manager,
          `INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at)
           VALUES ($1, $2, $3, 'IN_PROGRESS', now() + make_interval(hours => $4))
           ON CONFLICT (scope, key) DO NOTHING
           RETURNING scope`,
          [
            ctx.scope,
            ctx.key,
            ctx.requestHash,
            this.config.idempotencyKeyTtlHours,
          ],
        );
        if (claimed.length === 0) throw new ClaimLostError();

        const result = await work(manager, prepared);

        await queryRows(
          manager,
          `UPDATE idempotency_keys
              SET status = 'COMPLETED', response_status = $3, response_body = $4, transaction_id = $5
            WHERE scope = $1 AND key = $2`,
          [
            ctx.scope,
            ctx.key,
            result.statusCode,
            JSON.stringify(result.body),
            result.transactionId,
          ],
        );
        return {
          statusCode: result.statusCode,
          body: result.body,
          replayed: false,
        };
      });
    } catch (error) {
      if (error instanceof ClaimLostError) {
        const row = await this.find(ctx);
        if (!row) {
          throw new DomainException(
            ErrorCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS,
          );
        }
        return this.replay<T>(row, ctx);
      }
      if (isPgError(error, PgErrorCode.LOCK_NOT_AVAILABLE)) {
        throw new DomainException(
          ErrorCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS,
        );
      }
      // A transaction row already carries this key (e.g. the key row expired and was purged):
      // never execute twice.
      if (isPgError(error, PgErrorCode.UNIQUE_VIOLATION, 'uq_tx_idempotency')) {
        throw new DomainException(ErrorCodeEnum.IDEMPOTENCY_KEY_EXPIRED);
      }
      if (
        error instanceof DomainException &&
        error.getStatus() < 500 &&
        !NON_RECORDABLE.has(error.code)
      ) {
        await this.recordFailure(ctx, error);
      }
      throw error;
    }
  }

  /** Purges expired keys. Their transactions stay unique per key, so a purged key still cannot double-spend. */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const removed = await this.keys.deleteExpired();
    if (removed) this.logger.log(`Purged ${removed} expired idempotency keys`);
  }

  private find(ctx: IdempotencyContext): Promise<IdempotencyKey | null> {
    return this.keys.findOne({ where: { scope: ctx.scope, key: ctx.key } });
  }

  private replay<T>(
    row: IdempotencyKey,
    ctx: IdempotencyContext,
  ): IdempotentResponse<T> {
    if (row.requestHash !== ctx.requestHash) {
      throw new DomainException(ErrorCodeEnum.IDEMPOTENCY_KEY_REUSED);
    }
    if (
      row.status !== IdempotencyStatusEnum.COMPLETED ||
      row.responseStatus === null
    ) {
      throw new DomainException(ErrorCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS);
    }
    if (row.responseStatus >= 400) {
      throw DomainException.fromPayload(row.responseBody as DomainErrorPayload);
    }
    return {
      statusCode: row.responseStatus,
      body: row.responseBody as T,
      replayed: true,
    };
  }

  /**
   * Deterministic business failures (e.g. INSUFFICIENT_FUNDS) are stored so a
   * retry with the same key gets the same answer instead of a different outcome.
   */
  private async recordFailure(
    ctx: IdempotencyContext,
    error: DomainException,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO idempotency_keys
           (scope, key, request_hash, status, response_status, response_body, expires_at)
         VALUES ($1, $2, $3, 'COMPLETED', $4, $5, now() + make_interval(hours => $6))
         ON CONFLICT (scope, key) DO NOTHING`,
        [
          ctx.scope,
          ctx.key,
          ctx.requestHash,
          error.getStatus(),
          JSON.stringify(error.toPayload()),
          this.config.idempotencyKeyTtlHours,
        ],
      );
    } catch (recordError) {
      this.logger.error(
        `Failed to record idempotent failure for ${ctx.scope}`,
        recordError instanceof Error ? recordError.stack : String(recordError),
      );
    }
  }
}
