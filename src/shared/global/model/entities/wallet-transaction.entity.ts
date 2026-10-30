import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import {
  CurrencyEnum,
  FxSourceEnum,
  TransactionStatusEnum,
  TransactionTypeEnum,
} from '../../enums';
import {
  Money,
  moneyTransformer,
  rateTransformer,
} from '../../../util/money.util';
import { Wallet } from './wallet.entity';

export interface TransactionMetadata {
  note?: string;
}

/** Business-level record of a deposit, swap or transfer. Ledger entries hang off it. */
@Entity('transactions')
export class WalletTransaction {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  reference!: string;

  @Column({
    type: 'enum',
    enum: TransactionTypeEnum,
    enumName: 'transaction_type',
  })
  type!: TransactionTypeEnum;

  @Column({
    type: 'enum',
    enum: TransactionStatusEnum,
    enumName: 'transaction_status',
    default: TransactionStatusEnum.COMPLETED,
  })
  status!: TransactionStatusEnum;

  /** Initiator: the depositing/swapping wallet, or the sender of a transfer. */
  @Column({ type: 'uuid' })
  walletId!: string;

  /** Receiver of a transfer; null for deposits and swaps. */
  @Column({ type: 'uuid', nullable: true })
  counterpartyWalletId!: string | null;

  @Column({ type: 'varchar', length: 10 })
  sourceCurrency!: CurrencyEnum;

  @Column({
    type: 'numeric',
    precision: 30,
    scale: 6,
    transformer: moneyTransformer,
  })
  sourceAmount!: Money;

  @Column({ type: 'varchar', length: 10 })
  destinationCurrency!: CurrencyEnum;

  @Column({
    type: 'numeric',
    precision: 30,
    scale: 6,
    transformer: moneyTransformer,
  })
  destinationAmount!: Money;

  /**
   * Cross rate at 18 dp, for display. The destination amount is computed from
   * the snapshot's USD quotes (fx_snapshot_id) in one expression, so it is exactly
   * reproducible from that snapshot.
   */
  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: 1,
    transformer: rateTransformer,
  })
  fxRate!: Money;

  @Column({ type: 'uuid', nullable: true })
  fxSnapshotId!: string | null;

  @Column({
    type: 'enum',
    enum: FxSourceEnum,
    enumName: 'fx_source',
    nullable: true,
  })
  fxSource!: FxSourceEnum | null;

  @Column({ type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: TransactionMetadata;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'wallet_id' })
  wallet?: Wallet;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'counterparty_wallet_id' })
  counterpartyWallet?: Wallet | null;
}
