import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { BlogCandidateScore } from './blog.types';

const MS_DAY = 86_400_000;

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
          SELECT 1 FROM blog_post b WHERE b."gameId" = g.id
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
