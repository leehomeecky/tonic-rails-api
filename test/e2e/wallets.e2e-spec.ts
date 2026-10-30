import {
  TestContext,
  api,
  createTestApp,
  resetDatabase,
} from '../utils/test-app';

describe('Wallets', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());
  beforeEach(() => resetDatabase(ctx.dataSource));

  describe('POST /api/v1/wallets', () => {
    it('creates a wallet by email with a zero balance in every coin', async () => {
      const res = await api
        .createWallet(ctx.http, { email: '  Ama@Example.COM ' })
        .expect(201);

      expect(res.body.message).toBe('Wallet created');
      expect(res.body.data).toMatchObject({
        email: 'ama@example.com',
        phone: null,
      });
      expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.data.balances).toHaveLength(5);
      for (const balance of res.body.data.balances) {
        expect(balance.available).toBe('0');
      }
      expect(
        res.body.data.balances
          .map((b: { currency: string }) => b.currency)
          .sort(),
      ).toEqual(['EURx', 'USDx', 'cGHS', 'cNGN', 'cXAF'].sort());
    });

    it('creates a wallet by phone, normalised to E.164', async () => {
      const res = await api
        .createWallet(ctx.http, { phone: '0803 123 4567' })
        .expect(201);
      expect(res.body.data.phone).toBe('+2348031234567');
      expect(res.body.data.email).toBeNull();
    });

    it('rejects a second wallet for the same email, ignoring case', async () => {
      await api
        .createWallet(ctx.http, { email: 'kofi@example.com' })
        .expect(201);
      const res = await api
        .createWallet(ctx.http, { email: 'KOFI@example.com' })
        .expect(409);
      expect(res.body.code).toBe('WALLET_ALREADY_EXISTS');
    });

    it('rejects a second wallet for the same phone in a different format', async () => {
      await api.createWallet(ctx.http, { phone: '+2348031234567' }).expect(201);
      const res = await api
        .createWallet(ctx.http, { phone: '08031234567' })
        .expect(409);
      expect(res.body.code).toBe('WALLET_ALREADY_EXISTS');
    });

    it('creates exactly one wallet when the same email races', async () => {
      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          api.createWallet(ctx.http, { email: 'race@example.com' }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(14);
    });

    it.each<[Record<string, unknown>, string]>([
      [{}, 'neither identifier'],
      [{ email: 'a@example.com', phone: '+2348031234567' }, 'both identifiers'],
      [{ email: 'not-an-email' }, 'an invalid email'],
      [{ email: 'a@example.com', extra: true }, 'unknown fields'],
    ])('rejects %j (%s) with 400', async (body) => {
      const res = await api.createWallet(ctx.http, body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.issues.length).toBeGreaterThan(0);
    });

    it('rejects an invalid phone number', async () => {
      const res = await api
        .createWallet(ctx.http, { phone: '12345' })
        .expect(400);
      expect(res.body.code).toBe('INVALID_PHONE');
    });
  });

  describe('GET /api/v1/wallets/:id', () => {
    it('returns the wallet', async () => {
      const created = await api
        .createWallet(ctx.http, { email: 'efua@example.com' })
        .expect(201);
      const res = await api
        .wallet(ctx.http, created.body.data.id as string)
        .expect(200);
      expect(res.body.data.id).toBe(created.body.data.id);
    });

    it('returns 404 for an unknown wallet and for system wallets', async () => {
      for (const id of [
        '7b0d4b9e-1d1f-4b55-9d2a-4f3c1c3f0a11',
        '00000000-0000-4000-8000-000000000002',
      ]) {
        const res = await api.balances(ctx.http, id).expect(404);
        expect(res.body.code).toBe('WALLET_NOT_FOUND');
      }
    });

    it('returns 400 for a malformed id', async () => {
      const res = await api.balances(ctx.http, 'not-a-uuid').expect(400);
      expect(res.body.code).toBe('INVALID_ID');
    });
  });
});
