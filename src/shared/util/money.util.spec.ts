import {
  AMOUNT_PATTERN,
  Money,
  convertViaUsd,
  crossRate,
  formatAmount,
  formatRate,
  moneyTransformer,
  parseAmount,
  roundDownToScale,
} from './money.util';

describe('money.util', () => {
  describe('AMOUNT_PATTERN / parseAmount', () => {
    it.each(['1', '0.1', '1500.25', '0.000001', '999999999999999999.999999'])(
      'accepts %s',
      (value) => {
        expect(AMOUNT_PATTERN.test(value)).toBe(true);
        expect(parseAmount(value).toFixed()).toBe(new Money(value).toFixed());
      },
    );

    it.each([
      '0',
      '0.000000',
      '-1',
      '1.0000001',
      '1e5',
      '.5',
      '5.',
      ' 1',
      'NaN',
      '1,000',
      '1234567890123456789',
    ])('rejects %s', (value) => {
      expect(AMOUNT_PATTERN.test(value)).toBe(false);
      expect(() => parseAmount(value)).toThrow(RangeError);
    });
  });

  describe('formatAmount', () => {
    it('trims trailing zeros and never uses exponent notation', () => {
      expect(formatAmount(new Money('10.500000'))).toBe('10.5');
      expect(formatAmount(new Money('100'))).toBe('100');
      expect(formatAmount(new Money('0.000001'))).toBe('0.000001');
      expect(formatAmount(new Money('123456789012345678.123456'))).toBe(
        '123456789012345678.123456',
      );
    });

    it('prints zero (including negative zero) as "0"', () => {
      expect(formatAmount(new Money(0))).toBe('0');
      expect(formatAmount(new Money('-0'))).toBe('0');
    });

    it('truncates beyond 6 dp rather than rounding up', () => {
      expect(formatAmount(new Money('1.9999999'))).toBe('1.999999');
    });
  });

  it('does decimal arithmetic exactly (0.1 + 0.2 = 0.3)', () => {
    expect(new Money('0.1').plus('0.2').toFixed()).toBe('0.3');
  });

  describe('conversion', () => {
    it('applies the USD quotes in one expression and rounds once', () => {
      // 15300 NGN at 1500/USD is exactly 10.2 USD.
      expect(
        convertViaUsd(
          new Money('15300'),
          new Money('1500'),
          new Money('1'),
        ).toFixed(),
      ).toBe('10.2');
    });

    it('rounds the destination down', () => {
      expect(
        convertViaUsd(
          new Money('1'),
          new Money('1500'),
          new Money('1'),
        ).toFixed(),
      ).toBe('0.000666');
      expect(roundDownToScale(new Money('0.9999999')).toFixed()).toBe(
        '0.999999',
      );
    });

    it('derives cross rates through USD, quantised to 18 dp', () => {
      expect(formatRate(crossRate(new Money('1500'), new Money('15')))).toBe(
        '0.01',
      );
      expect(formatRate(crossRate(new Money('1500'), new Money('1')))).toBe(
        '0.000666666666666666',
      );
      expect(
        formatRate(crossRate(new Money('0.92'), new Money('603.48044'))),
      ).toBe('655.957');
    });

    it('rejects non-positive rates', () => {
      expect(() => crossRate(new Money(0), new Money(1))).toThrow(RangeError);
      expect(() =>
        convertViaUsd(new Money(1), new Money(1), new Money(-1)),
      ).toThrow(RangeError);
    });
  });

  describe('moneyTransformer', () => {
    it('round-trips NUMERIC strings without a JS number in between', () => {
      const fromDb = moneyTransformer.from(
        '123456789012345678.123456',
      ) as Money;
      expect(fromDb.toFixed()).toBe('123456789012345678.123456');
      expect(moneyTransformer.to(fromDb)).toBe('123456789012345678.123456');
      expect(moneyTransformer.to(new Money('1.5'))).toBe('1.500000');
      expect(moneyTransformer.from(null)).toBeNull();
    });
  });
});
