import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReferenceProfileService } from '../reference-profiles/reference-profile.service';

/**
 * Batch-rebuild `reference_profile` rows for every eligible game (has a
 * trusted milestone or a leak snapshot, non-free, not soft-deleted).
 * Idempotent: existing rows are upserted, ineligible rows are removed.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/rebuild-reference-profiles.ts [--limit N]
 */
function parseArgs(): { limit: number | undefined } {
  const args = process.argv.slice(2);
  const i = args.indexOf('--limit');
  const limit = i >= 0 ? Number(args[i + 1]) : undefined;
  return { limit: Number.isFinite(limit) ? limit : undefined };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('RebuildReferenceProfiles');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const service = app.get(ReferenceProfileService);
  try {
    const result = await service.rebuildAll(opts.limit);
    logger.log(
      `Done. processed=${result.processed} persisted=${result.persisted} dropped=${result.dropped}`,
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
