import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { GamesService } from '../games/games.service';

/**
 * One-off switch to the ML worldwide estimate: rebuilds every estimated game
 * (`GamesService.rebuildEstimateHistory`, the same path as the weekly cron and
 * the admin Rebuild button), so the games where `mlEstimateApplies` move to
 * the new figure together instead of over the cron's week, and every snapshot
 * gets its `estimatedTodayUnits`. Games are taken in id order: after an
 * interruption, resume with `--offset` set to the last logged position.
 *
 * Usage (from backend/, after the deploy that adds `ml-ensemble`):
 *   npm run backfill:ml-estimates -- [--offset <n>] [--limit <n>] [--dry-run]
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (flag: string): number | null => {
    const i = args.indexOf(flag);
    const v = i >= 0 ? Number(args[i + 1]) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const offset = arg('--offset') ?? 0;
  const limit = arg('--limit');
  const dryRun = args.includes('--dry-run');
  const logger = new Logger('BackfillMlEstimates');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const games = app.get(GamesService);

  try {
    const rows = await dataSource.query<
      Array<{ gameId: string; name: string }>
    >(
      `SELECT g.id AS "gameId", g.name
         FROM game g
        WHERE g."deletedAt" IS NULL AND g."isFree" = false
          AND EXISTS (SELECT 1 FROM sales_estimate se WHERE se."gameId" = g.id)
        ORDER BY g.id ASC`,
    );
    const todo = rows.slice(
      offset,
      limit !== null ? offset + limit : undefined,
    );
    logger.log(
      `${rows.length} estimated game(s); rebuilding ${todo.length} from #${offset + 1}.`,
    );
    if (dryRun) return;

    let ok = 0;
    let err = 0;
    for (const [i, { gameId, name }] of todo.entries()) {
      try {
        await games.rebuildEstimateHistory(gameId);
        ok++;
        logger.log(`[${offset + i + 1}/${rows.length}] ${name}: ok`);
      } catch (error) {
        err++;
        logger.warn(`[${offset + i + 1}/${rows.length}] ${name}: ERR ${error}`);
      }
    }
    logger.log(`Done. ok=${ok} err=${err}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
