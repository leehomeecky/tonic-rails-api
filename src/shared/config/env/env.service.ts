import { Injectable } from '@nestjs/common';
import * as Joi from 'joi';
import { FxProviderNameEnum } from '../../global/enums';

@Injectable()
export class EnvService {
  public static validationSchema(): Joi.ObjectSchema {
    return Joi.object({
      //============ | app env var | ==============
      NODE_ENV: Joi.string()
        .valid('dev', 'test', 'stage', 'prod')
        .default('dev'),
      PORT: Joi.number().port().default(9000),
      ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
      LOG_LEVEL: Joi.string()
        .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
        .default('info'),

      //============ | db env var | ==============
      DB_HOST: Joi.string().required(),
      DB_PORT: Joi.number().port().default(5432),
      DB_USER: Joi.string().required(),
      DB_PASSWORD: Joi.string().required(),
      DB_NAME: Joi.string().required(),
      DB_SSL: Joi.boolean().default(false),
      DB_RUN_MIGRATIONS: Joi.boolean().default(true),
      DB_POOL_SIZE: Joi.number().integer().min(1).default(10),
      DB_LOGGING: Joi.boolean().default(false),

      //============ | redis env var | ==============
      REDIS_ENABLED: Joi.boolean().default(true),
      REDIS_HOST: Joi.string().default('127.0.0.1'),
      REDIS_PORT: Joi.number().port().default(6379),
      REDIS_PASSWORD: Joi.string().allow('').optional(),

      //============ | fx env var | ==============
      FX_PROVIDER: Joi.string()
        .valid(...Object.values(FxProviderNameEnum))
        .default(FxProviderNameEnum.openErApi),
      FX_PROVIDER_URL: Joi.string()
        .uri()
        .default('https://open.er-api.com/v6/latest/USD'),
      FX_PROVIDER_TIMEOUT_MS: Joi.number().integer().min(100).default(3000),
      FX_CACHE_TTL_SECONDS: Joi.number().integer().min(1).default(60),
      FX_REFRESH_ENABLED: Joi.boolean().default(true),
      FX_REFRESH_INTERVAL_SECONDS: Joi.number().integer().min(10).default(300),
      FX_STALE_AFTER_SECONDS: Joi.number().integer().min(1).default(900),
      FX_MAX_STALENESS_SECONDS: Joi.number().integer().min(1).default(86400),

      //============ | limits env var | ==============
      MAX_TRANSACTION_AMOUNT_USD: Joi.string()
        .pattern(/^\d+(\.\d+)?$/)
        .default('1000000'),
      IDEMPOTENCY_KEY_TTL_HOURS: Joi.number().integer().min(1).default(24),
      THROTTLE_LIMIT: Joi.number().integer().min(1).default(120),
      THROTTLE_TTL_SECONDS: Joi.number().integer().min(1).default(60),
    });
  }
}
