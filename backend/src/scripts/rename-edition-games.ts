import { readFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { slugify } from '../common/slug';
import { deriveFranchise, deriveLiveService } from '../games/game-features';

/**
 * One-off cleanup (2026-11-14): catalog games that are the base IGDB record
 * but carry the name of a commercial edition, because the Steam app they were
 * created from was renamed to it ("Sekiro™: Shadows Die Twice - GOTY
 * Edition"). Each gets the base game's name, the slug that goes with it, and
 * the features the admin rename derives from the name; the name is locked
 * like an admin rename, and the old slug goes to `game_slug_redirect` so its
 * indexed URL redirects to the new one.
 *
 * Also soft-deletes the edition games still live while their base game was
 * deleted by hand (merge-igdb-editions.ts skips those groups).
 *
 * Usage (from backend/): dry run by default, `--apply` to write.
 *   npx ts-node src/scripts/rename-edition-games.ts [--apply]
 */

const RENAMES: Array<{ slug: string; name: string }> = [
  {
    slug: 'sekiro-shadows-die-twice-goty-edition',
    name: 'Sekiro: Shadows Die Twice',
  },
  { slug: 'tomb-raider-game-of-the-year', name: 'Tomb Raider' },
  { slug: 'control-ultimate-edition', name: 'Control' },
  {
    slug: 'call-of-duty-advanced-warfare-gold-edition',
    name: 'Call of Duty: Advanced Warfare',
  },
  { slug: 'dragon-age-ii-ultimate-edition', name: 'Dragon Age II' },
  {
    slug: 'dying-light-2-stay-human-reloaded-edition',
    name: 'Dying Light 2 Stay Human',
  },
  { slug: 'dead-rising-3-apocalypse-edition', name: 'Dead Rising 3' },
  {
    slug: 'farming-simulator-2013-titanium-edition',
    name: 'Farming Simulator 2013',
  },
  { slug: 'spiritfarer-farewell-edition', name: 'Spiritfarer' },
  { slug: 'trine-2-complete-story', name: 'Trine 2' },
  {
    slug: 'dragon-quest-xi-echoes-of-an-elusive-age-digital-edition-of-light',
    name: 'Dragon Quest XI: Echoes of an Elusive Age',
  },
];

// Edition games whose base game is soft-deleted.
const ORPHAN_EDITIONS = [
  'Anthem: Legion of Dawn Edition',
  'Persona 5 Royal: Launch Edition',
  'Persona 5 Royal: Limited Edition',
  "Rocket League: Collector's Edition",
];

interface GameRow {
  id: string;
  name: string;
  slug: string;
  categories: string | null;
  manualFields: unknown;
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  iterationNumber: number | null;
  liveService: boolean;
}

function loadEnv(): void {
  const raw = readFileSync(resolve(__dirname, '../../.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string') return [];
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  loadEnv();
  setDefaultResultOrder('ipv4first');
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL,
  });
  await db.connect();

  // The redirects table comes with the backend deploy: renaming before it
  // would leave the old URLs on a 404.
  const hasRedirects = (
    await db.query<{ ok: boolean }>(
      `SELECT to_regclass('game_slug_redirect') IS NOT NULL AS ok`,
    )
  ).rows[0].ok;
  if (!hasRedirects) {
    if (apply) throw new Error('game_slug_redirect missing: deploy first');
    console.log('game_slug_redirect missing: redirects not written (dry run)');
  }

  // Every slug, soft-deleted games included: the unique index covers them.
  const taken = new Set<string>(
    (await db.query<{ slug: string }>(`SELECT slug FROM game`)).rows.map(
      (r) => r.slug,
    ),
  );

  await db.query('BEGIN');
  try {
    for (const { slug, name } of RENAMES) {
      const { rows } = await db.query<GameRow>(
        `SELECT id, name, slug, categories, "manualFields", "franchiseSlug",
                "isAnnualIteration", "iterationNumber", "liveService"
           FROM game WHERE slug = $1 AND "deletedAt" IS NULL`,
        [slug],
      );
      const game = rows[0];
      if (!game) {
        console.log(`skip: no live game at "${slug}"`);
        continue;
      }
      const locked = new Set(parseArray(game.manualFields));
      const base = slugify(name) || 'game';
      let next = base;
      for (let n = 2; taken.has(next) && next !== slug; n++) {
        next = `${base}-${n}`;
      }
      taken.add(next);
      const franchise = deriveFranchise(name);
      const liveService = locked.has('liveService')
        ? game.liveService
        : // A simple-array column: comma-separated text.
          deriveLiveService(
            name,
            game.categories ? game.categories.split(',') : null,
          );
      locked.add('name');

      console.log(
        `rename: "${game.name}" -> "${name}"\n` +
          `        /${slug} -> /${next}\n` +
          `        franchise ${game.franchiseSlug ?? '-'} -> ${franchise.franchiseSlug ?? '-'}` +
          `, iteration ${game.iterationNumber ?? '-'} -> ${franchise.iterationNumber ?? '-'}` +
          `, liveService ${game.liveService} -> ${liveService}`,
      );

      await db.query(
        `UPDATE game
            SET name = $2, slug = $3, "franchiseSlug" = $4,
                "isAnnualIteration" = $5, "iterationNumber" = $6,
                "liveService" = $7, "manualFields" = $8, "updatedAt" = now()
          WHERE id = $1`,
        [
          game.id,
          name,
          next,
          franchise.franchiseSlug,
          franchise.isAnnualIteration,
          franchise.iterationNumber,
          liveService,
          [...locked],
        ],
      );
      if (next !== slug && hasRedirects) {
        await db.query(
          `INSERT INTO game_slug_redirect (slug, "gameId") VALUES ($1, $2)
           ON CONFLICT (slug) DO UPDATE SET "gameId" = EXCLUDED."gameId"`,
          [slug, game.id],
        );
      }
    }

    for (const name of ORPHAN_EDITIONS) {
      const { rows } = await db.query<{
        id: string;
        slug: string;
        catalogTier: string;
      }>(
        `SELECT id, slug, "catalogTier" FROM game
          WHERE name = $1 AND "deletedAt" IS NULL`,
        [name],
      );
      if (rows.length !== 1) {
        console.log(`skip: ${rows.length} live game(s) named "${name}"`);
        continue;
      }
      console.log(
        `delete: "${name}" (${rows[0].catalogTier}, /${rows[0].slug})`,
      );
      await db.query(
        `UPDATE game SET "deletedAt" = now(), "updatedAt" = now() WHERE id = $1`,
        [rows[0].id],
      );
    }

    if (apply) {
      await db.query('COMMIT');
      console.log('applied');
    } else {
      await db.query('ROLLBACK');
      console.log('dry run: nothing written (pass --apply)');
    }
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
