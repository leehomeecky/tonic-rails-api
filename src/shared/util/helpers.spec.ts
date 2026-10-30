import { DomainException } from '../global/errors';
import { CircuitBreaker } from './circuit-breaker.util';
import { decodeCursor, encodeCursor } from './cursor.util';
import { canonicalJson, hashRequest } from './hash.util';
import {
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizePhone,
} from './identity.util';
import { generateReference } from './reference.util';

describe('hash.util', () => {
  it('canonicalises nested key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: 3 } })).toBe(
      '{"a":{"c":3,"d":[{"x":2,"y":1}]},"b":1}',
    );
  });

  it('hashes equal payloads equally regardless of key order', () => {
    expect(hashRequest({ amount: '1', currency: 'USDx' })).toBe(
      hashRequest({ currency: 'USDx', amount: '1' }),
    );
    expect(hashRequest({ amount: '1' })).not.toBe(hashRequest({ amount: '2' }));
  });
});

describe('cursor.util', () => {
  it('round-trips (createdAt, id)', () => {
    const cursor = {
      createdAt: new Date('2026-10-29T10:15:02.123Z'),
      id: '6b0f0b3e-5d3a-4a52-9c51-2f2c4f6c1a10',
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    'garbage',
    Buffer.from('{"t":"nope","id":"x"}').toString('base64url'),
    Buffer.from('{"t":"2026-10-29T10:15:02Z","id":"not-a-uuid"}').toString(
      'base64url',
    ),
  ])('rejects %s', (cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(DomainException);
  });
});

describe('identity.util', () => {
  it('normalises Nigerian numbers in local or international form to E.164', () => {
    expect(normalizePhone('0803 123 4567')).toBe('+2348031234567');
    expect(normalizePhone('+234 803 123 4567')).toBe('+2348031234567');
    expect(normalizePhone('+233 24 123 4567')).toBe('+233241234567');
    expect(normalizePhone('12345')).toBeNull();
  });

  it('normalises and masks identifiers', () => {
    expect(normalizeEmail('  Ama@Example.COM ')).toBe('ama@example.com');
    expect(maskEmail('ama@example.com')).toBe('a**@example.com');
    expect(maskEmail('a@example.com')).toBe('a**@example.com');
    expect(maskPhone('+2348031234567')).toBe('+234******4567');
  });
});

describe('reference.util', () => {
  it('produces dated, human-friendly references', () => {
    const reference = generateReference(new Date('2026-10-29T12:00:00Z'));
    expect(reference).toMatch(/^TR-20261029-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});

describe('CircuitBreaker', () => {
  it('opens after the threshold and half-opens after the cool-down', () => {
    let now = 0;
    const breaker = new CircuitBreaker(2, 1000, () => now);

    breaker.recordFailure();
    expect(breaker.isOpen).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(true);

    now = 999;
    expect(breaker.isOpen).toBe(true);
    now = 1000;
    expect(breaker.isOpen).toBe(false);
  });

  it('resets the failure count on success', () => {
    const breaker = new CircuitBreaker(2, 1000, () => 0);
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isOpen).toBe(false);
  });
});
