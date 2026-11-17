import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';
import { IngestionStateService } from '../ingestion/ingestion-state.service';

/**
 * Fill the reconstructed PS and Xbox ratings curves (`synthetic = true` rows)
 * for every game with a real console rating, through
 * `IngestionService.rebuildConsoleRatingCurves`. Run on the owner's request
 * only. Afterwards the store-ratings cron builds the curve of games new to the
 * catalog, once each.
 *
 * Idempotent: a game whose stored curve is unchanged is not rewritten. Real
 * snapshots are never touched.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-console-curves.ts [--concurrency 4]
 */
async function main(): Promise<void> {
  const logger = new Logger('BackfillConsoleCurves');
  const args = process.argv.slice(2);
  const i = args.indexOf('--concurrency');
  const concurrency = i >= 0 ? Number(args[i + 1]) : 4;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingestion = app.get(IngestionService);
  const state = app.get(IngestionStateService);

  try {
    const gameIds = (
      await app.get(DataSource).query<Array<{ gameId: string }>>(
        `SELECT DISTINCT "gameId" FROM signal_snapshot
          WHERE metric IN ('PS_RATINGS', 'XBOX_RATINGS') AND NOT synthetic`,
      )
    ).map((r) => r.gameId);
    logger.log(`Games with real console ratings: ${gameIds.length}`);

    let done = 0;
    let points = 0;
    let failed = 0;
    const queue = [...gameIds];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          points += await state.track(id, 'CONSOLE_CURVE', () =>
            ingestion.rebuildConsoleRatingCurves(id),
          );
        } catch (error) {
          failed += 1;
          logger.warn(`${id}: ${error}`);
        }
        done += 1;
        if (done % 250 === 0) {
          logger.log(
            `${done}/${gameIds.length} games, ${points} points written`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    logger.log(
      `Done: ${done} games, ${points} points written, ${failed} failed.`,
    );
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
