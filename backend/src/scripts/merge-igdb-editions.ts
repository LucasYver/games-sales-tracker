import { readFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
import { resolve } from 'node:path';
import axios from 'axios';
import { Client } from 'pg';

/**
 * One-off cleanup: fold IGDB commercial editions ("Deluxe Edition", "GOTY
 * Edition") into their base game.
 *
 * IGDB gives each edition its own record, pointing at the base game through
 * `version_parent`. Before the lookups resolved editions, discovery and the
 * Steam ingest created some of them as catalog games of their own, next to the
 * base game or in its place. For each base game this script:
 *   - keeps one catalog game (CORE first, then the most milestones, a Steam
 *     source, the most signals, the base record itself);
 *   - moves the others' milestones onto it, plus each store source it lacks
 *     with that store's signals and prices, then soft-deletes them;
 *   - points the kept game at the base IGDB record, gives it the base game's
 *     name when the edition was kept, and the shortest slug of the group.
 * A group whose base IGDB id belongs to a soft-deleted game is skipped: that
 * deletion was a choice made by hand.
 * Rereleases IGDB also files as versions (Extended, Anniversary, Director's
 * Cut…) keep their own name. Estimates catch up at their next rebuild.
 *
 * Usage (from backend/): dry run by default, `--apply` to write.
 *   npx ts-node src/scripts/merge-igdb-editions.ts [--apply]
 */

// Different games IGDB still files as a version of another.
const EXCLUDED_EDITION_IDS = new Set<number>([
  132522, // There Is No Game: Jam Edition 2015, a separate free jam game
  26848, // Shovel Knight: Treasure Trove, every campaign; its base is one of them
]);

// A version title naming a rerelease rather than a bundle: the catalog name
// stays, since it is what the product is sold as.
const RERELEASE_TITLE =
  /extended|anniversary|developer'?s cut|director'?s cut|enhanced|definitive|remaster|komplete|history|classic|jam/i;

const STORE_SOURCES = ['STEAM', 'PS_STORE', 'XBOX_STORE', 'TWITCH'];

interface GameRow {
  id: string;
  name: string;
  slug: string;
  igdbId: number | null;
  catalogTier: 'CORE' | 'EXTENDED';
  platforms: string[];
  manualFields: string[];
  deleted: boolean;
}

interface Edition {
  id: number;
  version_title?: string;
  version_parent: { id: number; name: string; slug: string };
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

async function fetchEditions(ids: number[]): Promise<Edition[]> {
  const clientId = process.env.IGDB_CLIENT_ID!;
  const { data: token } = await axios.post<{ access_token: string }>(
    'https://id.twitch.tv/oauth2/token',
    null,
    {
      params: {
        client_id: clientId,
        client_secret: process.env.IGDB_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
    },
  );
  const out: Edition[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const { data } = await axios.post<Edition[]>(
      'https://api.igdb.com/v4/games',
      [
        'fields version_title, version_parent.name, version_parent.slug;',
        `where id = (${chunk.join(',')}) & version_parent != null;`,
        'limit 500;',
      ].join(' '),
      {
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'text/plain',
        },
        timeout: 30000,
      },
    );
    out.push(...data);
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
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

  const games: GameRow[] = (
    await db.query(
      `SELECT id, name, slug, "igdbId", "catalogTier", platforms::text[] AS platforms,
              "manualFields", "deletedAt" IS NOT NULL AS deleted
         FROM game`,
    )
  ).rows.map((r) => ({
    ...r,
    platforms: parseArray(r.platforms),
    manualFields: parseArray(r.manualFields),
  }));
  const active = games.filter((g) => !g.deleted && g.igdbId != null);
  const byIgdb = new Map(
    games.filter((g) => g.igdbId != null).map((g) => [g.igdbId!, g]),
  );

  const editions = (await fetchEditions(active.map((g) => g.igdbId!))).filter(
    (e) => !EXCLUDED_EDITION_IDS.has(e.id),
  );
  const editionById = new Map(editions.map((e) => [e.id, e]));

  // Group the active catalog games by base IGDB game.
  const groups = new Map<number, GameRow[]>();
  for (const e of editions) groups.set(e.version_parent.id, []);
  for (const g of active) {
    const base = editionById.get(g.igdbId!)?.version_parent.id ?? g.igdbId!;
    groups.get(base)?.push(g);
  }

  const counts = new Map<
    string,
    { milestones: number; signals: number; sources: Map<string, string> }
  >();
  const memberIds = [...groups.values()].flat().map((g) => g.id);
  for (const g of memberIds) {
    counts.set(g, { milestones: 0, signals: 0, sources: new Map() });
  }
  for (const r of (
    await db.query(
      `SELECT "gameId", count(*)::int AS n FROM milestone WHERE "gameId" = ANY($1) GROUP BY 1`,
      [memberIds],
    )
  ).rows) {
    counts.get(r.gameId)!.milestones = r.n;
  }
  for (const r of (
    await db.query(
      `SELECT "gameId", count(*)::int AS n FROM signal_snapshot WHERE "gameId" = ANY($1) GROUP BY 1`,
      [memberIds],
    )
  ).rows) {
    counts.get(r.gameId)!.signals = r.n;
  }
  for (const r of (
    await db.query(
      `SELECT "gameId", source::text, "externalId" FROM game_source WHERE "gameId" = ANY($1)`,
      [memberIds],
    )
  ).rows) {
    counts.get(r.gameId)!.sources.set(r.source, r.externalId);
  }

  const rank = (g: GameRow, base: number): number[] => {
    const c = counts.get(g.id)!;
    return [
      g.catalogTier === 'CORE' ? 1 : 0,
      c.milestones,
      c.sources.has('STEAM') ? 1 : 0,
      c.signals,
      g.igdbId === base ? 1 : 0,
    ];
  };
  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  };

  let merged = 0;
  let repointed = 0;
  let skipped = 0;

  for (const [base, members] of groups) {
    if (members.length === 0) continue;
    const sorted = [...members].sort((a, b) =>
      compare(rank(a, base), rank(b, base)),
    );
    const keeper = sorted[0];
    const losers = sorted.slice(1);
    const baseMember = members.find((g) => g.igdbId === base);
    const parent =
      editionById.get(keeper.igdbId!)?.version_parent ??
      editionById.get(losers.find((l) => l.igdbId !== base)?.igdbId ?? -1)
        ?.version_parent;

    // A soft-deleted game (outside this group) can hold the base IGDB id.
    const holder = byIgdb.get(base);
    if (holder && holder.deleted) {
      console.log(
        `SKIP  "${keeper.name}": base IGDB ${base} is held by soft-deleted "${holder.name}"`,
      );
      skipped++;
      continue;
    }

    const keeperEdition = editionById.get(keeper.igdbId!);
    const keepName =
      keeper.manualFields.includes('name') ||
      (keeperEdition &&
        (RERELEASE_TITLE.test(keeperEdition.version_title ?? '') ||
          RERELEASE_TITLE.test(keeper.name)));
    const newName =
      keeper.igdbId === base || keepName
        ? keeper.name
        : (baseMember?.name ?? parent?.name ?? keeper.name);
    // The shortest slug is the unsuffixed one ("battlefield-4", not
    // "battlefield-4-1" or "…-deluxe-edition").
    const newSlug = members
      .map((g) => g.slug)
      .reduce((a, b) => (b.length < a.length ? b : a));
    const tier = members.some((g) => g.catalogTier === 'CORE')
      ? 'CORE'
      : 'EXTENDED';
    const platforms = [...new Set(members.flatMap((g) => g.platforms))];

    const keeperSources = new Set(counts.get(keeper.id)!.sources.keys());
    const moves: string[] = [];
    for (const l of losers) {
      for (const [source] of counts.get(l.id)!.sources) {
        if (STORE_SOURCES.includes(source) && !keeperSources.has(source)) {
          keeperSources.add(source);
          moves.push(`${source} from "${l.name}"`);
        }
      }
    }

    console.log(
      `${losers.length ? 'MERGE' : 'POINT'} keep "${keeper.name}" [${keeper.catalogTier}, igdb ${keeper.igdbId}]` +
        (newName !== keeper.name ? ` rename -> "${newName}"` : '') +
        (newSlug !== keeper.slug ? ` slug -> ${newSlug}` : '') +
        ` | igdb -> ${base}` +
        (losers.length
          ? ` | drop: ${losers.map((l) => `"${l.name}" [${l.catalogTier}, ${counts.get(l.id)!.milestones} ms]`).join(', ')}`
          : '') +
        (moves.length ? ` | move: ${moves.join(', ')}` : ''),
    );
    if (losers.length) merged++;
    else repointed++;
    if (!apply) continue;

    await db.query('BEGIN');
    try {
      const movedSources = new Set<string>(
        counts.get(keeper.id)!.sources.keys(),
      );
      for (const l of losers) {
        await db.query(
          `UPDATE milestone SET "gameId" = $1 WHERE "gameId" = $2`,
          [keeper.id, l.id],
        );
        for (const [source] of counts.get(l.id)!.sources) {
          if (!STORE_SOURCES.includes(source) || movedSources.has(source))
            continue;
          movedSources.add(source);
          await db.query(
            `UPDATE game_source SET "gameId" = $1 WHERE "gameId" = $2 AND source = $3`,
            [keeper.id, l.id, source],
          );
          for (const table of [
            'signal_snapshot',
            'price_snapshot',
            'achievement_snapshot',
          ]) {
            await db.query(
              `UPDATE ${table} SET "gameId" = $1 WHERE "gameId" = $2 AND source = $3`,
              [keeper.id, l.id, source],
            );
          }
        }
        await db.query(
          `UPDATE reference_profile SET "gameId" = $1 WHERE "gameId" = $2
             AND NOT EXISTS (SELECT 1 FROM reference_profile WHERE "gameId" = $1)`,
          [keeper.id, l.id],
        );
        await db.query(
          `DELETE FROM game_source WHERE "gameId" = $1 AND source = 'IGDB'`,
          [l.id],
        );
        // Free the base id and slug for the kept game.
        await db.query(
          `UPDATE game SET "deletedAt" = now(),
             "igdbId" = CASE WHEN "igdbId" = $2 THEN NULL ELSE "igdbId" END,
             slug = CASE WHEN slug = $3 THEN slug || '-merged-' || left(id::text, 8) ELSE slug END
           WHERE id = $1`,
          [l.id, base, newSlug],
        );
      }
      await db.query(
        `UPDATE game SET "igdbId" = $2, name = $3, slug = $4, "catalogTier" = $5,
           platforms = $6::game_platforms_enum[]
         WHERE id = $1`,
        [keeper.id, base, newName, newSlug, tier, platforms],
      );
      if (parent) {
        await db.query(
          `DELETE FROM game_source WHERE "gameId" = $1 AND source = 'IGDB'`,
          [keeper.id],
        );
        await db.query(
          `INSERT INTO game_source ("gameId", source, "externalId", url)
           VALUES ($1, 'IGDB', $2, $3)`,
          [
            keeper.id,
            String(base),
            `https://www.igdb.com/games/${parent.slug}`,
          ],
        );
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      console.error(`FAILED "${keeper.name}": ${String(error)}`);
    }
  }

  console.log(
    `\n${apply ? 'Applied' : 'Dry run'}: ${merged} merged, ${repointed} repointed, ${skipped} skipped.`,
  );
  await db.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
