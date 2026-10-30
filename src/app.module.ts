import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { LoggerModule } from 'nestjs-pino';
import { EnvModule } from './shared/config/env/env.module';
import { AppConfig } from './shared/config/env/app-config';
import { DbModule } from './shared/config/db/db.module';
import { AppCacheModule } from './shared/config/cache/cache.module';
import { REQUEST_ID_HEADER } from './shared/global/constants';
import { JsonContentTypeGuard } from './shared/global/guards/json-content-type.guard';
import { AllExceptionsFilter } from './shared/global/errors/filters/all-exceptions.filter';
import { WalletModule } from './module/wallet/wallet.module';
import { FxModule } from './module/fx/fx.module';
import { TransactionModule } from './module/transaction/transaction.module';
import { HealthModule } from './module/health/health.module';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: (req, res) => {
            const incoming = req.headers[REQUEST_ID_HEADER];
            const id =
              typeof incoming === 'string' && incoming.length <= 128
                ? incoming
                : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          // PII never reaches the logs.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              '*.email',
              '*.phone',
            ],
            censor: '[REDACTED]',
          },
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/health') ?? false,
          },
          transport: config.isDev
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        },
      }),
    }),
    DbModule,
    AppCacheModule,
    ScheduleModule.forRoot(),
    // In-memory per instance: Redis-backed throttling would make Redis an availability dependency.
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => [
        {
          ttl: config.throttle.ttlSeconds * 1000,
          limit: config.throttle.limit,
        },
      ],
    }),
    FxModule,
    WalletModule,
    TransactionModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JsonContentTypeGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
