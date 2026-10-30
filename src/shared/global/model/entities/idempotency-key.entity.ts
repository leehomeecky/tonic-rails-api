import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { IdempotencyStatusEnum } from '../../enums';

@Entity('idempotency_keys')
export class IdempotencyKey {
  /** `${walletId}:${operation}`: the same key on another wallet is unrelated. */
  @PrimaryColumn({ type: 'varchar', length: 100 })
  scope!: string;

  @PrimaryColumn({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ type: 'char', length: 64 })
  requestHash!: string;

  @Column({
    type: 'enum',
    enum: IdempotencyStatusEnum,
    enumName: 'idempotency_status',
  })
  status!: IdempotencyStatusEnum;

  @Column({ type: 'smallint', nullable: true })
  responseStatus!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  responseBody!: unknown;

  @Column({ type: 'uuid', nullable: true })
  transactionId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ type: 'timestamptz', precision: 3 })
  expiresAt!: Date;
}
