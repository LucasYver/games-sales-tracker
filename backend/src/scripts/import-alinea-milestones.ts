import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, In, Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { Milestone } from '../entities/milestone.entity';
import { Platform, SalesSource } from '../entities/enums';

/**
 * One-off import of Alinea Analytics ("The Alinea Insight" Substack) sales
 * estimates from `alinea-game-sales.csv` into the `milestone` table.
 *
 * Each CSV row is a cumulative units-sold total for a game at the article's
 * snapshot date. Rows are imported as MEDIA milestones flagged `isEstimate`
 * (third-party analyst estimates), scoped to the CSV platform.
 *
 * Matching CSV game names to `game` rows: exact (case-insensitive) first,
 * then pg_trgm similarity above `--min-similarity`. Unmatched names are
 * reported, never guessed.
 *
 * Idempotent: skips candidates whose fingerprint
 * (gameId, source, sourceUrl, units, reportedAt) already exists (including
 * admin-rejected rows, which are never resurrected). Pre-release figures are
 * dropped, mirroring the ingestion pipeline.
 *
 * DRY-RUN by default. Pass `--commit` to write.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/import-alinea-milestones.ts \
 *     [--file <path>] [--min-similarity <0..1>] [--commit]
 */

interface CliOptions {
  file: string;
  commit: boolean;
  unmatchedOut: string | null;
}

interface CsvRow {
  game: string;
  platform: string;
  metricScope: string;
  copiesSold: string;
  releaseDate: string;
  asOfDate: string;
  sourceUrl: string;
  notes: string;
  raw: string;
}

interface GameRow {
  gameId: string;
  name: string;
  releaseDate: Date | null;
}

interface GameMatch extends GameRow {
  // The matched name differed from the raw CSV name (diacritics, roman
  // numerals, punctuation) — surfaced in the report for manual sanity check.
  renamed: boolean;
}

const CSV_COLUMNS = 11;

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    file: get('--file') ?? resolve(__dirname, '../../../alinea-game-sales.csv'),
    commit: args.includes('--commit'),
    unmatchedOut: get('--unmatched-out') ?? null,
  };
}

// The CSV is written with no embedded commas in any field (enforced at
// generation), so we split on the first 10 commas and treat the remainder as
// the free-text `notes` column.
function parseCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  lines.shift(); // header
  const rows: CsvRow[] = [];
  for (const line of lines) {
    const parts: string[] = [];
    let rest = line;
    for (let i = 0; i < CSV_COLUMNS - 1; i++) {
      const idx = rest.indexOf(',');
      parts.push(rest.slice(0, idx));
      rest = rest.slice(idx + 1);
    }
    parts.push(rest);
    rows.push({
      game: parts[0],
      platform: parts[1],
      metricScope: parts[2],
      copiesSold: parts[3],
      releaseDate: parts[6],
      asOfDate: parts[8],
      sourceUrl: parts[9],
      notes: parts[10],
      raw: line,
    });
  }
  return rows;
}

function mapPlatform(csvPlatform: string): Platform | null {
  const p = csvPlatform.trim();
  if (p.startsWith('all')) return Platform.GLOBAL;
  if (p === 'Steam') return Platform.PC;
  if (p === 'Xbox') return Platform.XBOX;
  if (p === 'Switch' || p === 'Switch 2') return Platform.SWITCH;
  if (p === 'PS5' || p === 'PS4' || p === 'PlayStation')
    return Platform.PLAYSTATION;
  return null; // "console" and anything unexpected
}

function fingerprint(r: {
  gameId: string;
  sourceUrl: string | null;
  units: number;
  reportedAt: Date | null;
}): string {
  return [
    r.gameId,
    SalesSource.MEDIA,
    r.sourceUrl ?? '',
    r.units,
    r.reportedAt ? r.reportedAt.getTime() : '',
  ].join('|');
}

const ROMAN_TO_ARABIC: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
};

/**
 * Normalize a game title for exact matching while PRESERVING sequel
 * numbering (so "Subnautica 2" never collapses onto "Subnautica"). Folds
 * diacritics, strips trademark symbols and punctuation, and unifies roman
 * numerals with their arabic form ("Part II" == "Part 2", "Schedule I" ==
 * "Schedule 1"). Deliberately does NOT strip edition/remaster suffixes:
 * those denote distinct SKUs and must not be conflated.
 */
function normalizeName(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return base
    .split(/\s+/)
    .map((t) => ROMAN_TO_ARABIC[t] ?? t)
    .join(' ');
}

/**
 * Build a normalized-name -> games index. A key mapping to more than one
 * game is ambiguous and excluded from matching (reported instead).
 */
function buildGameIndex(games: GameRow[]): Map<string, GameRow[]> {
  const index = new Map<string, GameRow[]>();
  for (const g of games) {
    const key = normalizeName(g.name);
    const bucket = index.get(key);
    if (bucket) bucket.push(g);
    else index.set(key, [g]);
  }
  return index;
}

function resolveGame(
  csvName: string,
  index: Map<string, GameRow[]>,
): GameMatch | null | 'ambiguous' {
  const bucket = index.get(normalizeName(csvName));
  if (!bucket) return null;
  if (bucket.length > 1) return 'ambiguous';
  const g = bucket[0];
  return { ...g, renamed: g.name !== csvName };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const logger = new Logger('ImportAlineaMilestones');

  const csvRows = parseCsv(opts.file);
  logger.log(
    `Parsed ${csvRows.length} CSV rows from ${opts.file} ` +
      `(commit=${opts.commit}).`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);
  const milestones: Repository<Milestone> =
    dataSource.getRepository(Milestone);

  const games = await dataSource.query<
    Array<{ id: string; name: string; releaseDate: Date | null }>
  >(
    `SELECT id, name, "releaseDate" FROM game WHERE "deletedAt" IS NULL`,
  );
  const gameIndex = buildGameIndex(
    games.map((g) => ({
      gameId: g.id,
      name: g.name,
      releaseDate: g.releaseDate,
    })),
  );
  logger.log(`Indexed ${games.length} games for normalized-name matching.`);

  const stats = {
    inserted: 0,
    dupSkipped: 0,
    preRelease: 0,
    badPlatform: 0,
    unmatched: 0,
  };
  const matchCache = new Map<string, GameMatch | null | 'ambiguous'>();
  const unmatchedNames = new Map<string, number>();
  const ambiguousNames = new Set<string>();
  const unmatchedRows: string[] = [];
  const renamedMatches: string[] = [];
  const candidates: Milestone[] = [];
  const seen = new Set<string>();

  try {
    for (const row of csvRows) {
      const platform = mapPlatform(row.platform);
      if (!platform) {
        stats.badPlatform++;
        continue;
      }
      const units = parseInt(row.copiesSold, 10);
      if (!Number.isFinite(units) || units <= 0) {
        stats.badPlatform++;
        continue;
      }

      if (!matchCache.has(row.game)) {
        matchCache.set(row.game, resolveGame(row.game, gameIndex));
      }
      const match = matchCache.get(row.game);
      if (match === 'ambiguous') {
        stats.unmatched++;
        ambiguousNames.add(row.game);
        unmatchedNames.set(row.game, (unmatchedNames.get(row.game) ?? 0) + 1);
        unmatchedRows.push(row.raw);
        continue;
      }
      if (!match) {
        stats.unmatched++;
        unmatchedNames.set(row.game, (unmatchedNames.get(row.game) ?? 0) + 1);
        unmatchedRows.push(row.raw);
        continue;
      }
      if (match.renamed) {
        renamedMatches.push(`"${row.game}" -> "${match.name}"`);
      }

      const reportedAt = new Date(`${row.asOfDate}T00:00:00.000Z`);
      if (
        match.releaseDate &&
        reportedAt.getTime() < new Date(match.releaseDate).getTime()
      ) {
        stats.preRelease++;
        continue;
      }

      const candidate = milestones.create({
        gameId: match.gameId,
        source: SalesSource.MEDIA,
        units,
        platform,
        isEstimate: true,
        isEngagement: false,
        confidenceScore: null,
        publisher: null,
        sourceUrl: row.sourceUrl || null,
        note:
          `${row.notes}`.trim() +
          ` [Alinea Insight; scope=${row.metricScope}; csvPlatform=${row.platform}]`,
        reportedAt,
      });
      const fp = fingerprint(candidate);
      if (seen.has(fp)) {
        stats.dupSkipped++;
        continue;
      }
      seen.add(fp);
      candidates.push(candidate);
    }

    // Dedupe against existing milestones (incl. rejected) for the matched games.
    const gameIds = [...new Set(candidates.map((c) => c.gameId))];
    const existingFps = new Set<string>();
    if (gameIds.length > 0) {
      const existing = await milestones.find({
        where: { gameId: In(gameIds), source: SalesSource.MEDIA },
        select: { gameId: true, sourceUrl: true, units: true, reportedAt: true },
        withDeleted: true,
      });
      for (const e of existing) existingFps.add(fingerprint(e));
    }
    const toInsert = candidates.filter((c) => {
      if (existingFps.has(fingerprint(c))) {
        stats.dupSkipped++;
        return false;
      }
      return true;
    });

    const matchedGames = [...matchCache.values()].filter(
      (v) => v && v !== 'ambiguous',
    ).length;

    logger.log('--- Match report ---');
    logger.log(
      `Distinct CSV games: ${matchCache.size} | matched: ${matchedGames} | ` +
        `unmatched: ${unmatchedNames.size} (of which ambiguous: ${ambiguousNames.size})`,
    );
    if (renamedMatches.length > 0) {
      const unique = [...new Set(renamedMatches)];
      logger.log(`Normalized matches (${unique.length}):`);
      for (const m of unique) logger.log(`  ${m}`);
    }
    if (unmatchedNames.size > 0) {
      logger.log(`Unmatched games (${unmatchedNames.size}):`);
      for (const [n, c] of [...unmatchedNames.entries()].sort(
        (a, b) => b[1] - a[1],
      )) {
        logger.log(`  ${n} (${c} row(s))${ambiguousNames.has(n) ? ' [ambiguous]' : ''}`);
      }
    }
    logger.log('--- Row stats ---');
    logger.log(
      `to insert: ${toInsert.length} | dup skipped: ${stats.dupSkipped} | ` +
        `pre-release skipped: ${stats.preRelease} | ` +
        `bad platform/units skipped: ${stats.badPlatform} | ` +
        `unmatched rows: ${stats.unmatched}`,
    );

    if (opts.unmatchedOut) {
      const header = readFileSync(opts.file, 'utf8').split(/\r?\n/)[0];
      writeFileSync(
        opts.unmatchedOut,
        [header, ...unmatchedRows].join('\n') + '\n',
      );
      logger.log(
        `Wrote ${unmatchedRows.length} unmatched row(s) to ${opts.unmatchedOut}.`,
      );
    }

    if (opts.commit) {
      await milestones.save(toInsert, { chunk: 200 });
      stats.inserted = toInsert.length;
      logger.log(`COMMITTED ${stats.inserted} milestone(s).`);
    } else {
      logger.log('DRY-RUN: nothing written. Re-run with --commit to persist.');
    }
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
