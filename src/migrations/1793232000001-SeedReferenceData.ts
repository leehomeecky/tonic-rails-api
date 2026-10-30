import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  CURRENCY_CODES,
  STATIC_FX_SNAPSHOT_ID,
  STATIC_USD_RATES,
  SUPPORTED_CURRENCIES,
  SYSTEM_WALLET_IDS,
} from '../shared/global/constants';
import { SystemWalletCodeEnum } from '../shared/global/enums';

/** Reference data the API cannot run without; seeded so `docker compose up` needs no extra step. */
export class SeedReferenceData1793232000001 implements MigrationInterface {
  name = 'SeedReferenceData1793232000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const currency of SUPPORTED_CURRENCIES) {
      await queryRunner.query(
        `INSERT INTO currencies (code, iso_code, name, decimals) VALUES ($1, $2, $3, $4)`,
        [currency.code, currency.isoCode, currency.name, currency.decimals],
      );
    }

    for (const code of Object.values(SystemWalletCodeEnum)) {
      const walletId = SYSTEM_WALLET_IDS[code];
      await queryRunner.query(
        `INSERT INTO wallets (id, type, system_code) VALUES ($1, 'SYSTEM', $2)`,
        [walletId, code],
      );
      for (const currency of CURRENCY_CODES) {
        await queryRunner.query(
          `INSERT INTO balances (wallet_id, currency, allow_negative) VALUES ($1, $2, true)`,
          [walletId, currency],
        );
      }
    }

    await queryRunner.query(
      `INSERT INTO fx_rate_snapshots (id, source, provider, usd_rates) VALUES ($1, 'STATIC', 'static', $2)`,
      [STATIC_FX_SNAPSHOT_ID, JSON.stringify(STATIC_USD_RATES)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM fx_rate_snapshots WHERE id = $1`, [
      STATIC_FX_SNAPSHOT_ID,
    ]);
    const systemIds = Object.values(SYSTEM_WALLET_IDS);
    await queryRunner.query(`DELETE FROM balances WHERE wallet_id = ANY($1)`, [
      systemIds,
    ]);
    await queryRunner.query(`DELETE FROM wallets WHERE id = ANY($1)`, [
      systemIds,
    ]);
    await queryRunner.query(`DELETE FROM currencies WHERE code = ANY($1)`, [
      CURRENCY_CODES,
    ]);
  }
}
