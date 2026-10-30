import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { FxSourceEnum } from '../../enums';

/** One provider response (or the static table): units of each ISO currency per 1 USD. */
@Entity('fx_rate_snapshots')
export class FxRateSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: FxSourceEnum, enumName: 'fx_source' })
  source!: FxSourceEnum;

  @Column({ type: 'varchar', length: 64 })
  provider!: string;

  /** Decimal strings keyed by ISO code; never JSON numbers. */
  @Column({ type: 'jsonb' })
  usdRates!: Record<string, string>;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  providerTimestamp!: Date | null;

  @Column({ type: 'timestamptz', precision: 3, default: () => 'now()' })
  fetchedAt!: Date;
}
