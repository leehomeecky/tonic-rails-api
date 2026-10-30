import { randomUUID } from 'node:crypto';
import request from 'supertest';
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

/**
 * Static FX table in tests (units per 1 USD):
 * USD 1 · NGN 1500 · GHS 15 · EUR 0.92 · XAF 603.48044
 */
describe('Deposits, swaps and transfers', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetDatabase(ctx.dataSource));
  afterEach(() => assertLedgerConsistent(ctx.dataSource));

  describe('POST /wallets/:id/deposits', () => {
    it('credits the wallet immediately and records a transaction', async () => {
      const walletId = await newWallet(ctx.http);

      const res = await api
        .deposit(ctx.http, walletId, { currency: 'cNGN', amount: '150000.25' })
        .expect(201);

      expect(res.body.message).toBe('Deposit completed');
      expect(res.body.data).toMatchObject({
        type: 'DEPOSIT',
        status: 'COMPLETED',
        walletId,
        source: { currency: 'cNGN', amount: '150000.25' },
        destination: { currency: 'cNGN', amount: '150000.25' },
        fx: null,
        sender: null,
        receiver: null,
      });
      expect(res.body.data.reference).toMatch(/^TR-\d{8}-[0-9A-Z]{8}$/);
      expect(await balanceOf(ctx.http, walletId, 'cNGN')).toBe('150000.25');
    });

    it('keeps full 6-decimal precision with no float drift', async () => {
      const walletId = await newWallet(ctx.http);
      for (const amount of ['0.1', '0.2', '0.000001']) {
        await api
          .deposit(ctx.http, walletId, { currency: 'USDx', amount })
          .expect(201);
      }
      expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('0.300001');
    });

    it.each<[unknown, string]>([
      [100, 'a JSON number'],
      ['-5', 'a negative amount'],
      ['0', 'zero'],
      ['0.0000001', 'more than 6 decimals'],
      ['1e5', 'exponent notation'],
      ['abc', 'not a number'],
    ])('rejects amount %j (%s)', async (amount) => {
      const walletId = await newWallet(ctx.http);
      const res = await api
        .deposit(ctx.http, walletId, { currency: 'USDx', amount })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unsupported currency', async () => {
      const walletId = await newWallet(ctx.http);
      const res = await api
        .deposit(ctx.http, walletId, { currency: 'BTC', amount: '1' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('requires a well-formed Idempotency-Key header', async () => {
      const walletId = await newWallet(ctx.http);
      const missing = await request(ctx.http)
        .post(`/api/v1/wallets/${walletId}/deposits`)
        .send({ currency: 'USDx', amount: '1' })
        .expect(400);
      expect(missing.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const invalid = await api
        .deposit(
          ctx.http,
          walletId,
          { currency: 'USDx', amount: '1' },
          'bad key!',
        )
        .expect(400);
      expect(invalid.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
    });

    it('returns 404 for an unknown wallet', async () => {
      const res = await api
        .deposit(ctx.http, randomUUID(), { currency: 'USDx', amount: '1' })
        .expect(404);
      expect(res.body.code).toBe('WALLET_NOT_FOUND');
    });

    it('enforces the per-transaction USD limit', async () => {
      const walletId = await newWallet(ctx.http);
      const res = await api
        .deposit(ctx.http, walletId, {
          currency: 'USDx',
          amount: '1000000.000001',
        })
        .expect(422);
      expect(res.body.code).toBe('AMOUNT_LIMIT_EXCEEDED');
      expect(res.body.details).toEqual({
        maxUsd: '1000000',
        amountUsd: '1000000.000001',
      });
    });
  });

  describe('POST /wallets/:id/swaps', () => {
    it('converts at the snapshot rate, records the rate and moves both balances', async () => {
      const walletId = await fundedWallet(ctx.http, { cNGN: '20000' });

      const res = await api
        .swap(ctx.http, walletId, {
          fromCurrency: 'cNGN',
          toCurrency: 'USDx',
          amount: '15300',
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        type: 'SWAP',
        source: { currency: 'cNGN', amount: '15300' },
        destination: { currency: 'USDx', amount: '10.2' },
        fx: {
          rate: '0.000666666666666666',
          source: 'STATIC',
          snapshotId: '00000000-0000-4000-8000-0000000000f1',
        },
      });
      expect(await balanceOf(ctx.http, walletId, 'cNGN')).toBe('4700');
      expect(await balanceOf(ctx.http, walletId, 'USDx')).toBe('10.2');
    });

    it('rounds the credited amount down, never up', async () => {
      const walletId = await fundedWallet(ctx.http, { cNGN: '1' });
      // 1 / 1500 = 0.000666666... → 0.000666
      const res = await api
        .swap(ctx.http, walletId, {
          fromCurrency: 'cNGN',
          toCurrency: 'USDx',
          amount: '1',
        })
        .expect(201);
      expect(res.body.data.destination.amount).toBe('0.000666');
    });

    it('converts between two non-USD coins through the USD cross rate', async () => {
      const walletId = await fundedWallet(ctx.http, { EURx: '100' });
      const res = await api
        .swap(ctx.http, walletId, {
          fromCurrency: 'EURx',
          toCurrency: 'cXAF',
          amount: '100',
        })
        .expect(201);
      // XAF is pegged at 655.957 per EUR.
      expect(res.body.data.destination.amount).toBe('65595.7');
      expect(res.body.data.fx.rate).toBe('655.957');
    });

    it('rejects a swap that would make the balance negative', async () => {
      const walletId = await fundedWallet(ctx.http, { cNGN: '100' });
      const res = await api
        .swap(ctx.http, walletId, {
          fromCurrency: 'cNGN',
          toCurrency: 'USDx',
          amount: '100.000001',
        })
        .expect(422);
      expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
      expect(res.body.details).toEqual({
        currency: 'cNGN',
        available: '100',
        required: '100.000001',
      });
      expect(await balanceOf(ctx.http, walletId, 'cNGN')).toBe('100');
    });

    it('rejects a swap into the same currency', async () => {
      const walletId = await fundedWallet(ctx.http, { USDx: '10' });
      const res = await api
        .swap(ctx.http, walletId, {
          fromCurrency: 'USDx',
          toCurrency: 'USDx',
          amount: '1',
        })
        .expect(400);
      expect(res.body.code).toBe('SAME_CURRENCY_SWAP');
    });

    it('rejects an amount that converts to zero', async () => {
      const walletId = await fundedWallet(ctx.http, { cNGN: '1' });
      const res = await api
        .swap(ctx.http, walletId, {
          fromCurrency: 'cNGN',
          toCurrency: 'USDx',
          amount: '0.000001',
        })
        .expect(422);
      expect(res.body.code).toBe('AMOUNT_TOO_SMALL');
    });
  });

  describe('POST /wallets/:id/transfers', () => {
    it('sends the same currency to a wallet identified by email', async () => {
      const sender = await fundedWallet(ctx.http, { cGHS: '100' });
      const receiver = await newWallet(ctx.http, {
        email: 'kwame@example.com',
      });

      const res = await api
        .transfer(ctx.http, sender, {
          recipient: { email: 'KWAME@example.com' },
          sourceCurrency: 'cGHS',
          amount: '40.5',
          note: 'Lunch',
        })
        .expect(201);

      expect(res.body.data).toMatchObject({
        type: 'TRANSFER',
        walletId: sender,
        source: { currency: 'cGHS', amount: '40.5' },
        destination: { currency: 'cGHS', amount: '40.5' },
        fx: null,
        note: 'Lunch',
        sender: { walletId: sender },
        receiver: { walletId: receiver, identifier: 'k****@example.com' },
      });
      expect(await balanceOf(ctx.http, sender, 'cGHS')).toBe('59.5');
      expect(await balanceOf(ctx.http, receiver, 'cGHS')).toBe('40.5');
    });

    it('converts automatically when the currencies differ (recipient by phone)', async () => {
      const sender = await fundedWallet(ctx.http, { cNGN: '60000' });
      const receiver = await newWallet(ctx.http, { phone: '+233241234567' });

      const res = await api
        .transfer(ctx.http, sender, {
          recipient: { phone: '+233 24 123 4567' },
          sourceCurrency: 'cNGN',
          destinationCurrency: 'cGHS',
          amount: '50000',
        })
        .expect(201);

      // Every field the brief requires on a transfer record:
      expect(res.body.data).toMatchObject({
        sender: { walletId: sender },
        receiver: { walletId: receiver, identifier: '+233*****4567' },
        source: { currency: 'cNGN', amount: '50000' },
        destination: { currency: 'cGHS', amount: '500' },
        fx: { rate: '0.01', source: 'STATIC' },
      });
      expect(Date.parse(res.body.data.createdAt)).not.toBeNaN();
      expect(await balanceOf(ctx.http, sender, 'cNGN')).toBe('10000');
      expect(await balanceOf(ctx.http, receiver, 'cGHS')).toBe('500');
    });

    it('accepts the recipient wallet id', async () => {
      const sender = await fundedWallet(ctx.http, { USDx: '5' });
      const receiver = await newWallet(ctx.http);
      await api
        .transfer(ctx.http, sender, {
          recipient: { walletId: receiver },
          sourceCurrency: 'USDx',
          destinationCurrency: 'EURx',
          amount: '5',
        })
        .expect(201);
      expect(await balanceOf(ctx.http, receiver, 'EURx')).toBe('4.6');
    });

    it('rejects transfers to self', async () => {
      const sender = await fundedWallet(ctx.http, { USDx: '5' });
      const res = await api
        .transfer(ctx.http, sender, {
          recipient: { walletId: sender },
          sourceCurrency: 'USDx',
          amount: '1',
        })
        .expect(400);
      expect(res.body.code).toBe('SELF_TRANSFER_NOT_ALLOWED');
    });

    it('rejects unknown recipients, including system wallets', async () => {
      const sender = await fundedWallet(ctx.http, { USDx: '5' });
      for (const recipient of [
        { email: 'nobody@example.com' },
        { walletId: '00000000-0000-4000-8000-000000000002' },
      ]) {
        const res = await api
          .transfer(ctx.http, sender, {
            recipient,
            sourceCurrency: 'USDx',
            amount: '1',
          })
          .expect(404);
        expect(res.body.code).toBe('RECIPIENT_NOT_FOUND');
      }
    });

    it('rejects a recipient given by more than one identifier', async () => {
      const sender = await fundedWallet(ctx.http, { USDx: '5' });
      const res = await api
        .transfer(ctx.http, sender, {
          recipient: { email: 'a@example.com', phone: '+2348031234567' },
          sourceCurrency: 'USDx',
          amount: '1',
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an overdraft and leaves both wallets untouched', async () => {
      const sender = await fundedWallet(ctx.http, { USDx: '5' });
      const receiver = await newWallet(ctx.http);
      const res = await api
        .transfer(ctx.http, sender, {
          recipient: { walletId: receiver },
          sourceCurrency: 'USDx',
          amount: '5.01',
        })
        .expect(422);
      expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
      expect(await balanceOf(ctx.http, sender, 'USDx')).toBe('5');
      expect(await balanceOf(ctx.http, receiver, 'USDx')).toBe('0');
    });
  });

  describe('GET /wallets/:id/balances', () => {
    it('returns every balance plus the total USD equivalent', async () => {
      const walletId = await fundedWallet(ctx.http, {
        cNGN: '1500',
        cGHS: '15',
        USDx: '1',
        EURx: '0.92',
        cXAF: '603.48044',
      });

      const res = await api.balances(ctx.http, walletId).expect(200);

      expect(res.body.data.totalUsd).toBe('5');
      for (const balance of res.body.data.balances) {
        expect(balance.usdValue).toBe('1');
      }
      expect(res.body.data.rates).toMatchObject({
        source: 'STATIC',
        isStale: true,
      });
    });
  });
});
