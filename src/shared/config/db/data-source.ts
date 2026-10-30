import 'dotenv/config';
import { DataSource } from 'typeorm';
import { DbService } from './db.service';

/** Used by the TypeORM CLI (yarn migration:*); the app itself runs migrations on boot. */
export const AppDataSource = new DataSource(
  DbService.getDbConfigData({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'tonicrails',
    password: process.env.DB_PASSWORD ?? 'tonicrails',
    name: process.env.DB_NAME ?? 'tonicrails',
    ssl: process.env.DB_SSL === 'true',
    runMigrations: false,
    poolSize: 5,
    logging: true,
  }),
);

export default AppDataSource;
