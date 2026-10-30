import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { CurrencyEnum, IsoCurrencyEnum } from '../../enums';

@Entity('currencies')
export class Currency {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  code!: CurrencyEnum;

  @Column({ type: 'char', length: 3, unique: true })
  isoCode!: IsoCurrencyEnum;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'smallint' })
  decimals!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
