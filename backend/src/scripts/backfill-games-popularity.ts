import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { Game } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';

/**
 * One-shot backfill of Steam followers + top-seller rank from
 * games-popularity.com for tracked (non-free) Steam games.
 *
 * Seeds the multi-year history that the weekly `capture-popularity` cron then
 * keeps fresh. History only reaches the provider's collection floor (~2024-03),
 * NOT launch — pre-2024 games get their recent trajectory only.
 *
 * Run from backend/ (no Vercel wall-clock cap here, unlike the cron):
 *   npx ts-node src/scripts/backfill-games-popularity.ts            # all games
 *   npx ts-node src/scripts/backfill-games-popularity.ts --slug hades   # one game
 *
 * Requires GAMES_POPULARITY_API_KEY in the environment.
 */
async function main(): Promise<void> {
  const logger = new Logger('BackfillGamesPopularity');
  const args = process.argv.slice(2);
  const slugIdx = args.indexOf('--slug');
  const slug = slugIdx >= 0 ? args[slugIdx + 1] : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const ingestion = app.get(IngestionService);

  try {
    if (slug) {
      const dataSource = app.get(DataSource);
      const game = await dataSource
        .getRepository(Game)
        .findOne({ where: { slug } });
      if (!game) {
        logger.error(`No game with slug "${slug}".`);
        return;
      }
      logger.log(`Backfilling "${game.name}" (followers + rank)…`);
      const followers = await ingestion.syncFollowersFromApi(game.id, {
        fullHistory: true,
      });
      const rank = await ingestion.syncTopSellerRankFromApi(game.id, {
        fullHistory: true,
      });
      logger.log(
        `Done: followers ${followers.imported} day(s) ` +
          `(${followers.rangeStart ?? '—'} → ${followers.rangeEnd ?? '—'}), ` +
          `rank ${rank.imported} day(s) ` +
          `(${rank.rangeStart ?? '—'} → ${rank.rangeEnd ?? '—'}).`,
      );
      return;
    }

    logger.log('Starting full games-popularity backfill (followers + rank)…');
    const result = await ingestion.syncAllGamesPopularity({
      fullHistory: true,
    });
    logger.log(
      `Backfill complete: ${result.processed} game(s) processed, ` +
        `${result.followers} with followers, ${result.ranks} with rank, ` +
        `${result.failed} error(s).`,
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
