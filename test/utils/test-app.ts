import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/bootstrap/setup-app';
import {
  STATIC_FX_SNAPSHOT_ID,
  SYSTEM_WALLET_IDS,
} from '../../src/shared/global/constants';

export interface TestContext {
  app: NestExpressApplication;
  http: App;
  dataSource: DataSource;
}

export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestContext> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (override) builder = override(builder);
  const moduleRef = await builder.compile();

  // TEST_LOGS=1 surfaces server-side errors while debugging a failing test.
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: process.env.TEST_LOGS ? ['error', 'warn'] : false,
  });
  setupApp(app);
  // Listen once on a random port so supertest reuses it instead of opening a listener per request.
  await app.listen(0, '127.0.0.1');

  return {
    app,
    http: app.getHttpServer() as App,
    dataSource: app.get(DataSource),
  };
}

/** Removes everything a test can create; keeps reference data and system wallets. */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `TRUNCATE idempotency_keys, ledger_entries, transactions RESTART IDENTITY`,
  );
  await dataSource.query(
    `DELETE FROM balances WHERE wallet_id IN (SELECT id FROM wallets WHERE type = 'USER')`,
  );
  await dataSource.query(`DELETE FROM wallets WHERE type = 'USER'`);
  await dataSource.query(`UPDATE balances SET available = 0, version = 0`);
  await dataSource.query(`DELETE FROM fx_rate_snapshots WHERE id <> $1`, [
    STATIC_FX_SNAPSHOT_ID,
  ]);
}

const BASE = '/api/v1';

export const api = {
  createWallet: (http: App, body: Record<string, unknown>) =>
    request(http).post(`${BASE}/wallets`).send(body),

  deposit: (
    http: App,
    walletId: string,
    body: Record<string, unknown>,
    key: string = randomUUID(),
  ) =>
    request(http)
      .post(`${BASE}/wallets/${walletId}/deposits`)
      .set('Idempotency-Key', key)
      .send(body),

  swap: (
    http: App,
    walletId: string,
    body: Record<string, unknown>,
    key: string = randomUUID(),
  ) =>
    request(http)
      .post(`${BASE}/wallets/${walletId}/swaps`)
      .set('Idempotency-Key', key)
      .send(body),

  transfer: (
    http: App,
    walletId: string,
    body: Record<string, unknown>,
    key: string = randomUUID(),
  ) =>
    request(http)
      .post(`${BASE}/wallets/${walletId}/transfers`)
      .set('Idempotency-Key', key)
      .send(body),

  wallet: (http: App, walletId: string) =>
    request(http).get(`${BASE}/wallets/${walletId}`),

  balances: (http: App, walletId: string) =>
    request(http).get(`${BASE}/wallets/${walletId}/balances`),

  history: (http: App, walletId: string, query: Record<string, string> = {}) =>
    request(http).get(`${BASE}/wallets/${walletId}/transactions`).query(query),

  transaction: (http: App, idOrReference: string) =>
    request(http).get(`${BASE}/transactions/${idOrReference}`),

  rates: (http: App) => request(http).get(`${BASE}/fx/rates`),
};

/** Creates a wallet and returns its id. */
export async function newWallet(
  http: App,
  body: Record<string, unknown> = { email: `${randomUUID()}@example.com` },
): Promise<string> {
  const res = await api.createWallet(http, body).expect(201);
  return res.body.data.id as string;
}

/** Wallet funded with the given balances, e.g. { cNGN: '1000' }. */
export async function fundedWallet(
  http: App,
  balances: Record<string, string>,
): Promise<string> {
  const walletId = await newWallet(http);
  for (const [currency, amount] of Object.entries(balances)) {
    await api.deposit(http, walletId, { currency, amount }).expect(201);
  }
  return walletId;
}

export async function balanceOf(
  http: App,
  walletId: string,
  currency: string,
): Promise<string> {
  const res = await api.balances(http, walletId).expect(200);
  const row = (
    res.body.data.balances as Array<{ currency: string; available: string }>
  ).find((b) => b.currency === currency);
  return row?.available ?? '0';
}

/**
 * Ledger invariants checked straight from SQL:
 *  - every currency nets to zero across all postings (double entry)
 *  - each balance equals the signed sum of its ledger entries
 *  - no user balance is negative
 */
export async function assertLedgerConsistent(
  dataSource: DataSource,
): Promise<void> {
  const unbalanced = await dataSource.query<unknown[]>(`
    SELECT currency
      FROM ledger_entries
     GROUP BY currency
    HAVING SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) <> 0`);
  expect(unbalanced).toEqual([]);

  const drift = await dataSource.query<unknown[]>(`
    SELECT b.wallet_id, b.currency, b.available, COALESCE(l.net, 0) AS ledger
      FROM balances b
      LEFT JOIN (
        SELECT wallet_id, currency,
               SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS net
          FROM ledger_entries
         GROUP BY wallet_id, currency
      ) l ON l.wallet_id = b.wallet_id AND l.currency = b.currency
     WHERE b.available <> COALESCE(l.net, 0)`);
  expect(drift).toEqual([]);

  const negative = await dataSource.query<unknown[]>(
    `SELECT wallet_id FROM balances WHERE available < 0 AND wallet_id <> ALL($1)`,
    [Object.values(SYSTEM_WALLET_IDS)],
  );
  expect(negative).toEqual([]);
}
