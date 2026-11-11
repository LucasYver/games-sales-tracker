import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { InstantGamingLinksService } from '../ingestion/instant-gaming-links.service';

/**
 * Link every catalog game to its Instant Gaming product page now. Same pass
 * as the end of the daily `game-discovery` cron, run by hand.
 *
 * Run from backend/ (uses the DATABASE_URL in .env):
 *   npm run sync:instant-gaming
 */
async function main(): Promise<void> {
  const logger = new Logger('SyncInstantGamingLinks');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const result = await app.get(InstantGamingLinksService).sync();
    logger.log(JSON.stringify(result));
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
