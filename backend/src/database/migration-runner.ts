import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { migrations } from '../db/migrations';

const logger = new Logger('MigrationRunner');

/**
 * 64-bit identifier used with Postgres advisory locks to serialize concurrent
 * migration attempts. Two Vercel cold-starts hitting the same database at the
 * same time would otherwise both try to run pending migrations, race on the
 * `migrations` table and leave the schema in a partial state. We block on
 * `pg_advisory_lock`: the second instance waits until the first releases,
 * then sees the migrations already applied and exits in milliseconds.
 *
 * The value itself is arbitrary; just keep it stable across deploys.
 */
const MIGRATION_LOCK_ID = 902317485;

/**
 * Runs any pending migrations against the *direct* (non-pooled) database URL,
 * guarded by a session-level advisory lock. Called once during application
 * bootstrap before the runtime DataSource (which uses the pooler URL) is
 * exposed to the rest of the app.
 *
 * Why a separate DataSource and not the runtime one?
 *  - Migrations issue DDL (`ALTER TYPE`, `CREATE INDEX`, …) which interacts
 *    badly with transaction-mode pgbouncer-style poolers (Supabase / Neon
 *    `-pooler` URLs). Connections can be rotated mid-flow, dropping prepared
 *    statements and session-scoped locks.
 *  - Migrations run once per cold-start at most, so the overhead of opening a
 *    short-lived dedicated connection is negligible.
 */
export async function runPendingMigrations(opts: {
  url: string;
  isProd: boolean;
}): Promise<void> {
  if (!migrations.length) {
    return;
  }

  const ds = new DataSource({
    type: 'postgres',
    url: opts.url,
    migrations,
    ssl: opts.isProd ? { rejectUnauthorized: false } : false,
  });

  await ds.initialize();

  try {
    const queryRunner = ds.createQueryRunner();
    await queryRunner.connect();
    try {
      logger.log(`Acquiring advisory lock ${MIGRATION_LOCK_ID}…`);
      await queryRunner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

      const applied = await ds.runMigrations({ transaction: 'all' });
      if (applied.length > 0) {
        logger.log(
          `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`,
        );
      } else {
        logger.log('No pending migrations.');
      }
    } finally {
      try {
        await queryRunner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      } catch (err) {
        logger.warn(`Failed to release advisory lock: ${(err as Error).message}`);
      }
      await queryRunner.release();
    }
  } finally {
    await ds.destroy();
  }
}
