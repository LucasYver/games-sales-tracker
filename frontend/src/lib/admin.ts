import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL } from './api';

export const ADMIN_COOKIE = 'admin_token';

/**
 * Read the admin token from the session cookie. Returns null when unset so
 * callers can redirect to the login page rather than crash.
 */
export async function getAdminToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ADMIN_COOKIE)?.value ?? null;
}

/**
 * Require an admin token. Redirects to the login page when missing. Used at
 * the top of every protected admin server component.
 */
export async function requireAdminToken(): Promise<string> {
  const token = await getAdminToken();
  if (!token) redirect('/admin/login');
  return token;
}

/**
 * Authenticated fetch against the admin backend endpoints. Always passes the
 * token from the session cookie; redirects to login on 401.
 */
export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await requireAdminToken();
  const res = await fetch(`${API_URL}/admin${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'X-Admin-Token': token,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (res.status === 401) {
    redirect('/admin/login?reason=expired');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Admin API ${path} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---- Shared admin DTOs (mirror the backend AdminService types) -------------

import type {
  ConfidenceLevel,
  Platform,
  SalesSourceLabel,
} from './api';

export type SalesSource = Exclude<SalesSourceLabel, 'ESTIMATE'>;

export interface AdminStats {
  games: {
    total: number;
    withSales: number;
    withEstimate: number;
    withCalibration: number;
  };
  milestones: {
    total: number;
    bySource: Record<SalesSource, number>;
    undated: number;
  };
  signals: { steamReviewsTotal: number; lastCapturedAt: string | null };
  trustedSources: { total: number; active: number; withFeed: number };
  estimates: { total: number };
}

export interface AdminGameSummary {
  id: string;
  name: string;
  slug: string;
  releaseDate: string | null;
  isFree: boolean;
  platforms: Platform[];
  calibratedMultiplier: number | null;
  calibratedPsMultiplier: number | null;
  calibratedXboxMultiplier: number | null;
  calibrationSourcePc: SalesSource | null;
  calibrationSourcePs: SalesSource | null;
  calibrationSourceXbox: SalesSource | null;
  hasMilestone: boolean;
  hasEstimate: boolean;
  lastRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// IGDB `release_dates` broken out per platform, e.g. a PlayStation launch a
// year ahead of the PC port. Empty when IGDB had no breakdown for this game;
// `releaseDate` (earliest across all platforms) is then the only known date.
export interface AdminPlatformReleaseDate {
  platform: Platform;
  releaseDate: string;
}

export interface AdminGameSource {
  id: string;
  source: string;
  externalId: string;
  data: unknown;
}

export interface AdminMilestone {
  id: string;
  gameId: string;
  source: SalesSource;
  units: number;
  platform: string;
  confidenceScore: number | null;
  publisher: string | null;
  sourceUrl: string | null;
  note: string | null;
  reportedAt: string | null;
  capturedAt: string;
  isEngagement: boolean;
  isEstimate: boolean;
}

export interface AdminMilestoneWithGame extends AdminMilestone {
  gameName: string;
}

export interface AdminEstimate {
  id: string;
  gameId: string;
  platform: Platform;
  estimatedLow: number;
  estimatedHigh: number;
  confidence: ConfidenceLevel;
  method: string;
  computedAt: string;
}

export interface AdminCcuPoint {
  capturedAt: string;
  value: number;
}

// One row of the home-grown review-velocity rank leaderboard (game_rank).
export interface AdminRankRow {
  gameId: string;
  name: string;
  year: number | null;
  weeksCharted: number;
  peakRank: number;
  avgRank: number;
  peakPercentile: number;
  avgPercentile: number;
  weeksTopDecile: number;
  computedAt: string;
}

export interface AdminSignal {
  id: string;
  gameId: string;
  source: string;
  metric: string;
  value: number;
  capturedAt: string;
}

export interface AdminPriceSnapshot {
  id: string;
  gameId: string;
  // ISO 4217 currency code (e.g. "USD").
  currency: string;
  // Regular and current prices in the currency's minor units (cents).
  initial: number;
  final: number;
  discountPercent: number;
  capturedAt: string;
}

export interface LatestSignal {
  metric: string;
  value: number;
  capturedAt: string;
}

// Pinned header + Overview payload (GET /admin/games/:id/summary). Lightweight:
// no heavy time-series (those load from the Charts tab).
export interface AdminGamePageSummary {
  id: string;
  name: string;
  slug: string;
  coverUrl: string | null;
  summary: string | null;
  releaseDate: string | null;
  platforms: Platform[];
  isFree: boolean;
  developer: string | null;
  publisher: string | null;
  publisherRecord: {
    id: string;
    name: string;
  } | null;
  genres: string[];
  categories: string[];
  steamTags: string[];
  dlc: number[];
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  iterationNumber: number | null;
  liveService: boolean;
  excludedFromReference: boolean;
  igdbId: number | null;
  lastRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
  calibratedMultiplier: number | null;
  calibratedPsMultiplier: number | null;
  calibratedXboxMultiplier: number | null;
  calibrationSourcePc: SalesSource | null;
  calibrationSourcePs: SalesSource | null;
  calibrationSourceXbox: SalesSource | null;
  sources: AdminGameSource[];
  latestSignals: LatestSignal[];
  peakCcu: { value: number; capturedAt: string } | null;
  homeRank: {
    weeksCharted: number;
    peakRank: number;
    avgRank: number;
    peakPercentile: number;
    weeksTopDecile: number;
  } | null;
  latestEstimate: {
    computedAt: string;
    estimatedTodayLow: number;
    estimatedTodayHigh: number;
    reconciliation: unknown;
  } | null;
  milestones: AdminMilestone[];
  milestonesCount: number;
  estimatesCount: number;
  platformReleaseDates: AdminPlatformReleaseDate[];
}

// Charts-tab payload (GET /admin/games/:id/charts).
export interface AdminGameChartsData {
  ccuHistory: AdminCcuPoint[];
  reviewHistory: AdminCcuPoint[];
  followersHistory: AdminCcuPoint[];
  psRatingsHistory: AdminCcuPoint[];
  psRatingsSyntheticHistory: AdminCcuPoint[];
  xboxRatingsHistory: AdminCcuPoint[];
  switchRatingsHistory: AdminCcuPoint[];
  prices: AdminPriceSnapshot[];
  signals: AdminSignal[];
}

export interface AdminAchievementSummary {
  platform: Platform;
  source: string;
  achievementsCount: number;
  playersTracked: number | null;
  mostCommonName: string;
  mostCommonPercent: number;
  mostCommonPlayers: number | null;
  capturedAt: string;
}

export interface AdminReconciliationEntry {
  platform: Platform;
  declaredUnits: number;
  declaredSource: string;
  declaredAt: string | null;
  estimateLow: number;
  estimateHigh: number;
  estimateMethod: string;
  agreement: 'strong' | 'weak' | 'conflict';
  ratio: number;
  detail: string;
}

export interface AdminEstimateSnapshot {
  computedAt: string;
  estimatedTodayLow: number;
  estimatedTodayHigh: number;
  // "Pure algo" headline: same range but computed with all
  // calibrated multipliers disabled AND no declared-figure floor/cap
  // in the reconciliation step. Nullable: snapshots persisted before
  // the column was introduced don't have it.
  pureEstimatedTodayLow: number | null;
  pureEstimatedTodayHigh: number | null;
  reconciliation: AdminReconciliationEntry[];
}

export interface AdminPublisherSummary {
  id: string;
  name: string;
  gameCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPublisherDetail extends AdminPublisherSummary {
  games: Array<{
    id: string;
    name: string;
    slug: string;
    releaseDate: string | null;
    coverUrl: string | null;
  }>;
}

export interface AdminGameDetail extends AdminGameSummary {
  milestonesCount: number;
  estimatesCount: number;
  latestReviews: number | null;
  latestReviewsAt: string | null;
  igdbId: number | null;
  coverUrl: string | null;
  summary: string | null;
  genres: string[];
  categories: string[];
  steamTags: string[];
  dlc: number[];
  developer: string | null;
  franchiseSlug: string | null;
  isAnnualIteration: boolean;
  iterationNumber: number | null;
  liveService: boolean;
  lastRefreshedAt: string | null;
  allTimePeakCcu: number | null;
  allTimePeakCcuAt: string | null;
  publisher: string | null;
  publisherRecord: {
    id: string;
    name: string;
  } | null;
  sources: AdminGameSource[];
  milestones: AdminMilestone[];
  estimates: AdminEstimate[];
  signals: AdminSignal[];
  ccuHistory: AdminCcuPoint[];
  reviewHistory: AdminCcuPoint[];
  followersHistory: AdminCcuPoint[];
  prices: AdminPriceSnapshot[];
  achievementSnapshots: AdminAchievementSummary[];
  estimateSnapshots: AdminEstimateSnapshot[];
  platformReleaseDates: AdminPlatformReleaseDate[];
}

export interface AdminTrustedSource {
  id: string;
  slug: string;
  name: string;
  category: string;
  salesSource: SalesSource;
  host: string | null;
  handle: string | null;
  url: string | null;
  searchUrlTemplate: string | null;
  feedUrl: string | null;
  language: string;
  weight: number;
  active: boolean;
  autoCreated: boolean;
  createdAt: string;
  // Number of non-rejected milestones linked to this source via the URL
  // hostname (exact host or subdomain match). Populated by the admin
  // listing endpoint; absent from the issue payload (inactive sources
  // don't carry it).
  recordCount?: number;
}

export interface PaginatedAdmin<T> {
  items: T[];
  total: number;
}

export interface IssueGroup<T> {
  count: number;
  items: T[];
}

export interface AdminIssues {
  undatedMilestones: IssueGroup<AdminMilestoneWithGame>;
  suspectQuotes: IssueGroup<AdminMilestoneWithGame>;
  calibrationOutliers: IssueGroup<{
    gameId: string;
    gameName: string;
    platform: Platform;
    calibratedMultiplier: number;
  }>;
  staleGames: IssueGroup<{
    gameId: string;
    gameName: string;
    lastSignalAt: string | null;
  }>;
  inactiveTrustedSources: IssueGroup<AdminTrustedSource>;
  gamesWithoutAnySignal: IssueGroup<{ id: string; name: string; slug: string }>;
  estimationDiscrepancies: IssueGroup<AdminEstimationDiscrepancy>;
}

export type GenreSourceLabel = 'IGDB' | 'STEAM' | 'MANUAL';

export type Year2Retention =
  | 'NEGATIVE'
  | 'VERY_LOW'
  | 'LOW'
  | 'LOW_MEDIUM'
  | 'MEDIUM'
  | 'MEDIUM_HIGH'
  | 'HIGH'
  | 'VERY_HIGH';


// ─── Reference profiles / matcher (data-driven "Forme C") ───────────────────

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

export type ReferencePlatformClass =
  | 'PC_ONLY'
  | 'CONSOLE_ONLY'
  | 'PC_PLUS_CONSOLE'
  | 'UNKNOWN';

export interface AdminReferenceProfile {
  gameId: string;
  gameName: string;
  gameSlug: string;
  scaleUnits: number | null;
  reviewsToUnits: number | null;
  globalReviewsToUnits: number | null;
  peakCcuRatio: number | null;
  curve: AdminReferenceCurve;
  platformShares: AdminReferencePlatformShares | null;
  qualityScore: number;
  platformClass: ReferencePlatformClass;
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
    globalReviewsToUnits: number;
    platformShares: number;
  };
  quality: {
    mean: number;
    median: number;
    min: number;
    max: number;
  };
  platformClass: Record<ReferencePlatformClass, number>;
  scaleBuckets: AdminCorpusBucket[];
  qualityBuckets: AdminCorpusBucket[];
}

export interface FeatureContribution {
  feature: string;
  score: number;
  weight: number;
  contribution: number;
}

export interface MatchSelection {
  playMode: string;
  k: number;
  candidatesConsidered: number;
  platformFiltered: boolean;
  weights: Record<string, number>;
}

export interface AdminMatchedNeighbour {
  gameId: string;
  gameName: string;
  gameSlug: string;
  similarity: number;
  weight: number;
  featureContributions: FeatureContribution[];
  // The anchor's own observed reference vector (what it contributes to the aggregate).
  profile: AdminReferenceProfile | null;
}

export interface AdminResolvedProfile {
  matchedSlugs: string[];
  pcShare: number;
  playstationShare: number;
  xboxShare: number;
  switchShare: number;
  firstWeekToYearOneMultiplier: number;
  year2Retention: Year2Retention;
  tailFactorY2: number;
  tailFactorY5: number;
  lifecycleIndex: number;
  peakCcuToWeekOneLow: number;
  peakCcuToWeekOneHigh: number;
  pcDefaultBoxleiterLow: number | null;
  pcDefaultBoxleiterHigh: number | null;
  psDefaultBoxleiterLow: number | null;
  psDefaultBoxleiterHigh: number | null;
}

export interface AdminMatcherInspection {
  matcherEnabled: boolean;
  isAnchor: boolean;
  coldStart: boolean;
  neighboursUsed: number;
  reviewsToUnits: number | null;
  globalReviewsToUnits: number | null;
  peakCcuRatio: number | null;
  curve: AdminReferenceCurve;
  platformShares: AdminReferencePlatformShares | null;
  neighbours: AdminMatchedNeighbour[];
  selection: MatchSelection | null;
  resolved: AdminResolvedProfile | null;
  anchorProfile: AdminReferenceProfile | null;
}

export interface AdminGenreRow {
  id: string;
  slug: string;
  name: string;
  source: GenreSourceLabel;
  externalId: number | null;
  updatedAt: string;
}

export interface AdminGenreIgdbSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

export interface AdminEstimationDiscrepancy {
  gameId: string;
  gameName: string;
  platform: Platform;
  declaredUnits: number;
  declaredSource: SalesSource;
  declaredAt: string | null;
  priorEstimateLow: number;
  priorEstimateHigh: number;
  ratio: number;
  detectedAt: string;
}

// ─── Estimate breakdown (diagnostic) ────────────────────────────────────────

export interface BoxleiterBreakdownEntry {
  type: 'boxleiter';
  platform: Platform;
  method: string;
  signal: { metric: string; value: number; capturedAt: string };
  calibratedValue: number | null;
  isCalibrated: boolean;
  multiplierSource: 'matcher' | 'global' | 'calibrated';
  multiplierLow: number;
  multiplierHigh: number;
  finalLow: number;
  finalHigh: number;
}

export interface FirstWeekBreakdownEntry {
  type: 'first-week';
  method: string;
  launchPeakValue: number;
  launchPeakCapturedAt: string;
  ccuRatioLow: number;
  ccuRatioHigh: number;
  weekOneFinalLow: number;
  weekOneFinalHigh: number;
  ageDays: number;
  projectionMultiplier: number;
  m1: number | null;
  profileSource: 'matcher' | 'global';
  finalLow: number;
  finalHigh: number;
}

export interface SplitBreakdownEntry {
  type: 'split';
  platform: Platform;
  method: string;
  sourcePlatform: Platform;
  sourceLow: number;
  sourceHigh: number;
  sourceShare: number;
  targetShare: number;
  ratio: number;
  finalLow: number;
  finalHigh: number;
}

export interface WeightedBreakdownEntry {
  method: string;
  weight: number;
}

export interface PlatformBreakdownResult {
  platform: Platform;
  entries: (
    | BoxleiterBreakdownEntry
    | FirstWeekBreakdownEntry
    | SplitBreakdownEntry
  )[];
  weightedEntries: WeightedBreakdownEntry[];
  totalWeight: number;
  weightedLow: number;
  weightedHigh: number;
  disagreement: number;
  inflate: number;
  aggregateLow: number;
  aggregateHigh: number;
}

export interface AdminEstimateBreakdown {
  computedAt: string;
  platforms: PlatformBreakdownResult[];
  pureTotal: { low: number; high: number } | null;
  declared: {
    units: number;
    source: string;
    reportedAt: string | null;
  } | null;
}
