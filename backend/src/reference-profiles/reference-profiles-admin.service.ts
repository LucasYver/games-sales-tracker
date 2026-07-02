import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Game, Platform, ReferenceProfile } from '../entities';
import type { ResolvedGenreProfile } from './sales-profile-resolver.service';
import { MatcherService } from './matcher.service';
import { SalesProfileResolverService } from './sales-profile-resolver.service';

/**
 * Read-only admin surface over the Forme C corpus. It never writes —
 * the ETL (`ReferenceProfileService`) owns the table — it only exposes
 * the anchor vectors, aggregate corpus health, and per-game matcher
 * traces so the back-office can watch what the matcher actually feeds
 * the estimation model.
 */

export interface AdminReferenceCurve {
  s1: number | null;
  m1: number | null;
  m3: number | null;
  m6: number | null;
  a1: number | null;
  a2: number | null;
}

export interface AdminReferencePlatformShares {
  pc: number;
  ps: number;
  xbox: number;
  switch: number;
}

type PlatformClass = 'PC_ONLY' | 'CONSOLE_ONLY' | 'PC_PLUS_CONSOLE' | 'UNKNOWN';

export interface AdminReferenceProfileRow {
  gameId: string;
  gameName: string;
  gameSlug: string;
  scaleUnits: number | null;
  reviewsToUnits: number | null;
  peakCcuRatio: number | null;
  curve: AdminReferenceCurve;
  platformShares: AdminReferencePlatformShares | null;
  qualityScore: number;
  platformClass: PlatformClass;
  observedAt: string;
}

export interface AdminCorpusBucket {
  label: string;
  count: number;
}

export interface AdminCorpusStats {
  matcherEnabled: boolean;
  total: number;
  coverage: {
    curve: number;
    reviewsToUnits: number;
    platformShares: number;
  };
  quality: {
    mean: number;
    median: number;
    min: number;
    max: number;
  };
  platformClass: Record<PlatformClass, number>;
  scaleBuckets: AdminCorpusBucket[];
  qualityBuckets: AdminCorpusBucket[];
}

export interface AdminMatchedNeighbour {
  gameId: string;
  gameName: string;
  gameSlug: string;
  similarity: number;
  weight: number;
}

export interface AdminMatcherInspection {
  matcherEnabled: boolean;
  isAnchor: boolean;
  coldStart: boolean;
  neighboursUsed: number;
  reviewsToUnits: number | null;
  peakCcuRatio: number | null;
  curve: AdminReferenceCurve;
  platformShares: AdminReferencePlatformShares | null;
  neighbours: AdminMatchedNeighbour[];
  resolved: ResolvedGenreProfile | null;
}

interface AnchorJoinRow {
  gameId: string;
  gameName: string;
  gameSlug: string;
  scaleUnits: string | null;
  reviewsToUnits: string | null;
  peakCcuRatio: string | null;
  curveS1: string | null;
  curveM1: string | null;
  curveM3: string | null;
  curveM6: string | null;
  curveA1: string | null;
  curveA2: string | null;
  platformSharePc: string | null;
  platformSharePs: string | null;
  platformShareXbox: string | null;
  platformShareSwitch: string | null;
  qualityScore: string;
  observedAt: Date;
  platforms: string[] | null;
}

const SCALE_BUCKETS: Array<{ label: string; max: number }> = [
  { label: '< 1M', max: 1_000_000 },
  { label: '1M – 3M', max: 3_000_000 },
  { label: '3M – 10M', max: 10_000_000 },
  { label: '≥ 10M', max: Number.POSITIVE_INFINITY },
];

const QUALITY_BUCKETS: Array<{ label: string; max: number }> = [
  { label: '< 0.4', max: 0.4 },
  { label: '0.4 – 0.6', max: 0.6 },
  { label: '0.6 – 0.8', max: 0.8 },
  { label: '≥ 0.8', max: Number.POSITIVE_INFINITY },
];

@Injectable()
export class ReferenceProfilesAdminService {
  constructor(
    @InjectRepository(ReferenceProfile)
    private readonly anchors: Repository<ReferenceProfile>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    private readonly matcher: MatcherService,
    private readonly resolver: SalesProfileResolverService,
  ) {}

  async listAnchors(): Promise<AdminReferenceProfileRow[]> {
    const rows = await this.loadAnchorJoin();
    return rows
      .map((r) => this.mapRow(r))
      .sort((a, b) => (b.scaleUnits ?? 0) - (a.scaleUnits ?? 0));
  }

  async corpusStats(): Promise<AdminCorpusStats> {
    const rows = await this.loadAnchorJoin();
    const total = rows.length;

    const qualities = rows
      .map((r) => Number(r.qualityScore))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const platformClass: Record<PlatformClass, number> = {
      PC_ONLY: 0,
      CONSOLE_ONLY: 0,
      PC_PLUS_CONSOLE: 0,
      UNKNOWN: 0,
    };
    const scaleCounts = SCALE_BUCKETS.map(() => 0);
    const qualityCounts = QUALITY_BUCKETS.map(() => 0);

    let withCurve = 0;
    let withReviewsToUnits = 0;
    let withPlatformShares = 0;

    for (const r of rows) {
      platformClass[classifyPlatforms(r.platforms)] += 1;

      if (r.curveA1 !== null) withCurve += 1;
      if (r.reviewsToUnits !== null) withReviewsToUnits += 1;
      if (r.platformSharePc !== null) withPlatformShares += 1;

      const scale = r.scaleUnits !== null ? Number(r.scaleUnits) : null;
      if (scale !== null) {
        const idx = SCALE_BUCKETS.findIndex((b) => scale < b.max);
        if (idx >= 0) scaleCounts[idx] += 1;
      }

      const q = Number(r.qualityScore);
      if (Number.isFinite(q)) {
        const idx = QUALITY_BUCKETS.findIndex((b) => q < b.max);
        if (idx >= 0) qualityCounts[idx] += 1;
      }
    }

    return {
      matcherEnabled: this.resolver.isMatcherEnabled(),
      total,
      coverage: {
        curve: withCurve,
        reviewsToUnits: withReviewsToUnits,
        platformShares: withPlatformShares,
      },
      quality: {
        mean: qualities.length ? mean(qualities) : 0,
        median: qualities.length ? median(qualities) : 0,
        min: qualities.length ? qualities[0] : 0,
        max: qualities.length ? qualities[qualities.length - 1] : 0,
      },
      platformClass,
      scaleBuckets: SCALE_BUCKETS.map((b, i) => ({
        label: b.label,
        count: scaleCounts[i],
      })),
      qualityBuckets: QUALITY_BUCKETS.map((b, i) => ({
        label: b.label,
        count: qualityCounts[i],
      })),
    };
  }

  /**
   * Trace the matcher for a single game: the neighbours it would pull
   * (with names), the aggregated observed vector, and the final
   * resolved profile the estimation model consumes. Mirrors production
   * behaviour (same features the resolver passes, `latestPriceCents`
   * left null), so what's shown is what actually feeds the estimate.
   */
  async inspectGame(gameId: string): Promise<AdminMatcherInspection | null> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) return null;

    const match = await this.matcher.findNeighbours({
      platforms: game.platforms ?? [],
      categories: game.categories ?? null,
      genres: game.genres ?? null,
      steamTags: game.steamTags ?? null,
      publisherId: game.publisherId ?? null,
      releaseDate: game.releaseDate ?? null,
      developer: game.developer ?? null,
      franchiseSlug: game.franchiseSlug ?? null,
      isAnnualIteration: game.isAnnualIteration ?? false,
      liveService: game.liveService ?? false,
    });

    const resolved = await this.resolver.resolveForGame(game);
    const isAnchor = (await this.anchors.count({ where: { gameId } })) > 0;

    const neighbourIds = match.anchors.map((a) => a.gameId);
    const names = neighbourIds.length
      ? await this.games.find({
          where: { id: In(neighbourIds) },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const nameById = new Map(names.map((g) => [g.id, g]));

    return {
      matcherEnabled: this.resolver.isMatcherEnabled(),
      isAnchor,
      coldStart: match.coldStart,
      neighboursUsed: match.neighboursUsed,
      reviewsToUnits: match.reviewsToUnits,
      peakCcuRatio: match.peakCcuRatio,
      curve: match.curve,
      platformShares: match.platformShares,
      neighbours: match.anchors.map((a) => {
        const g = nameById.get(a.gameId);
        return {
          gameId: a.gameId,
          gameName: g?.name ?? a.gameId,
          gameSlug: g?.slug ?? '',
          similarity: a.similarity,
          weight: a.weight,
        };
      }),
      resolved,
    };
  }

  private async loadAnchorJoin(): Promise<AnchorJoinRow[]> {
    return this.anchors.manager.query<AnchorJoinRow[]>(
      `SELECT r."gameId" AS "gameId",
              g.name AS "gameName",
              g.slug AS "gameSlug",
              r."scaleUnits" AS "scaleUnits",
              r."reviewsToUnits" AS "reviewsToUnits",
              r."peakCcuRatio" AS "peakCcuRatio",
              r."curveS1" AS "curveS1",
              r."curveM1" AS "curveM1",
              r."curveM3" AS "curveM3",
              r."curveM6" AS "curveM6",
              r."curveA1" AS "curveA1",
              r."curveA2" AS "curveA2",
              r."platformSharePc" AS "platformSharePc",
              r."platformSharePs" AS "platformSharePs",
              r."platformShareXbox" AS "platformShareXbox",
              r."platformShareSwitch" AS "platformShareSwitch",
              r."qualityScore" AS "qualityScore",
              r."observedAt" AS "observedAt",
              g.platforms::text[] AS platforms
         FROM reference_profile r
         INNER JOIN game g ON g.id = r."gameId"
        WHERE g."deletedAt" IS NULL`,
    );
  }

  private mapRow(r: AnchorJoinRow): AdminReferenceProfileRow {
    const shares =
      r.platformSharePc !== null &&
      r.platformSharePs !== null &&
      r.platformShareXbox !== null &&
      r.platformShareSwitch !== null
        ? {
            pc: Number(r.platformSharePc),
            ps: Number(r.platformSharePs),
            xbox: Number(r.platformShareXbox),
            switch: Number(r.platformShareSwitch),
          }
        : null;

    return {
      gameId: r.gameId,
      gameName: r.gameName,
      gameSlug: r.gameSlug,
      scaleUnits: r.scaleUnits !== null ? Number(r.scaleUnits) : null,
      reviewsToUnits:
        r.reviewsToUnits !== null ? Number(r.reviewsToUnits) : null,
      peakCcuRatio: nullableNumber(r.peakCcuRatio),
      curve: {
        s1: nullableNumber(r.curveS1),
        m1: nullableNumber(r.curveM1),
        m3: nullableNumber(r.curveM3),
        m6: nullableNumber(r.curveM6),
        a1: nullableNumber(r.curveA1),
        a2: nullableNumber(r.curveA2),
      },
      platformShares: shares,
      qualityScore: Number(r.qualityScore),
      platformClass: classifyPlatforms(r.platforms),
      observedAt: new Date(r.observedAt).toISOString(),
    };
  }
}

function classifyPlatforms(raw: string[] | null): PlatformClass {
  const platforms = (raw ?? []).filter((p): p is Platform =>
    (Object.values(Platform) as string[]).includes(p),
  );
  if (platforms.length === 0) return 'UNKNOWN';
  const hasPc = platforms.includes(Platform.PC);
  const hasConsole = platforms.some((p) => p !== Platform.PC);
  if (hasPc && hasConsole) return 'PC_PLUS_CONSOLE';
  if (hasPc) return 'PC_ONLY';
  return 'CONSOLE_ONLY';
}

function nullableNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mean(sorted: number[]): number {
  return sorted.reduce((a, b) => a + b, 0) / sorted.length;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
