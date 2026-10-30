import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hand-written so the database enforces the money invariants itself:
 * CHECK constraints, partial unique indexes and an append-only ledger.
 */
export class InitialSchema1793232000000 implements MigrationInterface {
  name = 'InitialSchema1793232000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);

    await queryRunner.query(
      `CREATE TYPE wallet_type AS ENUM ('USER', 'SYSTEM')`,
    );
    await queryRunner.query(
      `CREATE TYPE transaction_type AS ENUM ('DEPOSIT', 'SWAP', 'TRANSFER')`,
    );
    await queryRunner.query(
      `CREATE TYPE transaction_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE entry_direction AS ENUM ('DEBIT', 'CREDIT')`,
    );
    await queryRunner.query(
      `CREATE TYPE fx_source AS ENUM ('LIVE', 'LAST_KNOWN_GOOD', 'STATIC')`,
    );
    await queryRunner.query(
      `CREATE TYPE idempotency_status AS ENUM ('IN_PROGRESS', 'COMPLETED')`,
    );

    await queryRunner.query(`
      CREATE TABLE currencies (
        code        varchar(10)    PRIMARY KEY,
        iso_code    char(3)        NOT NULL UNIQUE,
        name        varchar(64)    NOT NULL,
        decimals    smallint       NOT NULL CHECK (decimals BETWEEN 0 AND 18),
        is_active   boolean        NOT NULL DEFAULT true,
        created_at  timestamptz(3) NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE wallets (
        id           uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
        type         wallet_type    NOT NULL DEFAULT 'USER',
        email        citext         NULL,
        phone        varchar(20)    NULL,
        system_code  varchar(32)    NULL UNIQUE,
        created_at   timestamptz(3) NOT NULL DEFAULT now(),
        updated_at   timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT chk_wallet_identity CHECK (
          (type = 'USER' AND system_code IS NULL AND ((email IS NOT NULL) <> (phone IS NOT NULL)))
          OR (type = 'SYSTEM' AND system_code IS NOT NULL AND email IS NULL AND phone IS NULL)
        )
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_wallets_email ON wallets (email) WHERE email IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_wallets_phone ON wallets (phone) WHERE phone IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE balances (
        wallet_id       uuid           NOT NULL REFERENCES wallets (id),
        currency        varchar(10)    NOT NULL REFERENCES currencies (code),
        available       numeric(30,6)  NOT NULL DEFAULT 0,
        allow_negative  boolean        NOT NULL DEFAULT false,
        version         integer        NOT NULL DEFAULT 0,
        updated_at      timestamptz(3) NOT NULL DEFAULT now(),
        PRIMARY KEY (wallet_id, currency),
        CONSTRAINT chk_balance_non_negative CHECK (allow_negative OR available >= 0)
      )`);

    await queryRunner.query(`
      CREATE TABLE fx_rate_snapshots (
        id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
        source              fx_source      NOT NULL,
        provider            varchar(64)    NOT NULL,
        usd_rates           jsonb          NOT NULL,
        provider_timestamp  timestamptz(3) NULL,
        fetched_at          timestamptz(3) NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX ix_fx_snapshots_source_fetched ON fx_rate_snapshots (source, fetched_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE transactions (
        id                      uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
        reference               varchar(32)        NOT NULL UNIQUE,
        type                    transaction_type   NOT NULL,
        status                  transaction_status NOT NULL DEFAULT 'COMPLETED',
        wallet_id               uuid               NOT NULL REFERENCES wallets (id),
        counterparty_wallet_id  uuid               NULL REFERENCES wallets (id),
        source_currency         varchar(10)        NOT NULL REFERENCES currencies (code),
        source_amount           numeric(30,6)      NOT NULL,
        destination_currency    varchar(10)        NOT NULL REFERENCES currencies (code),
        destination_amount      numeric(30,6)      NOT NULL,
        fx_rate                 numeric(36,18)     NOT NULL DEFAULT 1,
        fx_snapshot_id          uuid               NULL REFERENCES fx_rate_snapshots (id),
        fx_source               fx_source          NULL,
        idempotency_key         varchar(128)       NOT NULL,
        metadata                jsonb              NOT NULL DEFAULT '{}'::jsonb,
        created_at              timestamptz(3)     NOT NULL DEFAULT now(),
        CONSTRAINT chk_tx_amounts_positive CHECK (source_amount > 0 AND destination_amount > 0),
        CONSTRAINT chk_tx_rate_positive CHECK (fx_rate > 0),
        CONSTRAINT chk_tx_counterparty CHECK ((type = 'TRANSFER') = (counterparty_wallet_id IS NOT NULL)),
        CONSTRAINT chk_tx_no_self_transfer CHECK (counterparty_wallet_id IS DISTINCT FROM wallet_id)
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tx_idempotency ON transactions (wallet_id, type, idempotency_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_tx_wallet_created ON transactions (wallet_id, created_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_tx_counterparty_created ON transactions (counterparty_wallet_id, created_at DESC, id DESC)
       WHERE counterparty_wallet_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE ledger_entries (
        id              bigserial       PRIMARY KEY,
        transaction_id  uuid            NOT NULL REFERENCES transactions (id),
        wallet_id       uuid            NOT NULL,
        currency        varchar(10)     NOT NULL,
        direction       entry_direction NOT NULL,
        amount          numeric(30,6)   NOT NULL CHECK (amount > 0),
        balance_after   numeric(30,6)   NOT NULL,
        created_at      timestamptz(3)  NOT NULL DEFAULT now(),
        FOREIGN KEY (wallet_id, currency) REFERENCES balances (wallet_id, currency)
      )`);
    await queryRunner.query(
      `CREATE INDEX ix_ledger_wallet_created ON ledger_entries (wallet_id, created_at DESC, id DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_ledger_transaction ON ledger_entries (transaction_id)`,
    );
    await queryRunner.query(`
      CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ledger_entries is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER trg_ledger_append_only
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation()`);

    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        scope            varchar(100)       NOT NULL,
        key              varchar(128)       NOT NULL,
        request_hash     char(64)           NOT NULL,
        status           idempotency_status NOT NULL,
        response_status  smallint           NULL,
        response_body    jsonb              NULL,
        transaction_id   uuid               NULL REFERENCES transactions (id),
        created_at       timestamptz(3)     NOT NULL DEFAULT now(),
        expires_at       timestamptz(3)     NOT NULL,
        PRIMARY KEY (scope, key)
      )`);
    await queryRunner.query(
      `CREATE INDEX ix_idempotency_expires ON idempotency_keys (expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE idempotency_keys`);
    await queryRunner.query(
      `DROP TRIGGER trg_ledger_append_only ON ledger_entries`,
    );
    await queryRunner.query(`DROP FUNCTION forbid_ledger_mutation()`);
    await queryRunner.query(`DROP TABLE ledger_entries`);
    await queryRunner.query(`DROP TABLE transactions`);
    await queryRunner.query(`DROP TABLE fx_rate_snapshots`);
    await queryRunner.query(`DROP TABLE balances`);
    await queryRunner.query(`DROP TABLE wallets`);
    await queryRunner.query(`DROP TABLE currencies`);
    await queryRunner.query(`DROP TYPE idempotency_status`);
    await queryRunner.query(`DROP TYPE fx_source`);
    await queryRunner.query(`DROP TYPE entry_direction`);
    await queryRunner.query(`DROP TYPE transaction_status`);
    await queryRunner.query(`DROP TYPE transaction_type`);
    await queryRunner.query(`DROP TYPE wallet_type`);
  }
}
