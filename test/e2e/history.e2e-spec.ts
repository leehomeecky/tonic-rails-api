import { randomUUID } from 'node:crypto';
import {
  TestContext,
  api,
  createTestApp,
  fundedWallet,
  newWallet,
  resetDatabase,
} from '../utils/test-app';

interface TxView {
  id: string;
  reference: string;
  type: string;
  direction: string;
  createdAt: string;
  source: { currency: string };
  destination: { currency: string };
}

describe('Transaction history', () => {
  let ctx: TestContext;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    alice = await fundedWallet(ctx.http, { cNGN: '100000', USDx: '50' });
    bob = await newWallet(ctx.http);

    await api
      .swap(ctx.http, alice, {
        fromCurrency: 'cNGN',
        toCurrency: 'USDx',
        amount: '1500',
      })
      .expect(201);
    await api
      .transfer(ctx.http, alice, {
        recipient: { walletId: bob },
        sourceCurrency: 'USDx',
        destinationCurrency: 'cGHS',
        amount: '10',
      })
      .expect(201);
    await api
      .transfer(ctx.http, alice, {
        recipient: { walletId: bob },
        sourceCurrency: 'cNGN',
        amount: '500',
      })
      .expect(201);
  });

  it('lists deposits, swaps and sent transfers newest first', async () => {
    const res = await api.history(ctx.http, alice).expect(200);
    const data = res.body.data as TxView[];

    expect(data.map((t) => `${t.type}:${t.direction}`)).toEqual([
      'TRANSFER:OUT',
      'TRANSFER:OUT',
      'SWAP:SELF',
      'DEPOSIT:IN',
      'DEPOSIT:IN',
    ]);
    const times = data.map((t) => Date.parse(t.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.body.meta).toEqual({
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });
  });

  it('shows received transfers in the receiver history as IN', async () => {
    const res = await api.history(ctx.http, bob).expect(200);
    const data = res.body.data as TxView[];
    expect(data).toHaveLength(2);
    expect(
      data.every((t) => t.type === 'TRANSFER' && t.direction === 'IN'),
    ).toBe(true);
  });

  it('filters by type and by currency (source or destination)', async () => {
    const swaps = await api
      .history(ctx.http, alice, { type: 'SWAP' })
      .expect(200);
    expect(swaps.body.data).toHaveLength(1);

    const ghs = await api
      .history(ctx.http, bob, { currency: 'cGHS' })
      .expect(200);
    expect(ghs.body.data).toHaveLength(1);
    expect((ghs.body.data as TxView[])[0].destination.currency).toBe('cGHS');

    const usd = await api
      .history(ctx.http, alice, { currency: 'USDx' })
      .expect(200);
    // USDx deposit, cNGN→USDx swap, USDx→cGHS transfer
    expect(usd.body.data).toHaveLength(3);
  });

  it('filters by date range', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await api
      .history(ctx.http, alice, { from: future })
      .expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('pages with an opaque cursor without gaps or duplicates', async () => {
    const all = (await api.history(ctx.http, alice).expect(200)).body
      .data as TxView[];

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await api
        .history(ctx.http, alice, { limit: '2', ...(cursor ? { cursor } : {}) })
        .expect(200);
      seen.push(...(res.body.data as TxView[]).map((t) => t.id));
      cursor = res.body.meta.nextCursor ?? undefined;
      expect(res.body.meta.hasMore).toBe(cursor !== undefined);
    } while (cursor);

    expect(seen).toEqual(all.map((t) => t.id));
  });

  it('rejects a tampered cursor and out-of-range limits', async () => {
    const bad = await api
      .history(ctx.http, alice, { cursor: 'not-a-cursor' })
      .expect(400);
    expect(bad.body.code).toBe('INVALID_CURSOR');

    for (const limit of ['0', '101', 'abc']) {
      const res = await api.history(ctx.http, alice, { limit }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await api.history(ctx.http, randomUUID()).expect(404);
    expect(res.body.code).toBe('WALLET_NOT_FOUND');
  });

  describe('GET /transactions/:id', () => {
    it('fetches by id and by reference', async () => {
      const [latest] = (await api.history(ctx.http, alice).expect(200)).body
        .data as TxView[];

      const byId = await api.transaction(ctx.http, latest.id).expect(200);
      const byRef = await api
        .transaction(ctx.http, latest.reference)
        .expect(200);

      expect(byId.body.data.id).toBe(latest.id);
      expect(byRef.body.data).toEqual(byId.body.data);
      expect(byId.body.data.direction).toBeUndefined();
      expect(byId.body.data.receiver.walletId).toBe(bob);
    });

    it('returns 404 for an unknown transaction', async () => {
      for (const id of [randomUUID(), 'TR-20260101-AAAAAAAA']) {
        const res = await api.transaction(ctx.http, id).expect(404);
        expect(res.body.code).toBe('TRANSACTION_NOT_FOUND');
      }
    });
  });
});
