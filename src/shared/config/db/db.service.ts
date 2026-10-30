import { Injectable } from '@nestjs/common';
import { DataSourceOptions } from 'typeorm';
import { ENTITIES } from '../../global/model/entities';
import { MIGRATIONS } from '../../../migrations';
import { DbConfig } from '../env/app-config';
import { SnakeNamingStrategy } from './snake-naming.strategy';

@Injectable()
export class DbService {
  public static getDbConfigData(db: DbConfig): DataSourceOptions {
    return {
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.user,
      password: db.password,
      database: db.name,
      entities: ENTITIES,
      migrations: MIGRATIONS,
      migrationsTableName: 'migrations',
      migrationsRun: db.runMigrations,
      migrationsTransactionMode: 'each',
      // The schema is owned by hand-written migrations, never by entity sync.
      synchronize: false,
      namingStrategy: new SnakeNamingStrategy(),
      logging: db.logging,
      ssl: db.ssl ? { rejectUnauthorized: false } : false,
      extra: { max: db.poolSize },
    };
  }
}
