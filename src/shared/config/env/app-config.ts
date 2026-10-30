import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FxProviderNameEnum } from '../../global/enums';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
  ssl: boolean;
  runMigrations: boolean;
  poolSize: number;
  logging: boolean;
}

export interface RedisConfig {
  enabled: boolean;
  host: string;
  port: number;
  password?: string;
}

export interface FxConfig {
  provider: FxProviderNameEnum;
  url: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
  refreshEnabled: boolean;
  refreshIntervalSeconds: number;
  staleAfterSeconds: number;
  maxStalenessSeconds: number;
}

/** Typed, injectable view over the Joi-validated environment. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  private get<T>(key: string): T {
    return this.config.getOrThrow<T>(key);
  }

  get nodeEnv(): string {
    return this.get('NODE_ENV');
  }

  get isDev(): boolean {
    return this.nodeEnv === 'dev';
  }

  get port(): number {
    return this.get('PORT');
  }

  get allowedOrigins(): string[] {
    return this.get<string>('ALLOWED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get logLevel(): string {
    return this.get('LOG_LEVEL');
  }

  get db(): DbConfig {
    return {
      host: this.get('DB_HOST'),
      port: this.get('DB_PORT'),
      user: this.get('DB_USER'),
      password: this.get('DB_PASSWORD'),
      name: this.get('DB_NAME'),
      ssl: this.get('DB_SSL'),
      runMigrations: this.get('DB_RUN_MIGRATIONS'),
      poolSize: this.get('DB_POOL_SIZE'),
      logging: this.get('DB_LOGGING'),
    };
  }

  get redis(): RedisConfig {
    return {
      enabled: this.get('REDIS_ENABLED'),
      host: this.get('REDIS_HOST'),
      port: this.get('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    };
  }

  get fx(): FxConfig {
    return {
      provider: this.get('FX_PROVIDER'),
      url: this.get('FX_PROVIDER_URL'),
      timeoutMs: this.get('FX_PROVIDER_TIMEOUT_MS'),
      cacheTtlSeconds: this.get('FX_CACHE_TTL_SECONDS'),
      refreshEnabled: this.get('FX_REFRESH_ENABLED'),
      refreshIntervalSeconds: this.get('FX_REFRESH_INTERVAL_SECONDS'),
      staleAfterSeconds: this.get('FX_STALE_AFTER_SECONDS'),
      maxStalenessSeconds: this.get('FX_MAX_STALENESS_SECONDS'),
    };
  }

  /** Decimal string; parsed with Money where used. */
  get maxTransactionAmountUsd(): string {
    return this.get('MAX_TRANSACTION_AMOUNT_USD');
  }

  get idempotencyKeyTtlHours(): number {
    return this.get('IDEMPOTENCY_KEY_TTL_HOURS');
  }

  get throttle(): { limit: number; ttlSeconds: number } {
    return {
      limit: this.get('THROTTLE_LIMIT'),
      ttlSeconds: this.get('THROTTLE_TTL_SECONDS'),
    };
  }
}
