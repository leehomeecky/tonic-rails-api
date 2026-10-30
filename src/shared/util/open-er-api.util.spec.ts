import { AppConfig } from '../config/env/app-config';
import { FxProviderError } from '../global/interfaces';
import { OpenErApiFxUtil } from './open-er-api.util';

const config = {
  fx: { url: 'https://fx.test/latest/USD', timeoutMs: 500 },
} as unknown as AppConfig;

const okPayload = {
  result: 'success',
  base_code: 'USD',
  time_last_update_unix: 1793232000,
  rates: { USD: 1, NGN: 1530.12, GHS: 15.4, XAF: 600.1, EUR: 0.915, GBP: 0.79 },
};

function mockFetch(response: Partial<Response> | Error): jest.SpyInstance {
  return jest
    .spyOn(global, 'fetch')
    .mockImplementation(() =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve({ ok: true, status: 200, ...response } as Response),
    );
}

describe('OpenErApiFxUtil', () => {
  const provider = new OpenErApiFxUtil(config);
  afterEach(() => jest.restoreAllMocks());

  it('maps the payload to string rates for the supported ISO codes only', async () => {
    mockFetch({ json: () => Promise.resolve(okPayload) });

    const quote = await provider.fetchUsdRates();

    expect(quote.usdRates).toEqual({
      USD: '1',
      NGN: '1530.12',
      GHS: '15.4',
      XAF: '600.1',
      EUR: '0.915',
    });
    expect(quote.source).toBe('LIVE');
    expect(quote.providerTimestamp?.toISOString()).toBe(
      '2026-10-29T00:00:00.000Z',
    );
  });

  it.each<[string, Partial<Response> | Error]>([
    ['a network error', new TypeError('fetch failed')],
    ['an HTTP error', { ok: false, status: 503 }],
    [
      'an error payload',
      {
        json: () => Promise.resolve({ result: 'error', 'error-type': 'quota' }),
      },
    ],
    [
      'a missing currency',
      {
        json: () =>
          Promise.resolve({ ...okPayload, rates: { USD: 1, NGN: 1500 } }),
      },
    ],
    [
      'a non-positive rate',
      {
        json: () =>
          Promise.resolve({
            ...okPayload,
            rates: { ...okPayload.rates, GHS: 0 },
          }),
      },
    ],
  ])('throws FxProviderError on %s', async (_label, response) => {
    mockFetch(response);
    await expect(provider.fetchUsdRates()).rejects.toBeInstanceOf(
      FxProviderError,
    );
  });
});
