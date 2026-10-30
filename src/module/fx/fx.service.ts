import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../shared/config/env/app-config';
import { RedisService } from '../../shared/config/cache/redis.service';
import {
  CURRENCY_CODES,
  CURRENCY_TO_ISO,
  FALLBACK_FX_PROVIDER,
  FX_CACHE_KEY,
  FX_CIRCUIT_FAILURE_THRESHOLD,
  FX_CIRCUIT_OPEN_MS,
  FX_PROVIDER_MAX_ATTEMPTS,
  PRIMARY_FX_PROVIDER,
  STATIC_FX_SNAPSHOT_ID,
  USD_PEGGED_CURRENCY,
} from '../../shared/global/constants';
import {
  CurrencyEnum,
  FxSourceEnum,
  IsoCurrencyEnum,
} from '../../shared/global/enums';
import {
  FxProviderError,
  type IFxProvider,
  type UsdRateQuote,
} from '../../shared/global/interfaces';
import { FxRateSnapshot } from '../../shared/global/model/entities';
import { FxRateSnapshotRepository } from '../../shared/global/model/repositories';
import { CircuitBreaker } from '../../shared/util/circuit-breaker.util';
import {
  Money,
  ONE,
  convertViaUsd,
  crossRate,
  formatRate,
} from '../../shared/util/money.util';
import { CachedFxSnapshot, FxRatesView, FxSnapshot } from './fx.types';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolution chain for rates:
 *   1. in-process memo, then Redis (shared across replicas), both TTL-bound
 *   2. live provider (timeout, retry, circuit breaker), persisted as a snapshot
 *   3. last-known-good live snapshot from Postgres, if younger than FX_MAX_STALENESS
 *   4. the seeded static table
 * Concurrent misses share one in-flight resolution (single-flight).
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly breaker = new CircuitBreaker(
    FX_CIRCUIT_FAILURE_THRESHOLD,
    FX_CIRCUIT_OPEN_MS,
  );
  private memo: { snapshot: CachedFxSnapshot; expiresAt: number } | null = null;
  private inflight: Promise<CachedFxSnapshot> | null = null;

  constructor(
    @Inject(PRIMARY_FX_PROVIDER) private readonly primary: IFxProvider,
    @Inject(FALLBACK_FX_PROVIDER) private readonly fallback: IFxProvider,
    private readonly snapshots: FxRateSnapshotRepository,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  async getSnapshot(): Promise<FxSnapshot> {
    return this.present(await this.resolveCached());
  }

  /** Forces a live fetch (used by the refresh job). Throws when the provider fails. */
  async refresh(): Promise<FxSnapshot> {
    const snapshot = await this.fetchAndPersist();
    await this.cache(snapshot);
    return this.present(snapshot);
  }

  rate(snapshot: FxSnapshot, from: CurrencyEnum, to: CurrencyEnum): Money {
    if (from === to) return ONE;
    return crossRate(
      snapshot.usdRates[CURRENCY_TO_ISO[from]],
      snapshot.usdRates[CURRENCY_TO_ISO[to]],
    );
  }

  /** Converts with the snapshot's USD quotes; rounds down once, at the end. */
  convert(
    snapshot: FxSnapshot,
    from: CurrencyEnum,
    to: CurrencyEnum,
    amount: Money,
  ): Money {
    if (from === to) return amount;
    return convertViaUsd(
      amount,
      snapshot.usdRates[CURRENCY_TO_ISO[from]],
      snapshot.usdRates[CURRENCY_TO_ISO[to]],
    );
  }

  toUsd(snapshot: FxSnapshot, currency: CurrencyEnum, amount: Money): Money {
    return this.convert(snapshot, currency, USD_PEGGED_CURRENCY, amount);
  }

  ratesView(snapshot: FxSnapshot): FxRatesView {
    const refreshedAt = snapshot.fetchedAt.toISOString();
    const rates = CURRENCY_CODES.flatMap((from) =>
      CURRENCY_CODES.filter((to) => to !== from).map((to) => ({
        from,
        to,
        rate: formatRate(this.rate(snapshot, from, to)),
        refreshedAt,
      })),
    );
    return {
      base: USD_PEGGED_CURRENCY,
      source: snapshot.rateSource,
      provider: snapshot.provider,
      refreshedAt,
      isStale: snapshot.isStale,
      rates,
    };
  }

  private async resolveCached(): Promise<CachedFxSnapshot> {
    if (this.memo && this.memo.expiresAt > Date.now())
      return this.memo.snapshot;

    const shared = await this.redis.getJson<CachedFxSnapshot>(FX_CACHE_KEY);
    if (shared) {
      this.remember(shared);
      return shared;
    }

    this.inflight ??= this.resolveFresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async resolveFresh(): Promise<CachedFxSnapshot> {
    let snapshot: CachedFxSnapshot;
    try {
      snapshot = await this.fetchAndPersist();
    } catch (error) {
      this.logger.warn(
        `Live FX unavailable, falling back: ${error instanceof Error ? error.message : String(error)}`,
      );
      snapshot = (await this.lastKnownGood()) ?? (await this.staticSnapshot());
    }
    await this.cache(snapshot);
    return snapshot;
  }

  private async fetchAndPersist(): Promise<CachedFxSnapshot> {
    if (this.primary.source === FxSourceEnum.STATIC) {
      return this.staticSnapshot();
    }
    if (this.breaker.isOpen) {
      throw new FxProviderError(`Circuit open for ${this.primary.name}`);
    }

    const quote = await this.fetchWithRetry();
    const row = await this.snapshots.save(
      this.snapshots.create({
        source: FxSourceEnum.LIVE,
        provider: quote.provider,
        usdRates: quote.usdRates,
        providerTimestamp: quote.providerTimestamp,
      }),
    );
    return this.toCached(row);
  }

  private async fetchWithRetry(): Promise<UsdRateQuote> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= FX_PROVIDER_MAX_ATTEMPTS; attempt++) {
      try {
        const quote = await this.primary.fetchUsdRates();
        this.assertUsable(quote);
        this.breaker.recordSuccess();
        return quote;
      } catch (error) {
        lastError = error;
        if (attempt < FX_PROVIDER_MAX_ATTEMPTS) {
          await sleep(200 * attempt + Math.floor(Math.random() * 100));
        }
      }
    }
    this.breaker.recordFailure();
    throw lastError instanceof Error
      ? lastError
      : new FxProviderError('FX provider failed', lastError);
  }

  private assertUsable(quote: UsdRateQuote): void {
    for (const iso of Object.values(IsoCurrencyEnum)) {
      const raw = quote.usdRates[iso];
      let value: Money;
      try {
        value = new Money(raw);
      } catch {
        throw new FxProviderError(`Rate for ${iso} is not a number`);
      }
      if (!value.isFinite() || value.lte(0)) {
        throw new FxProviderError(`Rate for ${iso} must be positive`);
      }
    }
    if (!new Money(quote.usdRates[IsoCurrencyEnum.USD]).eq(1)) {
      throw new FxProviderError('Quote is not USD-based');
    }
  }

  private async lastKnownGood(): Promise<CachedFxSnapshot | null> {
    const since = new Date(
      Date.now() - this.config.fx.maxStalenessSeconds * 1000,
    );
    const row = await this.snapshots.findLatestLiveSince(since);
    return row ? this.toCached(row) : null;
  }

  private async staticSnapshot(): Promise<CachedFxSnapshot> {
    const existing = await this.snapshots.findOneBy({
      id: STATIC_FX_SNAPSHOT_ID,
    });
    if (existing) return this.toCached(existing);

    // Seeded by migration; recreate if someone deleted it so transactions keep a valid FK.
    const quote = await this.fallback.fetchUsdRates();
    const row = await this.snapshots.save(
      this.snapshots.create({
        id: STATIC_FX_SNAPSHOT_ID,
        source: FxSourceEnum.STATIC,
        provider: quote.provider,
        usdRates: quote.usdRates,
        providerTimestamp: null,
      }),
    );
    return this.toCached(row);
  }

  private async cache(snapshot: CachedFxSnapshot): Promise<void> {
    this.remember(snapshot);
    await this.redis.setJson(
      FX_CACHE_KEY,
      snapshot,
      this.config.fx.cacheTtlSeconds,
    );
  }

  private remember(snapshot: CachedFxSnapshot): void {
    this.memo = {
      snapshot,
      expiresAt: Date.now() + this.config.fx.cacheTtlSeconds * 1000,
    };
  }

  private toCached(row: FxRateSnapshot): CachedFxSnapshot {
    return {
      id: row.id,
      source:
        row.source === FxSourceEnum.STATIC
          ? FxSourceEnum.STATIC
          : FxSourceEnum.LIVE,
      provider: row.provider,
      usdRates: row.usdRates,
      providerTimestamp: row.providerTimestamp?.toISOString() ?? null,
      fetchedAt: row.fetchedAt.toISOString(),
    };
  }

  private present(cached: CachedFxSnapshot): FxSnapshot {
    const fetchedAt = new Date(cached.fetchedAt);
    const ageSeconds = (Date.now() - fetchedAt.getTime()) / 1000;
    const rateSource =
      cached.source === FxSourceEnum.STATIC
        ? FxSourceEnum.STATIC
        : ageSeconds <= this.config.fx.staleAfterSeconds
          ? FxSourceEnum.LIVE
          : FxSourceEnum.LAST_KNOWN_GOOD;

    const usdRates = {} as Record<IsoCurrencyEnum, Money>;
    for (const iso of Object.values(IsoCurrencyEnum)) {
      usdRates[iso] = new Money(cached.usdRates[iso]);
    }

    return {
      id: cached.id,
      provider: cached.provider,
      usdRates,
      fetchedAt,
      rateSource,
      isStale: rateSource !== FxSourceEnum.LIVE,
    };
  }
}
