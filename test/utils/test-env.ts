import { DbConfig } from '../../src/shared/config/env/app-config';

/** Environment every e2e test runs with: deterministic FX, no Redis, no background jobs. */
export function testEnvironment(db: DbConfig): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DB_HOST: db.host,
    DB_PORT: String(db.port),
    DB_USER: db.user,
    DB_PASSWORD: db.password,
    DB_NAME: db.name,
    DB_SSL: 'false',
    DB_RUN_MIGRATIONS: 'false',
    DB_POOL_SIZE: '20',
    REDIS_ENABLED: 'false',
    FX_PROVIDER: 'static',
    FX_REFRESH_ENABLED: 'false',
    THROTTLE_LIMIT: '1000000',
  };
}
