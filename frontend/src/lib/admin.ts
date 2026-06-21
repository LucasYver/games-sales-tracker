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
  salesRecords: {
    total: number;
    bySource: Record<SalesSource, number>;
    byPlatform: Record<Platform, number>;
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
  salesRecordsCount: number;
  estimatesCount: number;
  latestReviews: number | null;
  latestReviewsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminGameSource {
  id: string;
  source: string;
  externalId: string;
  data: unknown;
}

export interface AdminSalesRecord {
  id: string;
  gameId: string;
  platform: Platform;
  source: SalesSource;
  units: number;
  region: string;
  confidence: ConfidenceLevel | null;
  publisher: string | null;
  sourceUrl: string | null;
  note: string | null;
  reportedAt: string | null;
  capturedAt: string;
}

export interface AdminSalesRecordWithGame extends AdminSalesRecord {
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

export interface AdminSignal {
  id: string;
  gameId: string;
  source: string;
  metric: string;
  value: number;
  capturedAt: string;
}

export interface AdminGameDetail extends AdminGameSummary {
  igdbId: number | null;
  coverUrl: string | null;
  summary: string | null;
  sources: AdminGameSource[];
  salesRecords: AdminSalesRecord[];
  estimates: AdminEstimate[];
  signals: AdminSignal[];
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
  createdAt: string;
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
  undatedSalesRecords: IssueGroup<AdminSalesRecordWithGame>;
  suspectQuotes: IssueGroup<AdminSalesRecordWithGame>;
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
}
