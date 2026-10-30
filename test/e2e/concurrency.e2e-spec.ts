import {
  TestContext,
  api,
  assertLedgerConsistent,
  balanceOf,
  createTestApp,
  fundedWallet,
  resetDatabase,
} from '../utils/test-app';

describe('Concurrency', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetDatabase(ctx.dataSource));
  afterEach(() => assertLedgerConsistent(ctx.dataSource));

  it('never double-spends: 50 parallel swaps against a balance that covers 10', async () => {
    const walletId = await fundedWallet(ctx.http, { USDx: '100' });

    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        api.swap(ctx.http, walletId, {
          fromCurrency: 'USDx',
          toCurrency: 'EURx',
          amount: '10',
        }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(40);
    for (const r of responses.filter((x) => x.status === 422)) {
      expect(r.body.code).toBe('INSUFFICIENT_FUNDS');
    }
    expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('0');
    expect(await balanceOf(ctx.http, walletId, 'EURx')).toBe('92');
  });

  it('opposing transfers between two wallets never deadlock and conserve value', async () => {
    const a = await fundedWallet(ctx.http, { cNGN: '100000', cGHS: '1000' });
    const b = await fundedWallet(ctx.http, { cNGN: '100000', cGHS: '1000' });

    const requests = Array.from({ length: 60 }, (_, i) => {
      const [from, to] = i % 2 === 0 ? [a, b] : [b, a];
      // Mix same-currency and cross-currency legs so the FX pool is contended too.
      const cross = i % 3 === 0;
      return api.transfer(ctx.http, from, {
        recipient: { walletId: to },
        sourceCurrency: 'cNGN',
        destinationCurrency: cross ? 'cGHS' : 'cNGN',
        amount: '1000',
      });
    });
    const responses = await Promise.all(requests);

    expect(responses.map((r) => r.status)).toEqual(Array(60).fill(201));

    // cNGN debited from the pair: 60 × 1000; cGHS credited for the 20 cross legs: 20 × 10.
    const totalNgn =
      Number(await balanceOf(ctx.http, a, 'cNGN')) +
      Number(await balanceOf(ctx.http, b, 'cNGN'));
    const totalGhs =
      Number(await balanceOf(ctx.http, a, 'cGHS')) +
      Number(await balanceOf(ctx.http, b, 'cGHS'));
    expect(totalNgn).toBe(200000 - 20 * 1000);
    expect(totalGhs).toBe(2000 + 20 * 10);
  });

  it('serialises a fan-in of transfers into one wallet without losing any', async () => {
    const senders = await Promise.all(
      Array.from({ length: 10 }, () => fundedWallet(ctx.http, { USDx: '10' })),
    );
    const receiver = await fundedWallet(ctx.http, {});

    const responses = await Promise.all(
      senders.flatMap((sender) =>
        Array.from({ length: 5 }, () =>
          api.transfer(ctx.http, sender, {
            recipient: { walletId: receiver },
            sourceCurrency: 'USDx',
            amount: '2',
          }),
        ),
      ),
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(ctx.http, receiver, 'USDx')).toBe('100');
    for (const sender of senders) {
      expect(await balanceOf(ctx.http, sender, 'USDx')).toBe('0');
    }
  });
});
