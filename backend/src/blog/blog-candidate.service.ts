import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RANKING_MIN_GAMES } from './blog-fact-pack.service';
import type {
  BlogCandidateScore,
  BlogLaunchCandidate,
  BlogNewsCandidate,
  BlogRankingCandidate,
} from './blog.types';

const MS_DAY = 86_400_000;

// News items: worldwide figures of at least this size, collected this recently
// and announced shortly before, that beat what was on file by a real margin.
const NEWS_MIN_UNITS = 1_000_000;
const NEWS_CAPTURE_WINDOW_DAYS = 7;
const NEWS_MAX_AGE_AT_CAPTURE_DAYS = 14;
const NEWS_MIN_RECORD_RATIO = 1.03;
const NEWS_GAME_COOLDOWN_DAYS = 14;

// Launch reports: written a week after release, for games people played.
const LAUNCH_MIN_DAYS = 7;
const LAUNCH_MAX_DAYS = 14;
const LAUNCH_MIN_STEAM_PEAK = 5_000;

const ELIGIBLE_GAME_SQL = `g."isFree" = false
  AND g."deletedAt" IS NULL
  AND g."catalogTier" = 'CORE'`;

// Same test as `isAlineaMilestone` (blog-alinea.ts): keep the two in step.
const ALINEA_SQL = `(
  CONCAT_WS(' ', m.publisher, m.note, m."sourceUrl") ~* '(alinea|rhys\\s+elliott?)'
)`;

interface CandidateRow {
  gameId: string;
  name: string;
  slug: string;
  coverUrl: string | null;
  releaseDate: Date | string | null;
  salesCount: string | number;
  hasOfficial: boolean;
  hasAlinea: boolean;
  hasPlatformSplit: boolean;
  newestHighTrust: Date | string | null;
  newestAny: Date | string | null;
  sourceNames: string | number;
  distinctDates: string | number;
  avgPercentile: string | number | null;
  steamReviews: string | number | null;
}

@Injectable()
export class BlogCandidateService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async list(limit = 40): Promise<BlogCandidateScore[]> {
    const scored = await this.scorePool();
    return scored.slice(0, Math.min(Math.max(limit, 1), 100));
  }

  async pickBest(): Promise<BlogCandidateScore | null> {
    const [top] = await this.scorePool();
    return top ?? null;
  }

  /**
   * New worldwide figures worth a news item, biggest first, at most one per
   * game. Consolidation still has the last word (`buildNewsPack`).
   */
  async newsCandidates(limit = 20): Promise<BlogNewsCandidate[]> {
    const rows = await this.db.query<BlogNewsCandidate[]>(
      `
      SELECT DISTINCT ON (m."gameId")
        m.id AS "milestoneId",
        m."gameId",
        g.name,
        g.slug,
        m.units,
        m.source,
        m."reportedAt",
        m."capturedAt"
      FROM milestone m
      INNER JOIN game g ON g.id = m."gameId"
      WHERE ${ELIGIBLE_GAME_SQL}
        AND m."rejectedAt" IS NULL
        AND m."isEngagement" = false
        AND m.platform = 'GLOBAL'
        AND m.source::text NOT IN ('STEAM_LEAK', 'PLAYSTATION_LEAK')
        AND (m."isEstimate" = false OR ${ALINEA_SQL})
        AND m."sourceUrl" IS NOT NULL
        AND m.units >= $1
        AND m."capturedAt" >= now() - make_interval(days => $2)
        AND m."reportedAt" >= m."capturedAt" - make_interval(days => $3)
        AND m.units > $4::float8 * COALESCE((
          SELECT MAX(p.units) FROM milestone p
          WHERE p."gameId" = m."gameId"
            AND p."rejectedAt" IS NULL
            AND p."isEngagement" = false
            AND p.platform = 'GLOBAL'
            AND p.source::text NOT IN ('STEAM_LEAK', 'PLAYSTATION_LEAK')
            AND p."capturedAt" < m."capturedAt"
        ), 0)
        AND NOT EXISTS (
          SELECT 1 FROM blog_post b
          WHERE b."topicKey" = 'sales-news:' || m.id::text
             OR (b."gameId" = m."gameId"
                 AND b.kind = 'SALES_NEWS'
                 AND b."createdAt" >= now() - make_interval(days => $5))
        )
      ORDER BY m."gameId", m.units DESC
      `,
      [
        NEWS_MIN_UNITS,
        NEWS_CAPTURE_WINDOW_DAYS,
        NEWS_MAX_AGE_AT_CAPTURE_DAYS,
        NEWS_MIN_RECORD_RATIO,
        NEWS_GAME_COOLDOWN_DAYS,
      ],
    );
    return rows
      .map((row) => ({ ...row, units: Number(row.units) }))
      .sort((a, b) => b.units - a.units)
      .slice(0, limit);
  }

  /** Games one to two weeks after release, biggest Steam peak first. */
  async launchCandidates(limit = 20): Promise<BlogLaunchCandidate[]> {
    const rows = await this.db.query<BlogLaunchCandidate[]>(
      `
      SELECT
        g.id AS "gameId",
        g.name,
        g.slug,
        g."releaseDate",
        peak.value AS "steamPeak"
      FROM game g
      CROSS JOIN LATERAL (
        SELECT MAX(s.value) AS value
        FROM signal_snapshot s
        WHERE s."gameId" = g.id
          AND s.metric = 'STEAM_PEAK_CCU'
          AND s.synthetic = false
      ) peak
      WHERE ${ELIGIBLE_GAME_SQL}
        AND g."releaseDate" <= now() - make_interval(days => $1)
        AND g."releaseDate" >= now() - make_interval(days => $2)
        AND peak.value >= $3
        AND NOT EXISTS (
          SELECT 1 FROM blog_post b
          WHERE b."gameId" = g.id AND b.kind = 'LAUNCH_REPORT'
        )
      ORDER BY peak.value DESC
      LIMIT $4
      `,
      [LAUNCH_MIN_DAYS, LAUNCH_MAX_DAYS, LAUNCH_MIN_STEAM_PEAK, limit],
    );
    return rows.map((row) => ({ ...row, steamPeak: Number(row.steamPeak) }));
  }

  /** Publishers and franchises with enough worldwide figures, largest first. */
  async rankingCandidates(limit = 40): Promise<BlogRankingCandidate[]> {
    const rows = await this.db.query<BlogRankingCandidate[]>(
      `
      WITH covered AS (
        SELECT g.id, g."publisherId", g."franchiseSlug"
        FROM game g
        WHERE ${ELIGIBLE_GAME_SQL}
          AND EXISTS (
            SELECT 1 FROM milestone m
            WHERE m."gameId" = g.id
              AND m."rejectedAt" IS NULL
              AND m."isEngagement" = false
              AND m.platform = 'GLOBAL'
              AND m.source::text NOT IN ('STEAM_LEAK', 'PLAYSTATION_LEAK')
              AND (m."isEstimate" = false OR ${ALINEA_SQL})
          )
      ),
      subjects AS (
        SELECT 'publisher' AS "subjectType", p.id::text AS "subjectKey",
               p.name, COUNT(*)::int AS "gameCount"
        FROM covered c
        INNER JOIN publisher p ON p.id = c."publisherId"
        GROUP BY p.id, p.name
        UNION ALL
        SELECT 'franchise', c."franchiseSlug", c."franchiseSlug",
               COUNT(*)::int
        FROM covered c
        WHERE c."franchiseSlug" IS NOT NULL
        GROUP BY c."franchiseSlug"
      )
      SELECT s.*
      FROM subjects s
      WHERE s."gameCount" >= $1
        AND NOT EXISTS (
          SELECT 1 FROM blog_post b
          WHERE b."topicKey" = 'ranking:' || s."subjectType" || ':' || s."subjectKey"
        )
      ORDER BY s."gameCount" DESC, s.name
      LIMIT $2
      `,
      [RANKING_MIN_GAMES, limit],
    );
    return rows;
  }

  private async scorePool(): Promise<BlogCandidateScore[]> {
    const rows = await this.db.query<CandidateRow[]>(
      `
      SELECT
        g.id AS "gameId",
        g.name,
        g.slug,
        g."coverUrl",
        g."releaseDate",
        COUNT(*)::int AS "salesCount",
        BOOL_OR(s.source = 'OFFICIAL') AS "hasOfficial",
        BOOL_OR(s.is_alinea) AS "hasAlinea",
        BOOL_OR(s.platform <> 'GLOBAL') AS "hasPlatformSplit",
        MAX(s.reported) FILTER (
          WHERE s.source IN ('OFFICIAL', 'WIKIPEDIA') OR s.is_alinea
        ) AS "newestHighTrust",
        MAX(s.reported) AS "newestAny",
        COUNT(DISTINCT COALESCE(NULLIF(s.publisher, ''), s.source::text))::int
          AS "sourceNames",
        COUNT(DISTINCT (s.reported)::date)::int AS "distinctDates",
        r."avgPercentile" AS "avgPercentile",
        rev.value AS "steamReviews"
      FROM game g
      INNER JOIN (
        SELECT
          m."gameId",
          m.source,
          m.platform,
          m.publisher,
          m."reportedAt" AS reported,
          ${ALINEA_SQL} AS is_alinea
        FROM milestone m
        WHERE m."rejectedAt" IS NULL
          AND m."isEngagement" = false
          AND m.source::text NOT IN ('STEAM_LEAK', 'PLAYSTATION_LEAK')
          AND (m."isEstimate" = false OR ${ALINEA_SQL})
      ) s ON s."gameId" = g.id
      LEFT JOIN game_rank r ON r."gameId" = g.id
      LEFT JOIN (
        SELECT DISTINCT ON (ss."gameId") ss."gameId", ss.value
        FROM signal_snapshot ss
        INNER JOIN game cg
          ON cg.id = ss."gameId"
         AND cg."catalogTier" = 'CORE'
         AND cg."deletedAt" IS NULL
        WHERE ss.metric = 'STEAM_REVIEWS'
          AND ss.synthetic = false
        ORDER BY ss."gameId", ss."capturedAt" DESC
      ) rev ON rev."gameId" = g.id
      WHERE g."isFree" = false
        AND g."deletedAt" IS NULL
        AND g."catalogTier" = 'CORE'
        AND NOT EXISTS (
          SELECT 1 FROM blog_post b
          WHERE b."gameId" = g.id AND b.kind = 'GAME_SALES_FACTS'
        )
      GROUP BY
        g.id, g.name, g.slug, g."coverUrl", g."releaseDate",
        r."avgPercentile", rev.value
      HAVING COUNT(*) >= 2
        AND BOOL_OR(s.source IN ('OFFICIAL', 'WIKIPEDIA') OR s.is_alinea)
      `,
    );

    const scored = rows.map((row) => this.score(row));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ra = a.steamReviews ?? 0;
      const rb = b.steamReviews ?? 0;
      if (rb !== ra) return rb - ra;
      return a.gameId.localeCompare(b.gameId);
    });
    return scored;
  }

  private score(row: CandidateRow): BlogCandidateScore {
    const salesCount = Number(row.salesCount);
    const steamReviews =
      row.steamReviews == null ? null : Number(row.steamReviews);
    const avgPercentile =
      row.avgPercentile == null ? null : Number(row.avgPercentile);
    const releaseDate = row.releaseDate ? new Date(row.releaseDate) : null;
    const newestHigh = row.newestHighTrust
      ? new Date(row.newestHighTrust).getTime()
      : NaN;
    const newestAny = row.newestAny ? new Date(row.newestAny).getTime() : NaN;
    const now = Date.now();
    const reasons: string[] = [];
    let score = 0;

    if (Number.isFinite(newestHigh)) {
      const ageDays = (now - newestHigh) / MS_DAY;
      if (ageDays <= 90) {
        score += 40;
        reasons.push('Official/Alinea figure in the last 90 days');
      } else if (ageDays <= 365) {
        score += 15;
        reasons.push('Official/Alinea figure in the last year');
      }
    }

    score += Math.min(salesCount, 8) * 5;
    reasons.push(`${salesCount} sourced sales figures`);

    if (row.hasOfficial) {
      score += 10;
      reasons.push('Has an official publisher figure');
    }
    if (row.hasAlinea) {
      score += 8;
      reasons.push('Has an Alinea / Rhys Elliot figure');
    }
    if (row.hasPlatformSplit) {
      score += 8;
      reasons.push('Has a platform-scoped figure');
    }

    let pop = 0;
    if (avgPercentile != null && Number.isFinite(avgPercentile)) {
      pop = Math.round((1 - Math.min(1, Math.max(0, avgPercentile))) * 20);
    } else if (steamReviews && steamReviews > 0) {
      pop = Math.min(20, Math.round(Math.log10(steamReviews) * 5));
    }
    score += pop;
    if (pop > 0) reasons.push(`Popularity +${pop}`);

    if (releaseDate && now - releaseDate.getTime() < 18 * 30 * MS_DAY) {
      score += 5;
      reasons.push('Released in the last 18 months');
    }

    if (Number(row.sourceNames) <= 1 && Number(row.distinctDates) <= 1) {
      score -= 10;
      reasons.push('Thin timeline (single source/date)');
    }

    const popular = pop >= 12 || (steamReviews ?? 0) >= 50_000;
    if (
      Number.isFinite(newestAny) &&
      (now - newestAny) / MS_DAY > 5 * 365 &&
      !popular
    ) {
      score -= 15;
      reasons.push('Last milestone older than 5 years and low popularity');
    }

    return {
      gameId: row.gameId,
      name: row.name,
      slug: row.slug,
      coverUrl: row.coverUrl,
      score,
      reasons,
      salesFactCount: salesCount,
      steamReviews,
    };
  }
}
