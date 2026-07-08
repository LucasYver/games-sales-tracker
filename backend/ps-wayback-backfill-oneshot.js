#!/usr/bin/env node
/**
 * One-shot script (not wired into the app): backfill historical PS Store
 * rating counts via the Wayback Machine for games whose current reference
 * anchor is dated 2024+ (the window where Sony's rating widget started
 * being server-rendered often enough for Wayback to sometimes catch it).
 *
 * Reads game list from ./ps_backfill_games.tsv (id<TAB>name), one game per line.
 * Writes rows into `signal_snapshot` (source=PS_STORE, metric=PS_RATINGS)
 * with capturedAt set to the ACTUAL Wayback snapshot date, not "now".
 *
 * Usage: node ps-wayback-backfill.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { Pool } = require('pg');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DELAY_MS = 600;
const FROM_DATE = '20240101';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getText(url, opts = {}) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' },
    timeout: 20000,
    responseType: 'text',
    ...opts,
  });
  return data;
}

function psnPortalSlug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’‚‛'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractConceptId(html) {
  const decoded = html
    .replace(/\\u0026quot;/g, '"')
    .replace(/&quot;/g, '"');
  for (const m of decoded.matchAll(/"conceptId":"(\d+)"/g)) {
    if (m[1]) return m[1];
  }
  return null;
}

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function titleMatches(query, found) {
  const q = normalize(query);
  const f = normalize(found);
  if (!q || !f) return false;
  const shorter = q.length < f.length ? q : f;
  return shorter.length >= 4 && (f.startsWith(q) || q.startsWith(f));
}

function extractPsTitle(page) {
  const match = page.match(/<title>([^<]+)<\/title>/);
  if (!match) return null;
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/\b(PS4 & PS5|PS4|PS5)\b/g, '')
    .replace(/[™®]/g, '')
    .trim();
}

function readBalancedObject(html, openIndex) {
  if (html[openIndex] !== '{') return null;
  let depth = 0;
  for (let i = openIndex; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(openIndex, i + 1);
    }
  }
  return null;
}

function extractStarRating(html) {
  const marker = '"starRating":';
  const dataMarker = `${marker}{"__typename":"StarRating"`;
  const start = html.indexOf(dataMarker);
  if (start < 0) return null;
  const block = readBalancedObject(html, start + marker.length);
  if (!block) return null;
  const avg = block.match(/"averageRating":([\d.]+)/);
  const count = block.match(/"totalRatingsCount":(\d+)/);
  if (!avg || !count) return null;
  return { averageRating: Number(avg[1]), ratingCount: Number(count[1]) };
}

async function resolveConceptId(name) {
  // 1. Portal page
  try {
    const slug = psnPortalSlug(name);
    if (slug) {
      const page = await getText(`https://www.playstation.com/en-us/games/${slug}/`);
      const id = extractConceptId(page);
      if (id) return id;
    }
  } catch (_) {}
  await sleep(DELAY_MS);

  // 2. Store search fallback
  try {
    const search = await getText(
      `https://store.playstation.com/en-us/search/${encodeURIComponent(name)}`,
    );
    const productLink = search.match(/\/product\/[A-Z0-9_-]+/);
    if (productLink) {
      await sleep(DELAY_MS);
      const productPage = await getText(
        `https://store.playstation.com/en-us${productLink[0]}`,
      );
      const id = extractConceptId(productPage);
      if (id) return id;
    }
  } catch (_) {}
  return null;
}

async function validateConcept(conceptId, name) {
  try {
    const page = await getText(
      `https://store.playstation.com/en-us/concept/${conceptId}`,
    );
    const title = extractPsTitle(page);
    return title ? titleMatches(name, title) : false;
  } catch (_) {
    return false;
  }
}

async function fetchWaybackTimestamps(conceptId) {
  const cdxUrl =
    `http://web.archive.org/cdx/search/cdx?url=store.playstation.com/en-us/concept/${conceptId}` +
    `&output=json&collapse=timestamp:6&filter=statuscode:200&from=${FROM_DATE}`;
  try {
    const raw = await getText(cdxUrl);
    const data = JSON.parse(raw);
    return data.slice(1).map((row) => row[1]); // row[1] = timestamp
  } catch (_) {
    return [];
  }
}

function parseWaybackTimestamp(ts) {
  // YYYYMMDDHHMMSS -> Date (UTC)
  const y = ts.slice(0, 4),
    mo = ts.slice(4, 6),
    d = ts.slice(6, 8),
    h = ts.slice(8, 10),
    mi = ts.slice(10, 12),
    s = ts.slice(12, 14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

async function main() {
  const tsvPath = '/tmp/ps_remaining.tsv';
  const lines = fs
    .readFileSync(tsvPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const games = lines.map((l) => {
    const [id, name] = l.split('\t');
    return { id, name };
  });

  const connStr = fs
    .readFileSync(path.join(__dirname, '.env'), 'utf-8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL_DIRECT='))
    ?.slice('DATABASE_URL_DIRECT='.length)
    .trim();
  if (!connStr) throw new Error('DATABASE_URL_DIRECT not found in .env');

  // Pool (not a single long-lived Client): Neon drops idle connections after
  // a few minutes, which killed the first run mid-way through with a plain
  // Client. The pool transparently opens a fresh connection per query.
  const pool = new Pool({ connectionString: connStr, max: 3 });
  // Idle clients in the pool can still get dropped by Neon; without this
  // listener that emits an unhandled 'error' event and kills the process.
  pool.on('error', (err) => {
    console.error('[pool] idle client error (ignored):', err.message);
  });
  const client = { query: (...args) => pool.query(...args) };

  let gamesProcessed = 0;
  let gamesResolved = 0;
  let gamesWithData = 0;
  let totalPointsInserted = 0;
  const unresolved = [];

  for (const game of games) {
    gamesProcessed++;
    process.stdout.write(`[${gamesProcessed}/${games.length}] ${game.name} ... `);

    let conceptId;
    try {
      conceptId = await resolveConceptId(game.name);
    } catch (err) {
      console.log(`RESOLVE FAIL (${err.message})`);
      unresolved.push(game.name);
      await sleep(DELAY_MS);
      continue;
    }
    if (!conceptId) {
      console.log('NO CONCEPT ID');
      unresolved.push(game.name);
      await sleep(DELAY_MS);
      continue;
    }
    await sleep(DELAY_MS);

    const valid = await validateConcept(conceptId, game.name);
    if (!valid) {
      console.log(`CONCEPT MISMATCH (${conceptId})`);
      unresolved.push(game.name);
      await sleep(DELAY_MS);
      continue;
    }
    gamesResolved++;
    await sleep(DELAY_MS);

    const timestamps = await fetchWaybackTimestamps(conceptId);
    await sleep(DELAY_MS);

    let pointsForGame = 0;
    for (const ts of timestamps) {
      try {
        const page = await getText(
          `https://web.archive.org/web/${ts}/https://store.playstation.com/en-us/concept/${conceptId}`,
        );
        const rating = extractStarRating(page);
        if (rating && rating.ratingCount > 0) {
          const capturedAt = parseWaybackTimestamp(ts);
          // Skip if a row already exists for this game/metric/date (idempotent re-run).
          const existing = await client.query(
            `SELECT 1 FROM signal_snapshot WHERE "gameId"=$1 AND metric='PS_RATINGS' AND "capturedAt"=$2`,
            [game.id, capturedAt.toISOString()],
          );
          if (existing.rowCount === 0) {
            await client.query(
              `INSERT INTO signal_snapshot (id, "gameId", source, metric, value, "averageRating", "capturedAt")
               VALUES ($1, $2, 'PS_STORE', 'PS_RATINGS', $3, $4, $5)`,
              [
                crypto.randomUUID(),
                game.id,
                rating.ratingCount,
                rating.averageRating,
                capturedAt.toISOString(),
              ],
            );
            pointsForGame++;
            totalPointsInserted++;
          }
        }
      } catch (_) {
        // best-effort: skip a failed snapshot fetch
      }
      await sleep(DELAY_MS);
    }

    if (pointsForGame > 0) gamesWithData++;
    console.log(`OK (concept=${conceptId}, ${timestamps.length} snapshots checked, ${pointsForGame} points inserted)`);
  }

  await pool.end();

  console.log('\n=== PS Wayback backfill summary ===');
  console.log(`Games processed:        ${gamesProcessed}`);
  console.log(`Concept resolved:       ${gamesResolved}`);
  console.log(`Games with new data:    ${gamesWithData}`);
  console.log(`Total points inserted:  ${totalPointsInserted}`);
  console.log(`Unresolved (${unresolved.length}): ${unresolved.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
