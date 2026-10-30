import { SYSTEM_WALLET_IDS } from '../../shared/global/constants';
import {
  CurrencyEnum,
  EntryDirectionEnum,
  ErrorCodeEnum,
  SystemWalletCodeEnum,
} from '../../shared/global/enums';
import { DomainException } from '../../shared/global/errors';
import { Money } from '../../shared/util/money.util';
import { LedgerService } from './ledger.service';
import { Posting, PostingBuilder } from './posting.builder';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const FX_POOL = SYSTEM_WALLET_IDS[SystemWalletCodeEnum.FX_POOL];

function netPerCurrency(postings: Posting[]): Record<string, string> {
  const net: Record<string, Money> = {};
  for (const p of postings) {
    const signed =
      p.direction === EntryDirectionEnum.DEBIT ? p.amount.neg() : p.amount;
    net[p.currency] = (net[p.currency] ?? new Money(0)).plus(signed);
  }
  return Object.fromEntries(
    Object.entries(net).map(([currency, total]) => [currency, total.toFixed()]),
  );
}

describe('PostingBuilder', () => {
  it('deposit: funding account debited, wallet credited', () => {
    const postings = PostingBuilder.deposit(
      USER_A,
      CurrencyEnum.USDx,
      new Money('5'),
    );
    expect(postings).toEqual([
      expect.objectContaining({
        walletId: SYSTEM_WALLET_IDS[SystemWalletCodeEnum.DEPOSIT_FUNDING],
        direction: EntryDirectionEnum.DEBIT,
      }),
      expect.objectContaining({
        walletId: USER_A,
        direction: EntryDirectionEnum.CREDIT,
      }),
    ]);
    expect(netPerCurrency(postings)).toEqual({ USDx: '0' });
  });

  it('same-currency transfer: two entries, no FX pool', () => {
    const postings = PostingBuilder.conversion({
      fromWalletId: USER_A,
      toWalletId: USER_B,
      sourceCurrency: CurrencyEnum.cGHS,
      sourceAmount: new Money('10'),
      destinationCurrency: CurrencyEnum.cGHS,
      destinationAmount: new Money('10'),
    });
    expect(postings).toHaveLength(2);
    expect(postings.some((p) => p.walletId === FX_POOL)).toBe(false);
    expect(netPerCurrency(postings)).toEqual({ cGHS: '0' });
  });

  it('conversion: four entries through the FX pool, balanced per currency', () => {
    const postings = PostingBuilder.conversion({
      fromWalletId: USER_A,
      toWalletId: USER_A,
      sourceCurrency: CurrencyEnum.cNGN,
      sourceAmount: new Money('15300'),
      destinationCurrency: CurrencyEnum.USDx,
      destinationAmount: new Money('10.2'),
    });
    expect(postings).toHaveLength(4);
    expect(postings.filter((p) => p.walletId === FX_POOL)).toHaveLength(2);
    expect(netPerCurrency(postings)).toEqual({ cNGN: '0', USDx: '0' });
  });
});

describe('LedgerService.assertBalanced', () => {
  const ledger = new LedgerService();
  const posting = (
    walletId: string,
    direction: EntryDirectionEnum,
    amount: string,
    currency = CurrencyEnum.USDx,
  ): Posting => ({ walletId, currency, direction, amount: new Money(amount) });

  const expectInvariant = (postings: Posting[]) => {
    try {
      ledger.assertBalanced(postings);
      throw new Error('expected an invariant violation');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).code).toBe(
        ErrorCodeEnum.LEDGER_INVARIANT_VIOLATION,
      );
    }
  };

  it('accepts balanced postings', () => {
    expect(() =>
      ledger.assertBalanced([
        posting(USER_A, EntryDirectionEnum.DEBIT, '1.000001'),
        posting(USER_B, EntryDirectionEnum.CREDIT, '1.000001'),
      ]),
    ).not.toThrow();
  });

  it('rejects postings that do not net to zero', () => {
    expectInvariant([
      posting(USER_A, EntryDirectionEnum.DEBIT, '1'),
      posting(USER_B, EntryDirectionEnum.CREDIT, '1.000001'),
    ]);
  });

  it('rejects postings that balance in total but not per currency', () => {
    expectInvariant([
      posting(USER_A, EntryDirectionEnum.DEBIT, '1', CurrencyEnum.USDx),
      posting(USER_B, EntryDirectionEnum.CREDIT, '1', CurrencyEnum.EURx),
    ]);
  });

  it('rejects zero or negative amounts and single postings', () => {
    expectInvariant([
      posting(USER_A, EntryDirectionEnum.DEBIT, '0'),
      posting(USER_B, EntryDirectionEnum.CREDIT, '0'),
    ]);
    expectInvariant([
      posting(USER_A, EntryDirectionEnum.DEBIT, '-1'),
      posting(USER_B, EntryDirectionEnum.CREDIT, '-1'),
    ]);
    expectInvariant([posting(USER_A, EntryDirectionEnum.DEBIT, '1')]);
  });
});
