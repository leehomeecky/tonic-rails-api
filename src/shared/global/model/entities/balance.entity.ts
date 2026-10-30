import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CurrencyEnum } from '../../enums';
import { Money, moneyTransformer } from '../../../util/money.util';
import { Wallet } from './wallet.entity';

/**
 * Materialised projection of ledger_entries per (wallet, currency).
 * Only LedgerService writes here; CHECK (allow_negative OR available >= 0) is the final guard.
 */
@Entity('balances')
export class Balance {
  @PrimaryColumn({ type: 'uuid' })
  walletId!: string;

  @PrimaryColumn({ type: 'varchar', length: 10 })
  currency!: CurrencyEnum;

  @Column({
    type: 'numeric',
    precision: 30,
    scale: 6,
    default: 0,
    transformer: moneyTransformer,
  })
  available!: Money;

  @Column({ type: 'boolean', default: false })
  allowNegative!: boolean;

  @Column({ type: 'integer', default: 0 })
  version!: number;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @ManyToOne(() => Wallet, (wallet) => wallet.balances)
  @JoinColumn({ name: 'wallet_id' })
  wallet?: Wallet;
}
