import fc from 'fast-check';
import {
  TestContext,
  api,
  assertLedgerConsistent,
  createTestApp,
  newWallet,
  resetDatabase,
} from '../utils/test-app';

const CURRENCIES = ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx'] as const;
const currency = fc.constantFrom(...CURRENCIES);
const wallet = fc.integer({ min: 0, max: 2 });
const amount = fc
  .tuple(
    fc.integer({ min: 0, max: 5000 }),
    fc.integer({ min: 0, max: 999_999 }),
  )
  .map(([whole, frac]) => `${whole}.${String(frac).padStart(6, '0')}`)
  .filter((value) => Number(value) > 0);

const operation = fc.oneof(
  fc.record({
    kind: fc.constant('deposit' as const),
    wallet,
    currency,
    amount,
  }),
  fc.record({
    kind: fc.constant('swap' as const),
    wallet,
    from: currency,
    to: currency,
    amount,
  }),
  fc.record({
    kind: fc.constant('transfer' as const),
    wallet,
    to: wallet,
    from: currency,
    toCurrency: currency,
    amount,
  }),
);

/**
 * Property: whatever sequence of deposits, swaps and transfers clients send,
 * the ledger stays double-entry balanced, balances equal the ledger, and no
 * user balance goes negative. Every response is either a success or a clean 4xx.
 */
describe('Ledger invariants (property-based)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  it('hold for random operation sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(operation, { minLength: 5, maxLength: 20 }),
        async (ops) => {
          await resetDatabase(ctx.dataSource);
          const wallets = [
            await newWallet(ctx.http),
            await newWallet(ctx.http),
            await newWallet(ctx.http),
          ];

          for (const op of ops) {
            const res =
              op.kind === 'deposit'
                ? await api.deposit(ctx.http, wallets[op.wallet], {
                    currency: op.currency,
                    amount: op.amount,
                  })
                : op.kind === 'swap'
                  ? await api.swap(ctx.http, wallets[op.wallet], {
                      fromCurrency: op.from,
                      toCurrency: op.to,
                      amount: op.amount,
                    })
                  : await api.transfer(ctx.http, wallets[op.wallet], {
                      recipient: { walletId: wallets[op.to] },
                      sourceCurrency: op.from,
                      destinationCurrency: op.toCurrency,
                      amount: op.amount,
                    });
            expect([201, 400, 422]).toContain(res.status);
          }

          await assertLedgerConsistent(ctx.dataSource);
        },
      ),
      { numRuns: 15 },
    );
  });
});
