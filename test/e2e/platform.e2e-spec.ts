import request from 'supertest';
import { TestContext, createTestApp } from '../utils/test-app';

describe('Platform behaviour', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  it('reports liveness and readiness outside the API prefix', async () => {
    await request(ctx.http).get('/health/live').expect(200);
    const ready = await request(ctx.http).get('/health/ready').expect(200);
    expect(ready.body.status).toBe('ok');
    expect(ready.body.info.database.status).toBe('up');
    // Redis is disabled in tests; readiness must not depend on it.
    expect(ready.body.info.redis).toMatchObject({ enabled: false, mode: 'ok' });
  });

  it('returns the error shape for unknown routes', async () => {
    const res = await request(ctx.http).get('/api/v1/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
      path: '/api/v1/nope',
    });
    expect(Date.parse(res.body.timestamp)).not.toBeNaN();
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(ctx.http)
      .post('/api/v1/wallets')
      .set('content-type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await request(ctx.http)
      .post('/api/v1/wallets')
      .send({ email: `${'a'.repeat(200_000)}@example.com` })
      .expect(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('echoes a client request id and generates one otherwise', async () => {
    const echoed = await request(ctx.http)
      .get('/api/v1/nope')
      .set('X-Request-Id', 'trace-123');
    expect(echoed.headers['x-request-id']).toBe('trace-123');
    expect(echoed.body.requestId).toBe('trace-123');

    const generated = await request(ctx.http).get('/api/v1/nope');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers', async () => {
    const res = await request(ctx.http).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
