import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';

/**
 * One-off runner for the incremental Steam/PS backfill (CCU + reviews +
 * followers + console store ratings). Same logic as the admin dashboard
 * button, but awaited to completion so it can be scoped to recently-added
 * games and its summary printed.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-missing.ts [--since-days <n>]
 *
 * With no flag it processes every non-free game still missing history.
 * `--since-days 1` restricts it to games created in the last 24h (e.g. the
 * batch just added).
 */

function parseSinceDays(): number | null {
  const args = process.argv.slice(2);
  const i = args.indexOf('--since-days');
  if (i < 0) return null;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillMissing');
  const sinceDays = parseSinceDays();
  const createdAfter =
    sinceDays != null
      ? new Date(Date.now() - sinceDays * 24 * 3600 * 1000)
      : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingestion = app.get(IngestionService);

  logger.log(
    createdAfter
      ? `Backfilling games created after ${createdAfter.toISOString()}…`
      : 'Backfilling every game still missing history…',
  );

  try {
    const result = await ingestion.runBackfillMissing({ createdAfter });
    const { tasks } = result;
    logger.log(
      `Queued ${result.games} game(s) — ` +
        `ccu=${tasks.ccu} reviews=${tasks.reviews} ` +
        `followers=${tasks.followers} ratings=${tasks.ratings}. See logs above.`,
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
