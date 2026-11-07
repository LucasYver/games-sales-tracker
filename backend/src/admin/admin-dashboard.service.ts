import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CatalogTier,
  Platform,
  SalesSource,
  type Agreement,
} from '../entities';
import { ESTIMATE_MIN_RELEASE } from '../games/estimate-scope';

const WEEKS_SHOWN = 12;
const YEARS_SHOWN = 5;
const GENRE_MIN_COMPARISONS = 15;
const GENRES_SHOWN = 8;
const DIVERGENCES_SHOWN = 10;

// Platforms whose coverage is shown. GLOBAL is measured against every paid
// game; the others against the games that list that platform.
const COVERAGE_PLATFORMS = [
  Platform.GLOBAL,
  Platform.PC,
  Platform.PLAYSTATION,
  Platform.XBOX,
  Platform.SWITCH,
] as const;

// Buckets of `estimate / declared`. Bounds are exclusive below, inclusive above.
const RATIO_BUCKETS: Array<{ label: string; max: number }> = [
  { label: '< ×0.25', max: 0.25 },
  { label: '×0.25–0.5', max: 0.5 },
  { label: '×0.5–0.67', max: 0.67 },
  { label: '×0.67–1.5', max: 1.5 },
  { label: '×1.5–2', max: 2 },
  { label: '×2–4', max: 4 },
  { label: '> ×4', max: Infinity },
];

export interface AdminDashboardOverview {
  games: {
    total: number;
    core: number;
    addedLast7d: number;
    withSales: number;
    withSalesAddedLast7d: number;
    estimated: number;
  };
  milestones: {
    total: number;
    addedLast7d: number;
    undated: number;
    rejected: number;
    bySource: Record<SalesSource, number>;
  };
  /** Oldest week first. `weekStart` is a Monday (UTC). */
  weeklyMilestones: Array<{
    weekStart: string;
    bySource: Record<SalesSource, number>;
  }>;
  /** Released, paid CORE games with at least one sales milestone. */
  coreCoverageByYear: Array<{
    label: string;
    games: number;
    withMilestone: number;
  }>;
  platformCoverage: Array<{
    platform: Platform;
    games: number;
    withMilestone: number;
  }>;
}

export interface AdminDashboardQuality {
  /** Game × platform pairs with both an estimate and a declared figure. */
  comparisons: number;
  /** Median of max(ratio, 1/ratio): how far off we are, either way. */
  medianFactor: number | null;
  /** Median of the raw ratio: above 1 the model overestimates. */
  medianRatio: number | null;
  withinFactor1_5: number;
  agreement: Record<Agreement, number>;
  histogram: Array<{ label: string; count: number }>;
  byGenre: Array<{
    genre: string;
    comparisons: number;
    medianFactor: number;
    medianRatio: number;
  }>;
  divergences: Array<{
    gameId: string;
    name: string;
    platform: Platform;
    declaredUnits: number;
    estimatedUnits: number;
    ratio: number;
    agreement: Agreement;
  }>;
}

function emptyBySource(): Record<SalesSource, number> {
  return Object.fromEntries(
    Object.values(SalesSource).map((s) => [s, 0]),
  ) as Record<SalesSource, number>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function factorOf(ratio: number): number {
  return ratio >= 1 ? ratio : 1 / ratio;
}

/** Monday 00:00 UTC of the week holding `date`, as Postgres `date_trunc('week')`. */
function weekStartUtc(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

// "Milestone" in these queries means a sales figure: not rejected and not an
// engagement count (players reached, subscriptions).
const SALES_MILESTONE = `m."rejectedAt" IS NULL AND m."isEngagement" = false`;

/**
 * Read-only figures for the admin dashboard: how much data we hold, and how
 * close the estimates land to declared figures. Cron progress lives on the
 * crons page (`AdminService.stats`).
 */
@Injectable()
export class AdminDashboardService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async overview(): Promise<AdminDashboardOverview> {
    const firstWeek = weekStartUtc(new Date());
    firstWeek.setUTCDate(firstWeek.getUTCDate() - 7 * (WEEKS_SHOWN - 1));

    const [
      games,
      withSales,
      milestones,
      bySource,
      estimated,
      weekly,
      years,
      platforms,
    ] = await Promise.all([
      this.db.query<Array<{ total: string; core: string; added: string }>>(
        `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE "catalogTier" = $1) AS core,
                  COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days') AS added
           FROM game WHERE "deletedAt" IS NULL`,
        [CatalogTier.CORE],
      ),
      this.db.query<Array<{ total: string; added: string }>>(
        `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE first_at >= now() - interval '7 days') AS added
           FROM (
             SELECT m."gameId", MIN(m."capturedAt") AS first_at
             FROM milestone m
             JOIN game g ON g.id = m."gameId" AND g."deletedAt" IS NULL
             WHERE ${SALES_MILESTONE}
             GROUP BY m."gameId"
           ) t`,
      ),
      this.db.query<
        Array<{
          total: string;
          added: string;
          undated: string;
          rejected: string;
        }>
      >(
        `SELECT COUNT(*) FILTER (WHERE "rejectedAt" IS NULL) AS total,
                  COUNT(*) FILTER (
                    WHERE "rejectedAt" IS NULL
                      AND "capturedAt" >= now() - interval '7 days'
                  ) AS added,
                  COUNT(*) FILTER (
                    WHERE "rejectedAt" IS NULL AND "reportedAt" IS NULL
                  ) AS undated,
                  COUNT(*) FILTER (WHERE "rejectedAt" IS NOT NULL) AS rejected
           FROM milestone`,
      ),
      this.db.query<Array<{ source: SalesSource; c: string }>>(
        `SELECT source, COUNT(*) AS c FROM milestone
           WHERE "rejectedAt" IS NULL GROUP BY source`,
      ),
      // Same scope as the public site: released from 2017 on, or undated.
      this.db.query<Array<{ c: string }>>(
        `SELECT COUNT(DISTINCT e."gameId") AS c
           FROM sales_estimate e
           JOIN game g ON g.id = e."gameId"
           WHERE g."deletedAt" IS NULL
             AND (g."releaseDate" IS NULL OR g."releaseDate" >= $1)`,
        [ESTIMATE_MIN_RELEASE],
      ),
      // capturedAt is a UTC timestamp without time zone.
      this.db.query<Array<{ week: string; source: SalesSource; c: string }>>(
        `SELECT to_char(date_trunc('week', "capturedAt"), 'YYYY-MM-DD') AS week,
                  source, COUNT(*) AS c
           FROM milestone
           WHERE "rejectedAt" IS NULL AND "capturedAt" >= $1
           GROUP BY 1, 2`,
        [firstWeek],
      ),
      this.db.query<Array<{ year: number; games: string; covered: string }>>(
        `SELECT EXTRACT(YEAR FROM g."releaseDate")::int AS year,
                  COUNT(*) AS games,
                  COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM milestone m
                    WHERE m."gameId" = g.id AND ${SALES_MILESTONE}
                  )) AS covered
           FROM game g
           WHERE g."deletedAt" IS NULL
             AND g."isFree" = false
             AND g."catalogTier" = $1
             AND g."releaseDate" <= now()
           GROUP BY 1`,
        [CatalogTier.CORE],
      ),
      this.db.query<
        Array<{ platform: Platform; games: string; covered: string }>
      >(
        `SELECT p.platform,
                  COUNT(*) AS games,
                  COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM milestone m
                    WHERE m."gameId" = g.id
                      AND m.platform::text = p.platform
                      AND ${SALES_MILESTONE}
                  )) AS covered
           FROM game g
           CROSS JOIN unnest($1::text[]) AS p(platform)
           WHERE g."deletedAt" IS NULL
             AND g."isFree" = false
             AND (p.platform = $2 OR g.platforms::text[] @> ARRAY[p.platform])
           GROUP BY p.platform`,
        [COVERAGE_PLATFORMS, Platform.GLOBAL],
      ),
    ]);

    const sourceTotals = emptyBySource();
    for (const row of bySource) sourceTotals[row.source] = Number(row.c);

    const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => {
      const start = new Date(firstWeek);
      start.setUTCDate(start.getUTCDate() + 7 * i);
      return { weekStart: start.toISOString(), bySource: emptyBySource() };
    });
    const weekIndex = new Map(
      weeks.map((w, i) => [w.weekStart.slice(0, 10), i]),
    );
    for (const row of weekly) {
      const i = weekIndex.get(row.week);
      if (i !== undefined) weeks[i].bySource[row.source] += Number(row.c);
    }

    const currentYear = new Date().getUTCFullYear();
    const yearBuckets = Array.from({ length: YEARS_SHOWN }, (_, i) => ({
      label: String(currentYear - i),
      games: 0,
      withMilestone: 0,
    }));
    const earlier = { label: 'Earlier', games: 0, withMilestone: 0 };
    for (const row of years) {
      const offset = currentYear - row.year;
      const bucket =
        offset >= 0 && offset < YEARS_SHOWN ? yearBuckets[offset] : earlier;
      bucket.games += Number(row.games);
      bucket.withMilestone += Number(row.covered);
    }

    const platformRows = new Map(platforms.map((r) => [r.platform, r]));

    return {
      games: {
        total: Number(games[0]?.total ?? 0),
        core: Number(games[0]?.core ?? 0),
        addedLast7d: Number(games[0]?.added ?? 0),
        withSales: Number(withSales[0]?.total ?? 0),
        withSalesAddedLast7d: Number(withSales[0]?.added ?? 0),
        estimated: Number(estimated[0]?.c ?? 0),
      },
      milestones: {
        total: Number(milestones[0]?.total ?? 0),
        addedLast7d: Number(milestones[0]?.added ?? 0),
        undated: Number(milestones[0]?.undated ?? 0),
        rejected: Number(milestones[0]?.rejected ?? 0),
        bySource: sourceTotals,
      },
      weeklyMilestones: weeks,
      coreCoverageByYear: [...yearBuckets, earlier],
      platformCoverage: COVERAGE_PLATFORMS.map((platform) => ({
        platform,
        games: Number(platformRows.get(platform)?.games ?? 0),
        withMilestone: Number(platformRows.get(platform)?.covered ?? 0),
      })),
    };
  }

  /**
   * Compares each game's latest estimate snapshot with the declared figure it
   * was reconciled against. Games released before 2017 are left out, as on
   * the public site (`estimate-scope-2017`).
   */
  async quality(): Promise<AdminDashboardQuality> {
    const rows = await this.db.query<
      Array<{
        gameId: string;
        name: string;
        genres: string | null;
        platform: Platform;
        ratio: number;
        agreement: Agreement;
        declared: string;
      }>
    >(
      `WITH latest AS (
         SELECT DISTINCT ON (s."gameId") s."gameId", s.reconciliation
         FROM estimate_snapshot s
         ORDER BY s."gameId", s."computedAt" DESC
       )
       SELECT g.id AS "gameId", g.name, g.genres,
              e->>'platform' AS platform,
              (e->>'ratio')::float AS ratio,
              e->>'agreement' AS agreement,
              (e->>'declaredUnits')::bigint AS declared
       FROM latest l
       CROSS JOIN LATERAL jsonb_array_elements(l.reconciliation) e
       JOIN game g ON g.id = l."gameId"
       WHERE g."deletedAt" IS NULL
         AND (g."releaseDate" IS NULL OR g."releaseDate" >= $1)
         AND (e->>'ratio')::float > 0`,
      [ESTIMATE_MIN_RELEASE],
    );

    const factors = rows.map((r) => factorOf(r.ratio));
    const agreement: Record<Agreement, number> = {
      strong: 0,
      weak: 0,
      conflict: 0,
    };
    const histogram = RATIO_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
    const genres = new Map<string, number[]>();

    for (const row of rows) {
      agreement[row.agreement] = (agreement[row.agreement] ?? 0) + 1;
      const bucket = RATIO_BUCKETS.findIndex((b) => row.ratio <= b.max);
      histogram[bucket === -1 ? histogram.length - 1 : bucket].count += 1;
      for (const genre of (row.genres ?? '').split(',')) {
        const name = genre.trim();
        if (!name) continue;
        const list = genres.get(name) ?? [];
        list.push(row.ratio);
        genres.set(name, list);
      }
    }

    const byGenre = [...genres.entries()]
      .filter(([, ratios]) => ratios.length >= GENRE_MIN_COMPARISONS)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, GENRES_SHOWN)
      .map(([genre, ratios]) => ({
        genre,
        comparisons: ratios.length,
        medianFactor: round2(median(ratios.map(factorOf)) ?? 1),
        medianRatio: round2(median(ratios) ?? 1),
      }))
      .sort((a, b) => a.medianFactor - b.medianFactor);

    const divergences = [...rows]
      .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))
      .slice(0, DIVERGENCES_SHOWN)
      .map((r) => ({
        gameId: r.gameId,
        name: r.name,
        platform: r.platform,
        declaredUnits: Number(r.declared),
        estimatedUnits: Math.round(r.ratio * Number(r.declared)),
        ratio: round2(r.ratio),
        agreement: r.agreement,
      }));

    const medianFactor = median(factors);
    const medianRatio = median(rows.map((r) => r.ratio));

    return {
      comparisons: rows.length,
      medianFactor: medianFactor === null ? null : round2(medianFactor),
      medianRatio: medianRatio === null ? null : round2(medianRatio),
      withinFactor1_5: factors.filter((f) => f <= 1.5).length,
      agreement,
      histogram,
      byGenre,
      divergences,
    };
  }
}
