import {
  FxProviderError,
  IFxProvider,
  UsdRateQuote,
} from '../../src/shared/global/interfaces';
import { PRIMARY_FX_PROVIDER } from '../../src/shared/global/constants';
import { FxSourceEnum, IsoCurrencyEnum } from '../../src/shared/global/enums';
import {
  TestContext,
  api,
  createTestApp,
  fundedWallet,
  resetDatabase,
} from '../utils/test-app';

const LIVE_RATES: Record<IsoCurrencyEnum, string> = {
  USD: '1',
  NGN: '1600',
  GHS: '16',
  EUR: '0.9',
  XAF: '590.3613',
};

const liveProvider = (): IFxProvider => ({
  name: 'fake-live',
  source: FxSourceEnum.LIVE,
  fetchUsdRates: () =>
    Promise.resolve<UsdRateQuote>({
      provider: 'fake-live',
      source: FxSourceEnum.LIVE,
      usdRates: { ...LIVE_RATES },
      providerTimestamp: new Date(),
    }),
});

const failingProvider = (): IFxProvider & { calls: number } => {
  const provider = {
    calls: 0,
    name: 'down',
    source: FxSourceEnum.LIVE as const,
    fetchUsdRates: () => {
      provider.calls++;
      return Promise.reject(new FxProviderError('provider down'));
    },
  };
  return provider;
};

async function withProvider(provider: IFxProvider): Promise<TestContext> {
  return createTestApp((builder) =>
    builder.overrideProvider(PRIMARY_FX_PROVIDER).useValue(provider),
  );
}

describe('FX rates', () => {
  describe('GET /fx/rates (static provider)', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestApp();
      await resetDatabase(ctx.dataSource);
    });
    afterAll(() => ctx.app.close());

    it('returns all 20 ordered pairs, each with its refresh time', async () => {
      const res = await api.rates(ctx.http).expect(200);
      const { rates, source, isStale, base, refreshedAt } = res.body.data;

      expect(base).toBe('USDx');
      expect(source).toBe('STATIC');
      expect(isStale).toBe(true);
      expect(rates).toHaveLength(20);
      for (const rate of rates) {
        expect(rate.from).not.toBe(rate.to);
        expect(rate.refreshedAt).toBe(refreshedAt);
        expect(rate.rate).toMatch(/^\d+(\.\d+)?$/);
      }
      expect(rates).toContainEqual(
        expect.objectContaining({ from: 'cNGN', to: 'cGHS', rate: '0.01' }),
      );
      expect(rates).toContainEqual(
        expect.objectContaining({ from: 'USDx', to: 'cNGN', rate: '1500' }),
      );
    });
  });

  describe('live provider', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await withProvider(liveProvider());
      await resetDatabase(ctx.dataSource);
    });
    afterAll(() => ctx.app.close());

    it('serves live rates, persists the snapshot and prices swaps with it', async () => {
      const rates = await api.rates(ctx.http).expect(200);
      expect(rates.body.data).toMatchObject({
        source: 'LIVE',
        isStale: false,
        provider: 'fake-live',
      });
      // Both timestamps: when we fetched, and when the provider last updated.
      expect(Date.parse(rates.body.data.refreshedAt)).not.toBeNaN();
      expect(Date.parse(rates.body.data.providerUpdatedAt)).not.toBeNaN();

      const walletId = await fundedWallet(ctx.http, { cNGN: '16000' });
      const swap = await api
        .swap(ctx.http, walletId, {
          fromCurrency: 'cNGN',
          toCurrency: 'USDx',
          amount: '16000',
        })
        .expect(201);
      expect(swap.body.data.destination.amount).toBe('10');
      expect(swap.body.data.fx.source).toBe('LIVE');

      const [snapshot] = await ctx.dataSource.query<{ provider: string }[]>(
        'SELECT provider FROM fx_rate_snapshots WHERE id = $1',
        [swap.body.data.fx.snapshotId],
      );
      expect(snapshot.provider).toBe('fake-live');
    });
  });

  describe('provider failure', () => {
    it('falls back to the static table when there is no recent live snapshot', async () => {
      const provider = failingProvider();
      const ctx = await withProvider(provider);
      try {
        await resetDatabase(ctx.dataSource);
        const res = await api.rates(ctx.http).expect(200);
        expect(res.body.data.source).toBe('STATIC');
        expect(provider.calls).toBe(2); // one retry, then fallback

        // Cached: the next request does not hammer the failing provider.
        await api.rates(ctx.http).expect(200);
        expect(provider.calls).toBe(2);

        // Money keeps moving on fallback rates.
        const walletId = await fundedWallet(ctx.http, { USDx: '1' });
        const swap = await api
          .swap(ctx.http, walletId, {
            fromCurrency: 'USDx',
            toCurrency: 'cNGN',
            amount: '1',
          })
          .expect(201);
        expect(swap.body.data.fx.source).toBe('STATIC');
      } finally {
        await ctx.app.close();
      }
    });

    it('serves the last known good live snapshot, flagged as stale', async () => {
      const ctx = await withProvider(failingProvider());
      try {
        await resetDatabase(ctx.dataSource);
        await ctx.dataSource.query(
          `INSERT INTO fx_rate_snapshots (source, provider, usd_rates, fetched_at)
           VALUES ('LIVE', 'earlier-live', $1, now() - interval '2 hours')`,
          [JSON.stringify(LIVE_RATES)],
        );

        const res = await api.rates(ctx.http).expect(200);
        expect(res.body.data).toMatchObject({
          source: 'LAST_KNOWN_GOOD',
          provider: 'earlier-live',
          isStale: true,
        });
      } finally {
        await ctx.app.close();
      }
    });

    it('ignores live snapshots older than the maximum staleness', async () => {
      const ctx = await withProvider(failingProvider());
      try {
        await resetDatabase(ctx.dataSource);
        await ctx.dataSource.query(
          `INSERT INTO fx_rate_snapshots (source, provider, usd_rates, fetched_at)
           VALUES ('LIVE', 'ancient', $1, now() - interval '3 days')`,
          [JSON.stringify(LIVE_RATES)],
        );
        const res = await api.rates(ctx.http).expect(200);
        expect(res.body.data.source).toBe('STATIC');
      } finally {
        await ctx.app.close();
      }
    });
  });
});
