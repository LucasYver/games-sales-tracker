import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { migrations } from './migrations';

loadEnv();

/**
 * CLI DataSource used by `typeorm` commands (migration:generate / run / revert).
 * Always targets the *direct* (non-pooled) connection: TypeORM DDL relies on
 * session-scoped state (locks, prepared statements, type-cache invalidation)
 * that a transaction-mode pgbouncer/pooler breaks. Set `DATABASE_URL_DIRECT`
 * to a direct connection string when your `DATABASE_URL` points at a pooler;
 * otherwise we fall back to `DATABASE_URL`.
 */
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL (or DATABASE_URL_DIRECT) must be set to run migrations.',
  );
}

export default new DataSource({
  type: 'postgres',
  url,
  entities: [join(__dirname, '..', 'entities', '*.entity.{ts,js}')],
  migrations,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
