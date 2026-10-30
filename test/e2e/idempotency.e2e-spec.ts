import { randomUUID } from 'node:crypto';
import {
  TestContext,
  api,
  assertLedgerConsistent,
  balanceOf,
  createTestApp,
  fundedWallet,
  newWallet,
  resetDatabase,
} from '../utils/test-app';

async function countTransactions(
  ctx: TestContext,
  type?: 'DEPOSIT' | 'SWAP' | 'TRANSFER',
): Promise<number> {
  const [row] = await ctx.dataSource.query<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM transactions WHERE $1::text IS NULL OR type::text = $1`,
    [type ?? null],
  );
  return Number(row.count);
}

describe('Idempotency', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetDatabase(ctx.dataSource));
  afterEach(() => assertLedgerConsistent(ctx.dataSource));

  it('replays the original response for a retried request and moves money once', async () => {
    const walletId = await fundedWallet(ctx.http, { cNGN: '30000' });
    const key = randomUUID();
    const body = { fromCurrency: 'cNGN', toCurrency: 'USDx', amount: '15000' };

    const first = await api.swap(ctx.http, walletId, body, key).expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const retry = await api.swap(ctx.http, walletId, body, key).expect(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);

    expect(await balanceOf(ctx.http, walletId, 'cNGN')).toBe('15000');
    expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('10');
  });

  it('treats field order as the same request', async () => {
    const walletId = await newWallet(ctx.http);
    const key = randomUUID();
    await api
      .deposit(ctx.http, walletId, { currency: 'USDx', amount: '5' }, key)
      .expect(201);
    await api
      .deposit(ctx.http, walletId, { amount: '5', currency: 'USDx' }, key)
      .expect(201)
      .expect('Idempotent-Replayed', 'true');
    expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('5');
  });

  it('rejects the same key with a different payload', async () => {
    const walletId = await newWallet(ctx.http);
    const key = randomUUID();
    await api
      .deposit(ctx.http, walletId, { currency: 'USDx', amount: '5' }, key)
      .expect(201);

    const res = await api
      .deposit(ctx.http, walletId, { currency: 'USDx', amount: '6' }, key)
      .expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('5');
  });

  it('scopes keys per wallet and operation', async () => {
    const a = await newWallet(ctx.http);
    const b = await newWallet(ctx.http);
    const key = randomUUID();
    await api
      .deposit(ctx.http, a, { currency: 'USDx', amount: '1' }, key)
      .expect(201);
    await api
      .deposit(ctx.http, b, { currency: 'USDx', amount: '1' }, key)
      .expect(201);
    await api
      .swap(
        ctx.http,
        a,
        { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '1' },
        key,
      )
      .expect(201);
    expect(await countTransactions(ctx)).toBe(3);
  });

  it('replays a deterministic failure instead of re-executing it', async () => {
    const walletId = await fundedWallet(ctx.http, { USDx: '1' });
    const key = randomUUID();
    const body = { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '2' };

    const first = await api.swap(ctx.http, walletId, body, key).expect(422);
    expect(first.body.code).toBe('INSUFFICIENT_FUNDS');

    // Funds arrive, but the same key still means the same (failed) request.
    await api.deposit(ctx.http, walletId, { currency: 'USDx', amount: '5' });
    const retry = await api.swap(ctx.http, walletId, body, key).expect(422);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('6');

    // A new key is a new request.
    await api.swap(ctx.http, walletId, body).expect(201);
  });

  it('executes exactly once when the same request arrives concurrently', async () => {
    const sender = await fundedWallet(ctx.http, { cGHS: '1000' });
    const receiver = await newWallet(ctx.http);
    const key = randomUUID();
    const body = {
      recipient: { walletId: receiver },
      sourceCurrency: 'cGHS',
      amount: '100',
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.transfer(ctx.http, sender, body, key),
      ),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    const ids = new Set(responses.map((r) => r.body.data.id as string));
    expect(ids.size).toBe(1);
    expect(
      responses.filter((r) => r.headers['idempotent-replayed'] === 'true'),
    ).toHaveLength(9);

    expect(await countTransactions(ctx, 'TRANSFER')).toBe(1);
    expect(await balanceOf(ctx.http, sender, 'cGHS')).toBe('900');
    expect(await balanceOf(ctx.http, receiver, 'cGHS')).toBe('100');
  });

  it('never re-executes a key whose stored response was purged', async () => {
    const walletId = await newWallet(ctx.http);
    const key = randomUUID();
    const body = { currency: 'USDx', amount: '5' };
    await api.deposit(ctx.http, walletId, body, key).expect(201);

    await ctx.dataSource.query('DELETE FROM idempotency_keys');

    const res = await api.deposit(ctx.http, walletId, body, key).expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('5');
  });
});
