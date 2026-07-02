import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Platform, ReferenceProfile } from '../entities';

/**
 * Number of nearest neighbours the matcher pulls before aggregating.
 * Small enough that per-anchor weight stays informative (top matches
 * dominate); large enough to smooth out individual noisy anchors.
 */
const DEFAULT_NEIGHBOURS = 15;

/**
 * Below this weighted-neighbour count the matcher falls back to the
 * cold-start estimate (play-mode-filtered global mean, then unfiltered
 * global mean). Prevents a single fluky anchor from anchoring the
 * whole estimation.
 */
const MIN_NEIGHBOURS = 3;

/**
 * Soft-similarity weights per feature. Sum = 1.0 so the resulting
 * `similarity` stays in [0, 1]. Play-mode is a hard filter and does
 * not appear here.
 *
 * Priority order (product decision, not just the diagnostic):
 *  1. `gameplayType` — the dominant axis. It separates a grand-strategy/4X
 *     game from a puzzle platformer, which platform/scale alone never could
 *     (a PC-only target scores 1.0 platform-overlap against *every* PC-only
 *     anchor, so platform was inflating unrelated titles). It is driven by
 *     Steam **community tags** when both games carry them — the finest
 *     gameplay signal available ("Grand Strategy", "4X", "Roguelike") — and
 *     falls back to the coarse store `genres` otherwise.
 *  2. `publisherMatch` + `developerMatch` — exact identity. Another game
 *     by the same studio or the same publisher is an extremely strong
 *     prior for behaviour (a second Paradox grand-strategy title tells us
 *     far more than a random same-scale PC game).
 *  3. `scaleBucket` + `platformsOverlap` — kept but deliberately lower;
 *     they refine within a gameplay/publisher neighbourhood rather than
 *     drive the match.
 *
 * `franchise`, `liveService`, `devTrackRecord` and `annualIteration` stay
 * low: muted on the leak population (PC paid pre-2018 hits), kept active so
 * they're ready once the corpus holds the game types they distinguish.
 *
 * Price is intentionally absent: no reliable per-game price coverage.
 */
const SIMILARITY_WEIGHTS = {
  gameplayType: 0.3,
  publisherMatch: 0.14,
  developerMatch: 0.14,
  scaleBucket: 0.12,
  platformsOverlap: 0.1,
  releaseEra: 0.05,
  franchise: 0.05,
  liveService: 0.04,
  devTrackRecord: 0.03,
  annualIteration: 0.03,
} as const;

/**
 * Genres/tags that describe production scale or a catch-all label rather
 * than a gameplay type; they appear across wildly different games and would
 * make the gameplay-type Jaccard reward unrelated titles. `scaleBucket`
 * already captures what "Indie" implies. Stripped before the comparison
 * (applies to both store genres and Steam community tags).
 */
const GENRE_STOPLIST = new Set(['indie']);

/**
 * Units thresholds for the developer track-record tier. A studio that
 * previously shipped a >5M hit tends to launch its next title far
 * bigger than a first-timer, independently of genre.
 */
const TRACK_RECORD_HIT_UNITS = 5_000_000;
const TRACK_RECORD_MID_UNITS = 1_000_000;

type PlayMode = 'SOLO' | 'COOP' | 'MULTI' | 'MMO' | 'MIXED' | 'UNKNOWN';

// Developer pedigree at the game's release: HIT = prior >5M title,
// MID = prior >1M title, NONE = has a developer but no prior hit,
// UNKNOWN = developer unknown.
type TrackRecordTier = 'HIT' | 'MID' | 'NONE' | 'UNKNOWN';

type ReleaseEra =
  | 'PRE_2013'
  | '2013_2014'
  | '2015_2016'
  | '2017_2018'
  | '2019_2020'
  | '2021_2022'
  | '2023_PLUS'
  | 'UNKNOWN';

type ScaleBucket = 'SMALL' | 'MEDIUM' | 'LARGE' | 'HUGE' | 'UNKNOWN';

export interface MatchTargetFeatures {
  platforms: Platform[];
  categories: string[] | null;
  /** IGDB/Steam store genres (coarse gameplay type). */
  genres: string[] | null;
  /**
   * Steam community tags (`Game.steamTags`), the finest gameplay-type
   * signal. Preferred over `genres` when both games carry them.
   */
  steamTags: string[] | null;
  /** Curated publisher id (`Game.publisherId`), for exact publisher match. */
  publisherId: string | null;
  releaseDate: Date | null;
  /** Raw developer name, for exact developer match + track-record lookup. */
  developer: string | null;
  /** Franchise identity (from `Game.franchiseSlug`), `null` for one-offs. */
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  liveService: boolean;
  /**
   * Optional scale hint (units). When the caller already has a rough
   * estimate for the target (e.g. from a partial Boxleiter run) the
   * matcher will bias toward anchors of comparable magnitude. Leave
   * `null` to skip the scale-bucket component.
   */
  scaleHint?: number | null;
}

export interface CurveVector {
  s1: number | null;
  m1: number | null;
  m3: number | null;
  m6: number | null;
  a1: number | null;
  a2: number | null;
}

export interface MatchedAnchor {
  gameId: string;
  similarity: number;
  weight: number;
}

export interface MatchResult {
  curve: CurveVector;
  reviewsToUnits: number | null;
  peakCcuRatio: number | null;
  platformShares: {
    pc: number;
    ps: number;
    xbox: number;
    switch: number;
  } | null;
  neighboursUsed: number;
  coldStart: boolean;
  anchors: MatchedAnchor[];
}

interface AnchorRow {
  gameId: string;
  platforms: Platform[];
  genres: string[];
  steamTags: string[];
  playMode: PlayMode;
  publisherId: string | null;
  releaseEra: ReleaseEra;
  scaleBucket: ScaleBucket;
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  liveService: boolean;
  developer: string | null;
  releaseDate: Date | null;
  trackRecord: TrackRecordTier;
  qualityScore: number;
  scaleUnits: number | null;
  curve: CurveVector;
  reviewsToUnits: number | null;
  peakCcuRatio: number | null;
  platformShares: {
    pc: number;
    ps: number;
    xbox: number;
    switch: number;
  } | null;
}

/**
 * Data-driven matcher (Forme C): resolves a target game's behavioural
 * vector as the quality- and similarity-weighted aggregate of the
 * nearest anchors in `reference_profile`. Falls back to a play-mode-
 * filtered global mean when no comparable anchors exist. The genre is
 * at most an implicit feature (via `Game.categories`) and never a hard
 * bucket.
 *
 * This is the sole source of the estimation profile: consumers call
 * `findNeighbours(targetFeatures, opts)` (via `SalesProfileResolverService`).
 */
@Injectable()
export class MatcherService {
  constructor(
    @InjectRepository(ReferenceProfile)
    private readonly anchors: Repository<ReferenceProfile>,
  ) {}

  /**
   * Aggregate the k nearest anchors' observed vectors into a match
   * result for `target`. When `holdoutGameId` is provided, that anchor
   * is excluded from the corpus (used by the k-fold holdout validation
   * on the leak — the target game never becomes its own neighbour).
   */
  async findNeighbours(
    target: MatchTargetFeatures,
    opts: {
      holdoutGameId?: string;
      k?: number;
    } = {},
  ): Promise<MatchResult> {
    const k = opts.k ?? DEFAULT_NEIGHBOURS;
    const trackRecordIndex = await this.buildTrackRecordIndex();
    const corpus = await this.loadCorpus(opts.holdoutGameId);
    for (const row of corpus) {
      row.trackRecord = trackRecordIndex.tierFor(
        row.developer,
        row.releaseDate,
        row.gameId,
      );
    }
    const targetFeatures = this.featurise(target);
    targetFeatures.trackRecord = trackRecordIndex.tierFor(
      target.developer,
      target.releaseDate,
      undefined,
    );

    const primary = this.pickCandidates(corpus, targetFeatures, {
      strict: true,
    });
    if (primary.length >= MIN_NEIGHBOURS) {
      return this.aggregate(primary, targetFeatures, k, /*coldStart*/ false);
    }

    // Cold-start step 1: relax the platform overlap filter, keep the
    // play-mode filter — anchors of the same play-mode remain the best
    // available prior when platform data is sparse.
    const relaxed = this.pickCandidates(corpus, targetFeatures, {
      strict: false,
    });
    if (relaxed.length >= MIN_NEIGHBOURS) {
      return this.aggregate(relaxed, targetFeatures, k, /*coldStart*/ true);
    }

    // Cold-start step 2: fall through to the unconditional global mean,
    // ignoring every feature. Least specific, but guarantees we always
    // return something rather than throwing on unusual games.
    return this.aggregate(corpus, targetFeatures, k, /*coldStart*/ true);
  }

  private pickCandidates(
    corpus: AnchorRow[],
    target: TargetInternal,
    opts: { strict: boolean },
  ): AnchorRow[] {
    return corpus.filter((row) => {
      if (row.playMode !== target.playMode) return false;
      if (!opts.strict) return true;
      // Strict mode: require at least one shared platform between the
      // anchor and the target so we're not projecting a PC-only anchor
      // onto a Switch-only target's curve, or vice-versa.
      return target.platformSet.some((p) => row.platforms.includes(p));
    });
  }

  private aggregate(
    candidates: AnchorRow[],
    target: TargetInternal,
    k: number,
    coldStart: boolean,
  ): MatchResult {
    const scored = candidates.map((row) => ({
      row,
      similarity: this.similarity(row, target),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    const top = scored.slice(0, k);

    const anchors: MatchedAnchor[] = top.map(({ row, similarity }) => ({
      gameId: row.gameId,
      similarity,
      weight: similarity * row.qualityScore,
    }));

    return {
      curve: this.aggregateCurve(top),
      reviewsToUnits: this.aggregateReviewsToUnits(top),
      peakCcuRatio: this.aggregatePeakCcuRatio(top),
      platformShares: this.aggregatePlatformShares(top),
      neighboursUsed: top.length,
      coldStart,
      anchors,
    };
  }

  // ─── Similarity ────────────────────────────────────────────────────

  private similarity(row: AnchorRow, target: TargetInternal): number {
    const platformScore = jaccard(row.platforms, target.platformSet);
    const gameplayTypeScore = gameplayTypeSimilarity(
      row.steamTags,
      row.genres,
      target.steamTags,
      target.genres,
    );
    const publisherScore = identityMatch(row.publisherId, target.publisherId);
    const developerScore = developerMatch(row.developer, target.developer);
    const eraScore = eraSimilarity(row.releaseEra, target.releaseEra);
    const scaleScore =
      target.scaleBucket === 'UNKNOWN'
        ? 1.0
        : matchOrZero(row.scaleBucket, target.scaleBucket);
    const franchiseScore = franchiseSimilarity(
      row.franchiseSlug,
      target.franchiseSlug,
    );
    const annualScore =
      row.isAnnualIteration === target.isAnnualIteration ? 1.0 : 0.0;
    const liveServiceScore = row.liveService === target.liveService ? 1.0 : 0.0;
    const trackRecordScore = trackRecordSimilarity(
      row.trackRecord,
      target.trackRecord,
    );

    return (
      SIMILARITY_WEIGHTS.gameplayType * gameplayTypeScore +
      SIMILARITY_WEIGHTS.publisherMatch * publisherScore +
      SIMILARITY_WEIGHTS.developerMatch * developerScore +
      SIMILARITY_WEIGHTS.scaleBucket * scaleScore +
      SIMILARITY_WEIGHTS.platformsOverlap * platformScore +
      SIMILARITY_WEIGHTS.releaseEra * eraScore +
      SIMILARITY_WEIGHTS.franchise * franchiseScore +
      SIMILARITY_WEIGHTS.liveService * liveServiceScore +
      SIMILARITY_WEIGHTS.devTrackRecord * trackRecordScore +
      SIMILARITY_WEIGHTS.annualIteration * annualScore
    );
  }

  // ─── Aggregation ───────────────────────────────────────────────────

  private aggregateCurve(
    top: { row: AnchorRow; similarity: number }[],
  ): CurveVector {
    const keys: (keyof CurveVector)[] = ['s1', 'm1', 'm3', 'm6', 'a1', 'a2'];
    const result: CurveVector = {
      s1: null,
      m1: null,
      m3: null,
      m6: null,
      a1: null,
      a2: null,
    };
    for (const key of keys) {
      // Curve values are dimensionless fractions in the same order of
      // magnitude — arithmetic mean is well-behaved here (as opposed to
      // reviewsToUnits which spans orders of magnitude and needs log).
      const entries = top
        .map(({ row, similarity }) => ({
          value: row.curve[key],
          weight: similarity * row.qualityScore,
        }))
        .filter(
          (e): e is { value: number; weight: number } => e.value !== null,
        );
      result[key] = weightedMean(entries);
    }
    return result;
  }

  private aggregateReviewsToUnits(
    top: { row: AnchorRow; similarity: number }[],
  ): number | null {
    // reviewsToUnits spans ~two orders of magnitude across genres
    // (indie ~15, AAA ~150). Aggregate in log-10 space to avoid the
    // mean being dragged by the largest outliers.
    const entries = top
      .map(({ row, similarity }) => ({
        value: row.reviewsToUnits,
        weight: similarity * row.qualityScore,
      }))
      .filter(
        (e): e is { value: number; weight: number } =>
          e.value !== null && e.value > 0,
      )
      .map((e) => ({ value: Math.log10(e.value), weight: e.weight }));
    const meanLog = weightedMean(entries);
    if (meanLog === null) return null;
    return Math.pow(10, meanLog);
  }

  private aggregatePeakCcuRatio(
    top: { row: AnchorRow; similarity: number }[],
  ): number | null {
    // Same rationale as reviewsToUnits: the ratio spans a wide range
    // across game types (high-retention ~2, one-and-done ~10+), so we
    // aggregate in log-10 space to keep outliers from dominating.
    const entries = top
      .map(({ row, similarity }) => ({
        value: row.peakCcuRatio,
        weight: similarity * row.qualityScore,
      }))
      .filter(
        (e): e is { value: number; weight: number } =>
          e.value !== null && e.value > 0,
      )
      .map((e) => ({ value: Math.log10(e.value), weight: e.weight }));
    const meanLog = weightedMean(entries);
    if (meanLog === null) return null;
    return Math.pow(10, meanLog);
  }

  private aggregatePlatformShares(
    top: { row: AnchorRow; similarity: number }[],
  ): {
    pc: number;
    ps: number;
    xbox: number;
    switch: number;
  } | null {
    const rows = top.filter(({ row }) => row.platformShares !== null);
    if (rows.length === 0) return null;
    const totals = { pc: 0, ps: 0, xbox: 0, switch: 0 };
    let weightSum = 0;
    for (const { row, similarity } of rows) {
      const w = similarity * row.qualityScore;
      const shares = row.platformShares!;
      totals.pc += shares.pc * w;
      totals.ps += shares.ps * w;
      totals.xbox += shares.xbox * w;
      totals.switch += shares.switch * w;
      weightSum += w;
    }
    if (weightSum === 0) return null;
    const raw = {
      pc: totals.pc / weightSum,
      ps: totals.ps / weightSum,
      xbox: totals.xbox / weightSum,
      switch: totals.switch / weightSum,
    };
    // Renormalise in case a small numeric drift pushes the sum off 1.0.
    const sum = raw.pc + raw.ps + raw.xbox + raw.switch;
    if (sum <= 0) return null;
    return {
      pc: raw.pc / sum,
      ps: raw.ps / sum,
      xbox: raw.xbox / sum,
      switch: raw.switch / sum,
    };
  }

  // ─── Corpus / feature extraction ───────────────────────────────────

  /**
   * Load every anchor with the game join needed to feature-extract on
   * the fly. Kept in memory: the corpus is small (< a few thousand rows)
   * and matching is repeated per estimation, so re-querying per call
   * would dwarf the join cost.
   */
  private async loadCorpus(
    holdoutGameId: string | undefined,
  ): Promise<AnchorRow[]> {
    const raw = await this.anchors.manager.query<
      Array<{
        gameId: string;
        qualityScore: string;
        scaleUnits: string | null;
        curveS1: string | null;
        curveM1: string | null;
        curveM3: string | null;
        curveM6: string | null;
        curveA1: string | null;
        curveA2: string | null;
        reviewsToUnits: string | null;
        peakCcuRatio: string | null;
        platformSharePc: string | null;
        platformSharePs: string | null;
        platformShareXbox: string | null;
        platformShareSwitch: string | null;
        platforms: string[] | null;
        categories: string[] | string | null;
        genres: string[] | string | null;
        steamTags: string[] | string | null;
        publisherId: string | null;
        releaseDate: Date | null;
        developer: string | null;
        franchiseSlug: string | null;
        isAnnualIteration: boolean;
        liveService: boolean;
      }>
    >(
      `SELECT r."gameId" AS "gameId",
              r."qualityScore" AS "qualityScore",
              r."scaleUnits" AS "scaleUnits",
              r."curveS1" AS "curveS1",
              r."curveM1" AS "curveM1",
              r."curveM3" AS "curveM3",
              r."curveM6" AS "curveM6",
              r."curveA1" AS "curveA1",
              r."curveA2" AS "curveA2",
              r."reviewsToUnits" AS "reviewsToUnits",
              r."peakCcuRatio" AS "peakCcuRatio",
              r."platformSharePc" AS "platformSharePc",
              r."platformSharePs" AS "platformSharePs",
              r."platformShareXbox" AS "platformShareXbox",
              r."platformShareSwitch" AS "platformShareSwitch",
              g.platforms::text[] AS platforms,
              g.categories AS categories,
              g.genres AS genres,
              g."steamTags" AS "steamTags",
              g."publisherId" AS "publisherId",
              g."releaseDate" AS "releaseDate",
              g.developer AS developer,
              g."franchiseSlug" AS "franchiseSlug",
              g."isAnnualIteration" AS "isAnnualIteration",
              g."liveService" AS "liveService"
         FROM reference_profile r
         INNER JOIN game g ON g.id = r."gameId"
        WHERE g."deletedAt" IS NULL
          ${holdoutGameId ? 'AND r."gameId" <> $1' : ''}`,
      holdoutGameId ? [holdoutGameId] : [],
    );

    return raw.map((r) => {
      const platforms = parseTextArray(r.platforms).filter(isPlatform);
      const categories = parseTextArray(r.categories);
      const genres = normaliseGenres(parseTextArray(r.genres));
      const steamTags = normaliseGenres(parseTextArray(r.steamTags));
      const scaleUnits = r.scaleUnits !== null ? Number(r.scaleUnits) : null;
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
        platforms,
        genres,
        steamTags,
        playMode: playModeFromCategories(categories),
        publisherId: r.publisherId,
        releaseEra: releaseEraFromDate(r.releaseDate),
        scaleBucket: scaleBucketFromUnits(scaleUnits),
        franchiseSlug: r.franchiseSlug,
        isAnnualIteration: Boolean(r.isAnnualIteration),
        liveService: Boolean(r.liveService),
        developer: r.developer,
        releaseDate: r.releaseDate,
        // Filled in by findNeighbours once the track-record index is
        // built; the corpus loader can't know it in isolation.
        trackRecord: 'UNKNOWN',
        qualityScore: Number(r.qualityScore),
        scaleUnits,
        curve: {
          s1: nullableNumber(r.curveS1),
          m1: nullableNumber(r.curveM1),
          m3: nullableNumber(r.curveM3),
          m6: nullableNumber(r.curveM6),
          a1: nullableNumber(r.curveA1),
          a2: nullableNumber(r.curveA2),
        },
        reviewsToUnits: nullableNumber(r.reviewsToUnits),
        peakCcuRatio: nullableNumber(r.peakCcuRatio),
        platformShares: shares,
      };
    });
  }

  private featurise(target: MatchTargetFeatures): TargetInternal {
    const platformSet = target.platforms.filter(isPlatform);
    return {
      platformSet,
      genres: normaliseGenres(target.genres ?? []),
      steamTags: normaliseGenres(target.steamTags ?? []),
      playMode: playModeFromCategories(target.categories),
      publisherId: target.publisherId,
      developer: target.developer,
      releaseEra: releaseEraFromDate(target.releaseDate),
      scaleBucket: scaleBucketFromUnits(target.scaleHint ?? null),
      franchiseSlug: target.franchiseSlug,
      isAnnualIteration: target.isAnnualIteration,
      liveService: target.liveService,
      // Overwritten in findNeighbours once the shared index is built.
      trackRecord: 'UNKNOWN',
    };
  }

  /**
   * Build the developer → prior-hits lookup used by the track-record
   * feature. One query per matcher call over games that carry an
   * accepted worldwide milestone; the resulting index answers "did this
   * game's studio ship a >5M (or >1M) title before this game's release?"
   * in memory. Leak-safe by construction: a game's own row is excluded
   * from its own lookup (`selfGameId`).
   */
  private async buildTrackRecordIndex(): Promise<TrackRecordIndex> {
    const rows = await this.anchors.manager.query<
      Array<{
        developer: string | null;
        gameId: string;
        releaseDate: Date | null;
        maxUnits: string | null;
      }>
    >(
      `SELECT g.developer AS developer,
              g.id AS "gameId",
              g."releaseDate" AS "releaseDate",
              MAX(m.units) AS "maxUnits"
         FROM game g
         INNER JOIN milestone m
           ON m."gameId" = g.id
          AND m."rejectedAt" IS NULL
          AND m."isEngagement" = false
        WHERE g.developer IS NOT NULL
          AND g."deletedAt" IS NULL
        GROUP BY g.developer, g.id, g."releaseDate"`,
    );
    return new TrackRecordIndex(
      rows.map((r) => ({
        developer: r.developer,
        gameId: r.gameId,
        releaseTime: r.releaseDate ? new Date(r.releaseDate).getTime() : null,
        units: r.maxUnits !== null ? Number(r.maxUnits) : 0,
      })),
    );
  }

  /**
   * How many eligible anchors currently sit in the corpus. Exposed for
   * ops/monitoring dashboards — a shrinking corpus is a red flag for
   * the ETL, not for the matcher.
   */
  async corpusSize(): Promise<number> {
    return this.anchors.count();
  }

  // Kept for symmetry with the ETL — same enum as the reviews-only join
  // in `ReferenceProfileService`.
  static readonly CURVE_KEYS = ['s1', 'm1', 'm3', 'm6', 'a1', 'a2'] as const;
}

interface TargetInternal {
  platformSet: Platform[];
  genres: string[];
  steamTags: string[];
  playMode: PlayMode;
  publisherId: string | null;
  developer: string | null;
  releaseEra: ReleaseEra;
  scaleBucket: ScaleBucket;
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  liveService: boolean;
  trackRecord: TrackRecordTier;
}

interface TrackRecordEntry {
  developer: string | null;
  gameId: string;
  releaseTime: number | null;
  units: number;
}

/**
 * In-memory index answering the developer track-record question. Built
 * once per matcher call from the milestone graph, then queried for the
 * target and every anchor.
 */
class TrackRecordIndex {
  private readonly byDeveloper = new Map<string, TrackRecordEntry[]>();

  constructor(entries: TrackRecordEntry[]) {
    for (const entry of entries) {
      if (!entry.developer) continue;
      const key = entry.developer.toLowerCase();
      const list = this.byDeveloper.get(key) ?? [];
      list.push(entry);
      this.byDeveloper.set(key, list);
    }
  }

  /**
   * Tier for a game given its developer and release date. Only OTHER
   * games by the same studio count (`selfGameId` excluded), and only
   * those released strictly before this game's release — so a title
   * never benefits from a sibling that shipped after it, and never
   * from itself. When the target has no release date we consider all
   * sibling titles (best effort).
   */
  tierFor(
    developer: string | null,
    releaseDate: Date | null,
    selfGameId: string | undefined,
  ): TrackRecordTier {
    if (!developer) return 'UNKNOWN';
    const list = this.byDeveloper.get(developer.toLowerCase());
    if (!list || list.length === 0) return 'NONE';

    const cutoff = releaseDate ? releaseDate.getTime() : null;
    let best = 0;
    for (const entry of list) {
      if (entry.gameId === selfGameId) continue;
      if (
        cutoff !== null &&
        entry.releaseTime !== null &&
        entry.releaseTime >= cutoff
      ) {
        continue;
      }
      if (entry.units > best) best = entry.units;
    }

    if (best >= TRACK_RECORD_HIT_UNITS) return 'HIT';
    if (best >= TRACK_RECORD_MID_UNITS) return 'MID';
    return 'NONE';
  }
}

// ─── Feature extraction helpers ──────────────────────────────────────

function playModeFromCategories(cats: string[] | null): PlayMode {
  if (!cats || cats.length === 0) return 'UNKNOWN';
  const set = new Set(cats.map((c) => c.toLowerCase()));
  const hasSolo = set.has('single-player');
  const hasCoop =
    set.has('co-op') ||
    set.has('online co-op') ||
    set.has('shared/split screen co-op');
  const hasMulti =
    set.has('multi-player') ||
    set.has('online pvp') ||
    set.has('pvp') ||
    set.has('cross-platform multiplayer');
  const hasMmo = set.has('mmo') || set.has('massively multiplayer');

  if (hasMmo) return 'MMO';
  if (hasSolo && (hasCoop || hasMulti)) return 'MIXED';
  if (hasCoop && !hasMulti) return 'COOP';
  if (hasMulti) return 'MULTI';
  if (hasSolo) return 'SOLO';
  return 'UNKNOWN';
}

function releaseEraFromDate(date: Date | null): ReleaseEra {
  if (!date) return 'UNKNOWN';
  const y = date.getUTCFullYear();
  if (y < 2013) return 'PRE_2013';
  if (y < 2015) return '2013_2014';
  if (y < 2017) return '2015_2016';
  if (y < 2019) return '2017_2018';
  if (y < 2021) return '2019_2020';
  if (y < 2023) return '2021_2022';
  return '2023_PLUS';
}

function scaleBucketFromUnits(units: number | null): ScaleBucket {
  if (units === null) return 'UNKNOWN';
  if (units >= 10_000_000) return 'HUGE';
  if (units >= 3_000_000) return 'LARGE';
  if (units >= 1_000_000) return 'MEDIUM';
  return 'SMALL';
}

// ─── Small pure helpers ──────────────────────────────────────────────

function jaccard(a: Platform[], b: Platform[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersect = 0;
  for (const v of setA) if (setB.has(v)) intersect += 1;
  const union = setA.size + setB.size - intersect;
  return union > 0 ? intersect / union : 0;
}

function matchOrZero<T extends string>(a: T, b: T): number {
  if (a === b) return 1.0;
  if (a === 'UNKNOWN' || b === 'UNKNOWN') return 0.4;
  return 0.0;
}

/**
 * Contiguous release eras are close (0.6) rather than fully mismatched
 * (0.0) — a 2019 title is more like a 2020 title than a 2013 one, so
 * we don't want the era feature to over-penalise near matches.
 */
function eraSimilarity(a: ReleaseEra, b: ReleaseEra): number {
  if (a === b) return 1.0;
  if (a === 'UNKNOWN' || b === 'UNKNOWN') return 0.5;
  const order: ReleaseEra[] = [
    'PRE_2013',
    '2013_2014',
    '2015_2016',
    '2017_2018',
    '2019_2020',
    '2021_2022',
    '2023_PLUS',
  ];
  const distance = Math.abs(order.indexOf(a) - order.indexOf(b));
  if (distance === 1) return 0.7;
  if (distance === 2) return 0.4;
  return 0.15;
}

/**
 * Franchise axis: two entries of the same franchise are maximally
 * similar; two different known franchises are dissimilar on this axis
 * (0). When either side is a one-off (`null`) the axis is neutral
 * (0.5) so it neither rewards nor penalises — other features decide.
 */
function franchiseSimilarity(a: string | null, b: string | null): number {
  if (a !== null && b !== null) return a === b ? 1.0 : 0.0;
  return 0.5;
}

/**
 * Exact-identity axis (publisher id, franchise-like ids). Both known →
 * 1.0 if equal, 0.0 otherwise. Either unknown (`null`) → neutral 0.5 so
 * a missing id neither rewards nor penalises.
 */
function identityMatch(a: string | null, b: string | null): number {
  if (a !== null && b !== null) return a === b ? 1.0 : 0.0;
  return 0.5;
}

/**
 * Same-developer axis. Normalises casing/whitespace before comparing so
 * "Paradox Development Studio" matches regardless of source formatting.
 */
function developerMatch(a: string | null, b: string | null): number {
  const na = a?.trim().toLowerCase() || null;
  const nb = b?.trim().toLowerCase() || null;
  return identityMatch(na, nb);
}

/**
 * Lowercase, trim, dedupe and drop non-discriminating umbrella labels
 * (see `GENRE_STOPLIST`) so the Jaccard reflects gameplay type only. Used
 * for both store `genres` and Steam community tags.
 */
function normaliseGenres(raw: string[]): string[] {
  const out = new Set<string>();
  for (const g of raw) {
    const key = g.trim().toLowerCase();
    if (key.length === 0 || GENRE_STOPLIST.has(key)) continue;
    out.add(key);
  }
  return [...out];
}

/**
 * Gameplay-type axis. Steam community tags are the finest available signal
 * (they tell a grand-strategy/4X title apart from a tower-defense
 * "Strategy" game, which the coarse store genre cannot), so we Jaccard over
 * the tag sets whenever BOTH games carry tags. Otherwise we fall back to
 * the store genres, and finally to neutral (0.5) when neither side has a
 * usable label — matching the `franchiseSimilarity` convention. The
 * fallback keeps the axis discriminating before the tag backfill has run.
 */
function gameplayTypeSimilarity(
  rowTags: string[],
  rowGenres: string[],
  targetTags: string[],
  targetGenres: string[],
): number {
  if (rowTags.length > 0 && targetTags.length > 0) {
    return setJaccard(rowTags, targetTags);
  }
  if (rowGenres.length > 0 && targetGenres.length > 0) {
    return setJaccard(rowGenres, targetGenres);
  }
  return 0.5;
}

/** Jaccard over two string sets; neutral (0.5) when either is empty. */
function setJaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0.5;
  const setA = new Set(a);
  let intersect = 0;
  for (const v of new Set(b)) if (setA.has(v)) intersect += 1;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersect / union : 0.5;
}

/**
 * Track-record tiers ordered NONE < MID < HIT. Exact match = 1.0,
 * one step apart = 0.5, two apart = 0.1. UNKNOWN is neutral (0.5).
 */
function trackRecordSimilarity(a: TrackRecordTier, b: TrackRecordTier): number {
  if (a === 'UNKNOWN' || b === 'UNKNOWN') return 0.5;
  if (a === b) return 1.0;
  const order: TrackRecordTier[] = ['NONE', 'MID', 'HIT'];
  const distance = Math.abs(order.indexOf(a) - order.indexOf(b));
  return distance === 1 ? 0.5 : 0.1;
}

function weightedMean(
  entries: Array<{ value: number; weight: number }>,
): number | null {
  const cleaned = entries.filter(
    (e) =>
      Number.isFinite(e.value) && Number.isFinite(e.weight) && e.weight > 0,
  );
  if (cleaned.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const { value, weight } of cleaned) {
    num += value * weight;
    den += weight;
  }
  return den > 0 ? num / den : null;
}

function parseTextArray(raw: string[] | string | null): string[] {
  if (raw === null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

function isPlatform(value: string): value is Platform {
  return (Object.values(Platform) as string[]).includes(value);
}

function nullableNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
