import { AppConfig } from '../../shared/config/env/app-config';
import { RedisService } from '../../shared/config/cache/redis.service';
import {
  STATIC_FX_SNAPSHOT_ID,
  STATIC_USD_RATES,
} from '../../shared/global/constants';
import { CurrencyEnum, FxSourceEnum } from '../../shared/global/enums';
import {
  FxProviderError,
  IFxProvider,
  UsdRateQuote,
} from '../../shared/global/interfaces';
import { FxRateSnapshot } from '../../shared/global/model/entities';
import { FxRateSnapshotRepository } from '../../shared/global/model/repositories';
import { Money } from '../../shared/util/money.util';
import { FxService } from './fx.service';

const LIVE_QUOTE: UsdRateQuote = {
  provider: 'live',
  source: FxSourceEnum.LIVE,
  usdRates: { USD: '1', NGN: '1600', GHS: '16', EUR: '0.9', XAF: '590' },
  providerTimestamp: null,
};

const config = {
  fx: {
    cacheTtlSeconds: 60,
    staleAfterSeconds: 900,
    maxStalenessSeconds: 86400,
  },
} as unknown as AppConfig;

function snapshotRow(partial: Partial<FxRateSnapshot>): FxRateSnapshot {
  return {
    id: 'snap-1',
    source: FxSourceEnum.LIVE,
    provider: 'live',
    usdRates: { ...LIVE_QUOTE.usdRates },
    providerTimestamp: null,
    fetchedAt: new Date(),
    ...partial,
  };
}

function build(options: {
  primary: IFxProvider;
  lastKnownGood?: FxRateSnapshot | null;
}) {
  const repo = {
    create: jest.fn((v: Partial<FxRateSnapshot>) => v),
    save: jest.fn((v: Partial<FxRateSnapshot>) =>
      Promise.resolve(snapshotRow({ ...v, id: v.id ?? 'saved-live' })),
    ),
    findLatestLiveSince: jest.fn(() =>
      Promise.resolve(options.lastKnownGood ?? null),
    ),
    findOneBy: jest.fn(() =>
      Promise.resolve(
        snapshotRow({
          id: STATIC_FX_SNAPSHOT_ID,
          source: FxSourceEnum.STATIC,
          provider: 'static',
          usdRates: { ...STATIC_USD_RATES },
        }),
      ),
    ),
  };
  const redis = {
    getJson: jest.fn(() => Promise.resolve(null)),
    setJson: jest.fn(() => Promise.resolve()),
  };
  const fallback = {} as IFxProvider;
  const service = new FxService(
    options.primary,
    fallback,
    repo as unknown as FxRateSnapshotRepository,
    redis as unknown as RedisService,
    config,
  );
  return { service, repo, redis };
}

const live = (fetch: () => Promise<UsdRateQuote>): IFxProvider => ({
  name: 'live',
  source: FxSourceEnum.LIVE,
  fetchUsdRates: jest.fn(fetch),
});

describe('FxService', () => {
  it('uses the live provider, persists the snapshot and caches it', async () => {
    const primary = live(() => Promise.resolve(LIVE_QUOTE));
    const { service, repo, redis } = build({ primary });

    const snapshot = await service.getSnapshot();

    expect(snapshot.rateSource).toBe(FxSourceEnum.LIVE);
    expect(snapshot.isStale).toBe(false);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(redis.setJson).toHaveBeenCalledTimes(1);

    await service.getSnapshot();
    expect(primary.fetchUsdRates).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const primary = live(() => Promise.resolve(LIVE_QUOTE));
    const { service } = build({ primary });

    await Promise.all(Array.from({ length: 10 }, () => service.getSnapshot()));
    expect(primary.fetchUsdRates).toHaveBeenCalledTimes(1);
  });

  it('retries once, then serves the last known good snapshot as stale', async () => {
    const primary = live(() => Promise.reject(new FxProviderError('down')));
    const { service } = build({
      primary,
      lastKnownGood: snapshotRow({
        id: 'lkg',
        fetchedAt: new Date(Date.now() - 2 * 3600 * 1000),
      }),
    });

    const snapshot = await service.getSnapshot();

    expect(primary.fetchUsdRates).toHaveBeenCalledTimes(2);
    expect(snapshot.id).toBe('lkg');
    expect(snapshot.rateSource).toBe(FxSourceEnum.LAST_KNOWN_GOOD);
    expect(snapshot.isStale).toBe(true);
  });

  it('falls back to the static table when nothing recent exists', async () => {
    const primary = live(() => Promise.reject(new FxProviderError('down')));
    const { service } = build({ primary, lastKnownGood: null });

    const snapshot = await service.getSnapshot();
    expect(snapshot.id).toBe(STATIC_FX_SNAPSHOT_ID);
    expect(snapshot.rateSource).toBe(FxSourceEnum.STATIC);
  });

  it('rejects an unusable quote (non-USD base) as a provider failure', async () => {
    const primary = live(() =>
      Promise.resolve({
        ...LIVE_QUOTE,
        usdRates: { ...LIVE_QUOTE.usdRates, USD: '2' },
      }),
    );
    const { service } = build({ primary, lastKnownGood: null });
    expect((await service.getSnapshot()).rateSource).toBe(FxSourceEnum.STATIC);
  });

  it('opens the circuit after repeated failures and stops calling the provider', async () => {
    const primary = live(() => Promise.reject(new FxProviderError('down')));
    const { service } = build({ primary });

    for (let i = 0; i < 3; i++) {
      await expect(service.refresh()).rejects.toThrow();
    }
    const callsWhenOpened = (primary.fetchUsdRates as jest.Mock).mock.calls
      .length;
    await expect(service.refresh()).rejects.toThrow(/Circuit open/);
    expect((primary.fetchUsdRates as jest.Mock).mock.calls.length).toBe(
      callsWhenOpened,
    );
  });

  it('converts with the snapshot and values balances in USD', async () => {
    const { service } = build({
      primary: live(() => Promise.resolve(LIVE_QUOTE)),
    });
    const snapshot = await service.getSnapshot();

    expect(
      service
        .convert(
          snapshot,
          CurrencyEnum.cNGN,
          CurrencyEnum.cGHS,
          new Money('1600'),
        )
        .toFixed(),
    ).toBe('16');
    expect(
      service.toUsd(snapshot, CurrencyEnum.EURx, new Money('0.9')).toFixed(),
    ).toBe('1');
    expect(
      service.rate(snapshot, CurrencyEnum.USDx, CurrencyEnum.USDx).toFixed(),
    ).toBe('1');
    expect(service.ratesView(snapshot).rates).toHaveLength(20);
  });
});
