import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SYSTEM_WALLET_ID_SET } from '../../shared/global/constants';
import {
  CurrencyEnum,
  EntryDirectionEnum,
  ErrorCodeEnum,
} from '../../shared/global/enums';
import { DomainException } from '../../shared/global/errors';
import { queryRows } from '../../shared/util/db.util';
import { Money, ZERO, formatAmount } from '../../shared/util/money.util';
import { Posting } from './posting.builder';

export interface AppliedEntry extends Posting {
  balanceAfter: Money;
}

const keyOf = (walletId: string, currency: string) => `${walletId}|${currency}`;

/**
 * The only code allowed to change balances. Must run inside the caller's
 * transaction. Lock order is global (user rows, then system rows, each sorted
 * by wallet and currency), so two transactions can never wait on each other in
 * a cycle.
 */
@Injectable()
export class LedgerService {
  async post(
    manager: EntityManager,
    transactionId: string,
    postings: Posting[],
  ): Promise<AppliedEntry[]> {
    this.assertBalanced(postings);

    const ordered = [...postings].sort((a, b) => this.compare(a, b));

    // 1. Lock user balance rows up front. System rows (allow_negative) cannot
    //    fail a debit, so they are locked only by their UPDATE, last.
    const userKeys = [
      ...new Set(
        ordered
          .filter((p) => !SYSTEM_WALLET_ID_SET.has(p.walletId))
          .map((p) => keyOf(p.walletId, p.currency)),
      ),
    ];
    if (userKeys.length) await this.lockUserBalances(manager, userKeys);

    // 2. Apply each posting atomically, in the same global order.
    const applied: AppliedEntry[] = [];
    for (const posting of ordered) {
      const balanceAfter =
        posting.direction === EntryDirectionEnum.DEBIT
          ? await this.debit(manager, posting)
          : await this.credit(manager, posting);
      applied.push({ ...posting, balanceAfter });
    }

    // 3. Append the immutable entries.
    await this.insertEntries(manager, transactionId, applied);
    return applied;
  }

  /** Σ debits must equal Σ credits for every currency, and every amount must be positive. */
  assertBalanced(postings: Posting[]): void {
    if (postings.length < 2) this.invariant('fewer than two postings');

    const net = new Map<CurrencyEnum, Money>();
    for (const { currency, direction, amount } of postings) {
      if (!amount.isFinite() || amount.lte(0)) {
        this.invariant('posting amount must be positive');
      }
      const signed =
        direction === EntryDirectionEnum.DEBIT ? amount.neg() : amount;
      net.set(currency, (net.get(currency) ?? ZERO).plus(signed));
    }
    for (const [currency, total] of net) {
      if (!total.isZero())
        this.invariant(`${currency} postings do not net to zero`);
    }
  }

  private compare(a: Posting, b: Posting): number {
    const aSystem = SYSTEM_WALLET_ID_SET.has(a.walletId) ? 1 : 0;
    const bSystem = SYSTEM_WALLET_ID_SET.has(b.walletId) ? 1 : 0;
    if (aSystem !== bSystem) return aSystem - bSystem;
    // Plain code-unit comparison: deterministic regardless of locale.
    const aKey = keyOf(a.walletId, a.currency);
    const bKey = keyOf(b.walletId, b.currency);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  }

  private async lockUserBalances(
    manager: EntityManager,
    keys: string[],
  ): Promise<void> {
    const walletIds = keys.map((key) => key.split('|')[0]);
    const currencies = keys.map((key) => key.split('|')[1]);
    const rows = await queryRows<{ wallet_id: string }>(
      manager,
      `SELECT b.wallet_id
         FROM balances b
         JOIN unnest($1::uuid[], $2::varchar[]) AS k(wallet_id, currency)
           ON b.wallet_id = k.wallet_id AND b.currency = k.currency
        ORDER BY b.wallet_id, b.currency
          FOR UPDATE OF b`,
      [walletIds, currencies],
    );
    if (rows.length !== keys.length) {
      this.invariant('balance row missing for a posting');
    }
  }

  private async debit(
    manager: EntityManager,
    posting: Posting,
  ): Promise<Money> {
    const amount = posting.amount.toFixed(6);
    const rows = await queryRows<{ available: string }>(
      manager,
      `UPDATE balances
          SET available = available - $1::numeric,
              version = version + 1,
              updated_at = now()
        WHERE wallet_id = $2 AND currency = $3
          AND (allow_negative OR available >= $1::numeric)
      RETURNING available`,
      [amount, posting.walletId, posting.currency],
    );
    if (rows.length === 1) return new Money(rows[0].available);

    const current = await queryRows<{ available: string }>(
      manager,
      `SELECT available FROM balances WHERE wallet_id = $1 AND currency = $2`,
      [posting.walletId, posting.currency],
    );
    if (current.length === 0) this.invariant('balance row missing for a debit');
    const available = formatAmount(new Money(current[0].available));
    const required = formatAmount(posting.amount);
    throw new DomainException(
      ErrorCodeEnum.INSUFFICIENT_FUNDS,
      { currency: posting.currency, available, required },
      `Insufficient ${posting.currency} balance: available ${available}, required ${required}`,
    );
  }

  private async credit(
    manager: EntityManager,
    posting: Posting,
  ): Promise<Money> {
    const rows = await queryRows<{ available: string }>(
      manager,
      `UPDATE balances
          SET available = available + $1::numeric,
              version = version + 1,
              updated_at = now()
        WHERE wallet_id = $2 AND currency = $3
      RETURNING available`,
      [posting.amount.toFixed(6), posting.walletId, posting.currency],
    );
    if (rows.length !== 1) this.invariant('balance row missing for a credit');
    return new Money(rows[0].available);
  }

  private async insertEntries(
    manager: EntityManager,
    transactionId: string,
    entries: AppliedEntry[],
  ): Promise<void> {
    await queryRows(
      manager,
      `INSERT INTO ledger_entries (transaction_id, wallet_id, currency, direction, amount, balance_after)
       SELECT $1, e.wallet_id, e.currency, e.direction::entry_direction, e.amount, e.balance_after
         FROM unnest($2::uuid[], $3::varchar[], $4::text[], $5::numeric[], $6::numeric[])
           AS e(wallet_id, currency, direction, amount, balance_after)`,
      [
        transactionId,
        entries.map((e) => e.walletId),
        entries.map((e) => e.currency),
        entries.map((e) => e.direction),
        entries.map((e) => e.amount.toFixed(6)),
        entries.map((e) => e.balanceAfter.toFixed(6)),
      ],
    );
  }

  private invariant(reason: string): never {
    throw new DomainException(ErrorCodeEnum.LEDGER_INVARIANT_VIOLATION, {
      reason,
    });
  }
}
