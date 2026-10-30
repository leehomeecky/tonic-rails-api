import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SystemWalletCodeEnum, WalletTypeEnum } from '../../enums';
import { Balance } from './balance.entity';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: WalletTypeEnum,
    enumName: 'wallet_type',
    default: WalletTypeEnum.USER,
  })
  type!: WalletTypeEnum;

  /** citext: case-insensitive uniqueness enforced by a partial unique index. */
  @Column({ type: 'citext', nullable: true })
  email!: string | null;

  /** E.164, e.g. +2348031234567. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, unique: true })
  systemCode!: SystemWalletCodeEnum | null;

  @OneToMany(() => Balance, (balance) => balance.wallet)
  balances?: Balance[];

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;
}
