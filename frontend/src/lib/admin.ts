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
  region: string;
  confidenceScore: number | null;
  publisher: string | null;
  sourceUrl: string | null;
  note: string | null;
  reportedAt: string | null;
  capturedAt: string;
  isEngagement: boolean;
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
  steamSharePctLow: number;
  steamSharePctHigh: number;
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
  genreProfileId: string | null;
  genreProfileManual: boolean;
  lastRefreshedAt: string | null;
  allTimePeakCcu: number | null;
  allTimePeakCcuAt: string | null;
  publisher: string | null;
  publisherRecord: {
    id: string;
    name: string;
    steamSharePctLow: number;
    steamSharePctHigh: number;
  } | null;
  sources: AdminGameSource[];
  milestones: AdminMilestone[];
  estimates: AdminEstimate[];
  signals: AdminSignal[];
  ccuHistory: AdminCcuPoint[];
  reviewHistory: AdminCcuPoint[];
  prices: AdminPriceSnapshot[];
  achievementSnapshots: AdminAchievementSummary[];
  estimateSnapshots: AdminEstimateSnapshot[];
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

export interface IgdbBackfillStatus {
  running: boolean;
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
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

export interface AdminGenreProfile {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  pcShare: number;
  playstationShare: number;
  xboxShare: number;
  switchShare: number;
  leanLabel: string | null;
  lifecycleIndex: number;
  firstWeekToYearOneMultiplier: number;
  year2Retention: Year2Retention;
  lifecycleDriver: string | null;
  peakCcuToWeekOneLow: number;
  peakCcuToWeekOneHigh: number;
  pcDefaultBoxleiterLow: number | null;
  pcDefaultBoxleiterHigh: number | null;
  psDefaultBoxleiterLow: number | null;
  psDefaultBoxleiterHigh: number | null;
  genreCount: number;
  gameCount: number;
  updatedAt: string;
}

export interface AdminGenreRow {
  id: string;
  slug: string;
  name: string;
  source: GenreSourceLabel;
  externalId: number | null;
  profileId: string | null;
  profileSlug: string | null;
  profileName: string | null;
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
  finalLow: number;
  finalHigh: number;
}

export interface WeightedBreakdownEntry {
  method: string;
  weight: number;
}

export interface PlatformBreakdownResult {
  platform: Platform;
  entries: (BoxleiterBreakdownEntry | FirstWeekBreakdownEntry)[];
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
