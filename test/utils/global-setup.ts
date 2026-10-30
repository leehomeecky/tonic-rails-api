import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { DbService } from '../../src/shared/config/db/db.service';
import { DbConfig } from '../../src/shared/config/env/app-config';
import { testEnvironment } from './test-env';

declare global {
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Starts a throwaway Postgres with Testcontainers (requires Docker), or uses an
 * existing server when TEST_DB_HOST is set (CI service, compose test profile).
 * Migrates once; test files then share the schema and run in band.
 */
export default async function globalSetup(): Promise<void> {
  let db: DbConfig;

  if (process.env.TEST_DB_HOST) {
    db = {
      host: process.env.TEST_DB_HOST,
      port: Number(process.env.TEST_DB_PORT ?? 5432),
      user: process.env.TEST_DB_USER ?? 'postgres',
      password: process.env.TEST_DB_PASSWORD ?? 'postgres',
      name: process.env.TEST_DB_NAME ?? 'tonicrails_test',
      ssl: false,
      runMigrations: false,
      poolSize: 5,
      logging: false,
    };
    if (!db.name.endsWith('_test')) {
      throw new Error(`Refusing to reset non-test database "${db.name}"`);
    }
    await ensureDatabase(db);
  } else {
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('tonicrails_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    globalThis.__PG_CONTAINER__ = container;
    db = {
      // "localhost" can resolve to ::1, which Docker Desktop does not always forward.
      host:
        container.getHost() === 'localhost' ? '127.0.0.1' : container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getPassword(),
      name: container.getDatabase(),
      ssl: false,
      runMigrations: false,
      poolSize: 5,
      logging: false,
    };
  }

  Object.assign(process.env, testEnvironment(db));

  const dataSource = new DataSource(DbService.getDbConfigData(db));
  await dataSource.initialize();
  await dataSource.dropDatabase();
  await dataSource.runMigrations();
  await dataSource.destroy();
}

async function ensureDatabase(db: DbConfig): Promise<void> {
  const client = new Client({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: 'postgres',
  });
  await client.connect();
  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [db.name],
    );
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${db.name}"`);
    }
  } finally {
    await client.end();
  }
}
