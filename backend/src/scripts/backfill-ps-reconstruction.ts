import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { EstimationService } from '../estimation/estimation.service';

/**
 * Catalog-wide backfill of the reconstructed (synthetic) PlayStation ratings
 * curve. For every game that has at least one REAL PS_RATINGS snapshot, it
 * materialises the "day one → first measurement" curve via
 * `EstimationService.reconstructPsCurve` (rows flagged `synthetic = true`).
 *
 * Idempotent: each game's prior synthetic PS rows are dropped and rewritten.
 * Read-only for real data — it never touches real snapshots.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/backfill-ps-reconstruction.ts
 */
async function main(): Promise<void> {
  const logger = new Logger('BackfillPsReconstruction');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const estimation = app.get(EstimationService);

  try {
    const gameIds = (
      await dataSource.query<Array<{ gameId: string }>>(
        `SELECT DISTINCT "gameId"
           FROM signal_snapshot
          WHERE metric = 'PS_RATINGS' AND synthetic = false`,
      )
    ).map((r) => r.gameId);
    logger.log(`Games with real PS ratings: ${gameIds.length}`);

    let written = 0;
    let skipped = 0;
    const skipReasons = new Map<string, number>();
    for (const gameId of gameIds) {
      const result = await estimation.reconstructPsCurve(gameId);
      if (result.pointsWritten > 0) {
        written += 1;
      } else {
        skipped += 1;
        const reason = result.skipped ?? 'unknown';
        skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
      }
    }

    logger.log(
      `Done. curves written=${written} skipped=${skipped} ` +
        `(${[...skipReasons.entries()]
          .map(([r, n]) => `${r}:${n}`)
          .join(' ')})`,
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
