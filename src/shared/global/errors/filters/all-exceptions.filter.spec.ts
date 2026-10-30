import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { QueryFailedError } from 'typeorm';
import { ErrorCodeEnum } from '../../enums';
import { DomainException } from '../domain.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
}

function run(
  exception: unknown,
  request: Partial<{
    url: string;
    id: string;
    headers: Record<string, string>;
  }> = {},
): Captured {
  const captured: Captured = { headers: {} };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url: '/api/v1/x', headers: {}, ...request }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

const pgError = (code: string, constraint?: string) =>
  new QueryFailedError(
    'SELECT 1',
    [],
    Object.assign(new Error('pg'), { code, constraint }),
  );

describe('AllExceptionsFilter', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());
  afterAll(() => jest.restoreAllMocks());

  it('renders domain errors with their code, message and details', () => {
    const { status, body } = run(
      new DomainException(
        ErrorCodeEnum.INSUFFICIENT_FUNDS,
        { currency: 'cNGN' },
        'Insufficient cNGN balance',
      ),
      { id: 'req-1' },
    );
    expect(status).toBe(422);
    expect(body).toMatchObject({
      statusCode: 422,
      code: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient cNGN balance',
      details: { currency: 'cNGN' },
      path: '/api/v1/x',
      requestId: 'req-1',
    });
  });

  it('marks replayed outcomes with the Idempotent-Replayed header', () => {
    const replayed = DomainException.fromPayload({
      statusCode: 422,
      code: ErrorCodeEnum.INSUFFICIENT_FUNDS,
      message: 'Insufficient balance',
    });
    expect(run(replayed).headers['Idempotent-Replayed']).toBe('true');
  });

  it('never leaks the reason of an internal invariant violation', () => {
    const { status, body } = run(
      new DomainException(ErrorCodeEnum.LEDGER_INVARIANT_VIOLATION, {
        reason: 'USDx postings do not net to zero',
      }),
    );
    expect(status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(body?.details).toBeUndefined();
  });

  it('maps a regressed balance CHECK to INSUFFICIENT_FUNDS', () => {
    expect(run(pgError('23514')).body?.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('maps an unexpected unique violation to CONFLICT', () => {
    expect(run(pgError('23505', 'some_index')).body?.code).toBe('CONFLICT');
  });

  it.each([
    [
      'a refused connection',
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    ],
    ['too many connections', pgError('53300')],
    ['an admin shutdown', pgError('57P01')],
  ])('answers 503 SERVICE_UNAVAILABLE for %s', (_label, error) => {
    const { status, body } = run(error);
    expect(status).toBe(503);
    expect(body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service temporarily unavailable; please retry',
    });
  });

  it('uses the catalogue message for 429 instead of the class name', () => {
    const { status, body } = run(new ThrottlerException());
    expect(status).toBe(429);
    expect(body).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many requests; slow down and retry shortly',
    });
  });

  it('keeps the route in 404 messages', () => {
    expect(
      run(new NotFoundException('Cannot DELETE /api/v1/wallets/1')).body,
    ).toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      message: 'Cannot DELETE /api/v1/wallets/1',
    });
  });

  it('classifies JSON syntax errors as INVALID_JSON', () => {
    const { body } = run(
      new BadRequestException('Unexpected end of JSON input'),
    );
    expect(body).toMatchObject({
      code: 'INVALID_JSON',
      details: { reason: 'Unexpected end of JSON input' },
    });
  });

  it('falls back to the client request id when none was assigned', () => {
    const { body } = run(new BadRequestException('URI malformed'), {
      headers: { 'x-request-id': 'client-7' },
    });
    expect(body).toMatchObject({ code: 'BAD_REQUEST', requestId: 'client-7' });
  });

  it('hides unknown errors behind INTERNAL_ERROR', () => {
    const { status, body } = run(new TypeError('x is undefined'));
    expect(status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(body)).not.toContain('x is undefined');
  });

  it('passes health-probe reports through untouched', () => {
    const report = { status: 'error', error: { database: { status: 'down' } } };
    const { status, body } = run(new ServiceUnavailableException(report), {
      url: '/health/ready',
    });
    expect(status).toBe(503);
    expect(body).toEqual(report);
  });
});
