import request from 'supertest';
import {
  TestContext,
  api,
  createTestApp,
  fundedWallet,
  newWallet,
  resetDatabase,
} from '../utils/test-app';

/**
 * The client-facing contract for errors: the right code, and a message that
 * says exactly what is wrong. Each case here was checked for being specific
 * and not misleading.
 */
describe('Error messages', () => {
  let ctx: TestContext;
  let walletId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    walletId = await fundedWallet(ctx.http, { cNGN: '1000' });
  });

  const swap = (body: Record<string, unknown>) =>
    api.swap(ctx.http, walletId, {
      fromCurrency: 'cNGN',
      toCurrency: 'USDx',
      ...body,
    });

  describe('amount validation', () => {
    it.each<[string, unknown, string]>([
      [
        'a JSON number',
        5000,
        'Validation failed: amount: must be a string such as "1500.25", not a number; send amounts as strings to avoid floating-point rounding',
      ],
      [
        'null',
        null,
        'Validation failed: amount: must be a string such as "1500.25", not null; send amounts as strings to avoid floating-point rounding',
      ],
      [
        "Swagger's placeholder",
        'string',
        'Validation failed: amount: must be a plain decimal number such as "1500.25" (digits with an optional decimal point; no signs, commas, spaces or exponents), got "string"',
      ],
      [
        'thousands separators',
        '5,000',
        'Validation failed: amount: must be a plain decimal number such as "1500.25" (digits with an optional decimal point; no signs, commas, spaces or exponents), got "5,000"',
      ],
      [
        'a negative number',
        '-5',
        'Validation failed: amount: must be a plain decimal number such as "1500.25" (digits with an optional decimal point; no signs, commas, spaces or exponents), got "-5"',
      ],
      [
        'too many decimals',
        '1.1234567',
        'Validation failed: amount: must have at most 6 decimal places, got 7',
      ],
      [
        'too many digits',
        '1234567890123456789',
        'Validation failed: amount: is too large: at most 18 digits before the decimal point',
      ],
      ['zero', '0.000', 'Validation failed: amount: must be greater than 0'],
    ])('rejects %s with a precise message', async (_label, amount, message) => {
      const res = await swap({ amount }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.message).toBe(message);
      expect(res.body.details.issues).toEqual([
        {
          path: 'amount',
          message: message.replace('Validation failed: amount: ', ''),
        },
      ]);
    });

    it('lists every missing field, not just the first', async () => {
      const res = await api.swap(ctx.http, walletId, {}).expect(400);
      expect(res.body.message).toBe(
        'Validation failed: fromCurrency: is required; toCurrency: is required; amount: is required',
      );
      expect(res.body.details.issues).toHaveLength(3);
    });

    it('names the valid currencies and that they are case-sensitive', async () => {
      const res = await api
        .deposit(ctx.http, walletId, { currency: 'cngn', amount: '1' })
        .expect(400);
      expect(res.body.message).toBe(
        'Validation failed: currency: must be one of cNGN, cGHS, cXAF, USDx, EURx (case-sensitive), got "cngn"',
      );
    });

    it('accepts surrounding whitespace in amounts', async () => {
      await swap({ amount: ' 15 ' }).expect(201);
    });
  });

  describe('business rules', () => {
    it('names the currency and amounts when the balance is insufficient', async () => {
      const res = await swap({ amount: '5000' }).expect(422);
      expect(res.body).toMatchObject({
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient cNGN balance: available 1000, required 5000',
        details: { currency: 'cNGN', available: '1000', required: '5000' },
      });
    });

    it('returns the smallest amount that would convert', async () => {
      const res = await swap({ amount: '0.000001' }).expect(422);
      expect(res.body).toMatchObject({
        code: 'AMOUNT_TOO_SMALL',
        message:
          '0.000001 cNGN converts to less than 0.000001 USDx; the minimum is 0.0015 cNGN',
        details: {
          currency: 'cNGN',
          minimumAmount: '0.0015',
          destinationCurrency: 'USDx',
        },
      });
      // The reported minimum really is enough.
      await swap({ amount: '0.0015' }).expect(201);
    });

    it('states the USD value and the limit', async () => {
      const res = await api
        .deposit(ctx.http, walletId, {
          currency: 'cNGN',
          amount: '1500000001.5',
        })
        .expect(422);
      expect(res.body.message).toBe(
        'Amount is worth 1000000.001 USD, above the 1000000 USD limit per transaction',
      );
    });

    it('explains how to send non-Nigerian local phone numbers', async () => {
      const res = await api
        .createWallet(ctx.http, { phone: '0241234567' })
        .expect(400);
      expect(res.body.message).toBe(
        'Phone number is not valid. Numbers without a country code are read as Nigerian; use international format for other countries, e.g. +233241234567',
      );
    });
  });

  describe('request shape', () => {
    it('reports the identity rule at body level, not against a field', async () => {
      const none = await api.createWallet(ctx.http, {}).expect(400);
      expect(none.body.message).toBe(
        'Validation failed: body: email or phone is required',
      );
      const both = await api
        .createWallet(ctx.http, {
          email: 'a@example.com',
          phone: '+2348031234567',
        })
        .expect(400);
      expect(both.body.message).toBe(
        'Validation failed: body: provide either email or phone, not both',
      );
    });

    it('distinguishes a missing recipient from an empty one', async () => {
      const missing = await api
        .transfer(ctx.http, walletId, { sourceCurrency: 'cNGN', amount: '1' })
        .expect(400);
      expect(missing.body.message).toBe(
        'Validation failed: recipient: is required',
      );
      const empty = await api
        .transfer(ctx.http, walletId, {
          recipient: {},
          sourceCurrency: 'cNGN',
          amount: '1',
        })
        .expect(400);
      expect(empty.body.message).toBe(
        'Validation failed: recipient: one of walletId, email or phone is required',
      );
    });

    it('rejects a non-JSON body with 415 instead of "field is required"', async () => {
      const res = await request(ctx.http)
        .post('/api/v1/wallets')
        .set('content-type', 'text/plain')
        .send('{"email":"a@example.com"}')
        .expect(415);
      expect(res.body).toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json',
      });
    });

    it('reports malformed JSON as such, with the request id', async () => {
      const res = await request(ctx.http)
        .post('/api/v1/wallets')
        .set('content-type', 'application/json')
        .set('X-Request-Id', 'trace-json')
        .send('{"email":')
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
        requestId: 'trace-json',
      });
      expect(res.body.details.reason).toContain('JSON');
    });

    it('explains the history query parameters', async () => {
      const cases: Array<[Record<string, string>, string]> = [
        [{ limit: 'abc' }, 'limit: must be a whole number from 1 to 100'],
        [{ limit: '0' }, 'limit: must be a whole number from 1 to 100'],
        [{ type: 'deposit' }, 'type: must be one of DEPOSIT, SWAP, TRANSFER'],
        [
          { from: 'yesterday' },
          'from: must be an ISO-8601 date (2026-10-29) or date-time (2026-10-29T10:00:00Z)',
        ],
        [
          { from: '2026-12-01', to: '2026-01-01' },
          'from: must be on or before "to"',
        ],
      ];
      for (const [query, message] of cases) {
        const res = await api.history(ctx.http, walletId, query).expect(400);
        expect(res.body.message).toBe(`Validation failed: ${message}`);
      }
    });

    it('rejects a missing or malformed Idempotency-Key with the rule', async () => {
      const missing = await request(ctx.http)
        .post(`/api/v1/wallets/${walletId}/deposits`)
        .send({ currency: 'cNGN', amount: '1' })
        .expect(400);
      expect(missing.body.message).toBe(
        'Idempotency-Key header is required for deposits, swaps and transfers',
      );
      const invalid = await api
        .deposit(ctx.http, walletId, { currency: 'cNGN', amount: '1' }, 'short')
        .expect(400);
      expect(invalid.body.message).toBe(
        'Idempotency-Key must be 8-128 characters of letters, digits, "-" or "_"',
      );
    });
  });

  describe('consistency of shapes', () => {
    it('lists balances in the same canonical order on every endpoint', async () => {
      const expected = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'];
      const created = await api
        .createWallet(ctx.http, { email: 'order@example.com' })
        .expect(201);
      const id = created.body.data.id as string;
      const fetched = await api.wallet(ctx.http, id).expect(200);
      const valued = await api.balances(ctx.http, id).expect(200);

      for (const body of [created.body, fetched.body, valued.body]) {
        expect(
          (body.data.balances as Array<{ currency: string }>).map(
            (b) => b.currency,
          ),
        ).toEqual(expected);
      }
    });

    it('records the applied rate on every transaction, including "1" without conversion', async () => {
      const receiver = await newWallet(ctx.http);
      const sameCurrency = await api
        .transfer(ctx.http, walletId, {
          recipient: { walletId: receiver },
          sourceCurrency: 'cNGN',
          amount: '10',
        })
        .expect(201);
      expect(sameCurrency.body.data).toMatchObject({ rate: '1', fx: null });

      const converted = await swap({ amount: '15' }).expect(201);
      expect(converted.body.data.rate).toBe('0.000666666666666666');
      expect(converted.body.data.fx.rate).toBe(converted.body.data.rate);
    });

    it('accepts a transaction reference in any letter case', async () => {
      const deposit = await api
        .deposit(ctx.http, walletId, { currency: 'USDx', amount: '1' })
        .expect(201);
      const reference = deposit.body.data.reference as string;
      const res = await api
        .transaction(ctx.http, reference.toLowerCase())
        .expect(200);
      expect(res.body.data.id).toBe(deposit.body.data.id);
    });
  });
});
