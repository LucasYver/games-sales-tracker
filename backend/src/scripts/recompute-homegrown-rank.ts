import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RankService } from '../reference-profiles/rank.service';

/**
 * Recompute the home-grown review-velocity rank over the whole tracked universe
 * and overwrite `game_rank`. Same work as the weekly `recompute-rank` cron, but
 * runnable on demand (and without the Vercel wall-clock cap).
 *
 * Run from backend/:
 *   npx ts-node src/scripts/recompute-homegrown-rank.ts
 *
 * (Read the WHOLE STEAM_REVIEWS series, so it's read-heavy; writes one row per
 * charted game to game_rank.)
 */
async function main(): Promise<void> {
  const logger = new Logger('RecomputeHomegrownRank');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const rank = app.get(RankService);
  try {
    const result = await rank.recomputeAll();
    logger.log(
      `Done: ${result.charted} charted game(s) over ${result.rankedWeeks} ` +
        `week(s) (universe ${result.universe} with reviews).`,
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
