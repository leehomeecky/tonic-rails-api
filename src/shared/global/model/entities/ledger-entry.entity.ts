import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CurrencyEnum, EntryDirectionEnum } from '../../enums';
import { Money, moneyTransformer } from '../../../util/money.util';

/** Append-only double-entry posting. A DB trigger rejects UPDATE and DELETE. */
@Entity('ledger_entries')
export class LedgerEntry {
  /** bigserial; returned by pg as a string. */
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  transactionId!: string;

  @Column({ type: 'uuid' })
  walletId!: string;

  @Column({ type: 'varchar', length: 10 })
  currency!: CurrencyEnum;

  @Column({
    type: 'enum',
    enum: EntryDirectionEnum,
    enumName: 'entry_direction',
  })
  direction!: EntryDirectionEnum;

  @Column({
    type: 'numeric',
    precision: 30,
    scale: 6,
    transformer: moneyTransformer,
  })
  amount!: Money;

  @Column({
    type: 'numeric',
    precision: 30,
    scale: 6,
    transformer: moneyTransformer,
  })
  balanceAfter!: Money;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
