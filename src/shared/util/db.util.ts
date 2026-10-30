import { DataSource, EntityManager } from 'typeorm';
import { TRANSACTION_RETRY_ATTEMPTS } from '../global/constants';
import { isRetryableTransactionError } from './pg-error.util';

/**
 * Runs raw SQL and always returns the row array, including for
 * UPDATE ... RETURNING (TypeORM's plain query() returns [rows, count] there).
 */
export async function queryRows<T>(
  manager: EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const ownRunner = manager.queryRunner === undefined;
  const runner = manager.queryRunner ?? manager.connection.createQueryRunner();
  try {
    const result = await runner.query(sql, params, true);
    return result.records as T[];
  } finally {
    if (ownRunner) await runner.release();
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One use case = one READ COMMITTED transaction. Deadlocks and serialisation
 * failures are retried with jittered backoff; lock ordering makes them rare.
 */
export async function withTransactionRetry<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
  attempts = TRANSACTION_RETRY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await dataSource.transaction('READ COMMITTED', work);
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) {
        throw error;
      }
      await sleep(20 * 2 ** attempt + Math.floor(Math.random() * 20));
    }
  }
}
