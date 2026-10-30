import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TestContext,
  api,
  createTestApp,
  resetDatabase,
} from '../utils/test-app';

type Schemas = Record<string, { example?: Record<string, unknown> }>;

const schemas = (
  JSON.parse(
    readFileSync(resolve(__dirname, '../../docs/openapi.json'), 'utf8'),
  ) as { components: { schemas: Schemas } }
).components.schemas;

const example = (name: string): Record<string, unknown> => {
  const value = schemas[name]?.example;
  if (!value) throw new Error(`${name} has no example in docs/openapi.json`);
  return value;
};

/**
 * A reviewer's first click in Swagger is "Try it out" with the documented
 * example. Replaying those examples in order must succeed, so the committed
 * spec can never drift into examples that fail validation.
 */
describe('Documented OpenAPI examples', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.dataSource);
  });
  afterAll(() => ctx.app.close());

  it('run end to end exactly as documented', async () => {
    const wallet = await api
      .createWallet(ctx.http, example('CreateWalletDto'))
      .expect(201);
    const walletId = wallet.body.data.id as string;

    // The transfer example's recipient must exist.
    await api
      .createWallet(ctx.http, {
        email: (example('TransferDto').recipient as { email: string }).email,
      })
      .expect(201);

    await api.deposit(ctx.http, walletId, example('DepositDto')).expect(201);
    await api.swap(ctx.http, walletId, example('SwapDto')).expect(201);
    await api.transfer(ctx.http, walletId, example('TransferDto')).expect(201);
  });
});
