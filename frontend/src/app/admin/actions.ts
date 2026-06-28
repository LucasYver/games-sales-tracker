'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ADMIN_COOKIE,
  adminFetch,
  type AdminGenreIgdbSyncResult,
  type AdminGenreProfile,
  type AdminGenreRow,
  type SalesSource,
  type Year2Retention,
} from '@/lib/admin';
import { API_URL } from '@/lib/api';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function signIn(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').trim();
  if (!token) redirect('/admin/login?error=missing');

  // Validate against the backend by hitting a cheap admin endpoint.
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/stats`, {
      headers: { 'X-Admin-Token': token },
      cache: 'no-store',
    });
  } catch {
    redirect('/admin/login?error=unreachable');
  }

  if (res.status === 401) redirect('/admin/login?error=invalid');
  if (!res.ok) redirect(`/admin/login?error=backend&code=${res.status}`);

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/admin',
  });
  redirect('/admin');
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect('/admin/login');
}

export async function deleteGame(id: string): Promise<void> {
  await adminFetch(`/games/${id}`, { method: 'DELETE' });
  revalidatePath('/admin/games');
  revalidatePath('/admin');
}

export interface AddGameResult {
  gameId: string;
  name: string;
  alreadyExisted: boolean;
  steamLinked: boolean;
}

export async function addGameByIgdbUrl(url: string): Promise<AddGameResult> {
  const result = await adminFetch<AddGameResult>('/games', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  revalidatePath('/admin/games');
  revalidatePath('/admin');
  return result;
}

export interface UpdateGamePayload {
  name?: string;
  releaseDate?: string | null;
  igdbId?: number | null;
  calibratedMultiplier?: number | null;
  calibratedPsMultiplier?: number | null;
  calibratedXboxMultiplier?: number | null;
  calibrationSourcePc?: SalesSource | null;
  calibrationSourcePs?: SalesSource | null;
  calibrationSourceXbox?: SalesSource | null;
  genreProfileId?: string | null;
}

export async function updateGame(
  id: string,
  payload: UpdateGamePayload,
): Promise<void> {
  await adminFetch(`/games/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  revalidatePath(`/admin/games/${id}`);
  revalidatePath('/admin/games');
}

export async function setGameGenreProfile(
  gameId: string,
  genreProfileId: string | null,
): Promise<void> {
  await adminFetch(`/games/${gameId}`, {
    method: 'PATCH',
    body: JSON.stringify({ genreProfileId }),
  });
  revalidatePath(`/admin/games/${gameId}`);
}

export async function refreshGame(
  id: string,
): Promise<{ found: boolean; articlesIngested: number }> {
  const result = await adminFetch<{ found: boolean; articlesIngested: number }>(
    `/games/${id}/refresh`,
    { method: 'POST' },
  );
  revalidatePath(`/admin/games/${id}`);
  revalidatePath('/admin/games');
  revalidatePath('/admin');
  return result;
}

export async function rebuildEstimates(
  id: string,
): Promise<{ points: number; estimates: number; snapshots: number }> {
  const result = await adminFetch<{
    points: number;
    estimates: number;
    snapshots: number;
  }>(`/games/${id}/rebuild`, { method: 'POST' });
  revalidatePath(`/admin/games/${id}`);
  return result;
}

export interface ImportCcuCsvResult {
  daysImported: number;
  rowsParsed: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  peakValue: number;
  peakAt: string | null;
}

export async function importCcuCsv(
  id: string,
  csv: string,
): Promise<ImportCcuCsvResult> {
  const result = await adminFetch<ImportCcuCsvResult>(
    `/games/${id}/import-ccu-csv`,
    { method: 'POST', body: JSON.stringify({ csv }) },
  );
  revalidatePath(`/admin/games/${id}`);
  return result;
}

export interface ImportReviewsCsvResult {
  daysImported: number;
  rowsParsed: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  latestTotal: number;
  latestRating: number | null;
}

export async function importReviewsCsv(
  id: string,
  csv: string,
): Promise<ImportReviewsCsvResult> {
  const result = await adminFetch<ImportReviewsCsvResult>(
    `/games/${id}/import-reviews-csv`,
    { method: 'POST', body: JSON.stringify({ csv }) },
  );
  revalidatePath(`/admin/games/${id}`);
  return result;
}

export interface BackfillReviewsResult {
  daysImported: number;
  reviewsFetched: number;
  reportedTotal: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  latestTotal: number;
  latestRating: number | null;
}

export async function backfillReviews(
  id: string,
): Promise<BackfillReviewsResult> {
  const result = await adminFetch<BackfillReviewsResult>(
    `/games/${id}/backfill-reviews`,
    { method: 'POST' },
  );
  revalidatePath(`/admin/games/${id}`);
  return result;
}

export async function deleteMilestone(id: string): Promise<void> {
  await adminFetch(`/milestones/${id}`, { method: 'DELETE' });
  revalidatePath('/admin/milestones');
  revalidatePath('/admin/issues');
}

export async function deleteSignal(id: string, gameId: string): Promise<void> {
  await adminFetch(`/signals/${id}`, { method: 'DELETE' });
  revalidatePath(`/admin/games/${gameId}`);
}

export async function deleteTrustedSource(id: string): Promise<void> {
  await adminFetch(`/trusted-sources/${id}`, { method: 'DELETE' });
  revalidatePath('/admin/trusted-sources');
}

export async function startIgdbBackfill(): Promise<{
  started: boolean;
  total: number;
}> {
  return adminFetch('/backfill/igdb', { method: 'POST' });
}

export async function getIgdbBackfillStatus() {
  return adminFetch<import('@/lib/admin').IgdbBackfillStatus>(
    '/backfill/igdb',
  );
}

export async function updatePublisherSteamShare(
  id: string,
  steamSharePctLow: number,
  steamSharePctHigh: number,
): Promise<void> {
  await adminFetch(`/publishers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ steamSharePctLow, steamSharePctHigh }),
  });
  revalidatePath('/admin/publishers');
  revalidatePath(`/admin/publishers/${id}`);
}

export async function runPublisherBackfill(): Promise<{
  linked: number;
  alreadyLinked: number;
  unmatched: number;
}> {
  const result = await adminFetch<{
    linked: number;
    alreadyLinked: number;
    unmatched: number;
  }>('/publishers/backfill', { method: 'POST' });
  revalidatePath('/admin/publishers');
  return result;
}

export interface UpdateGenreProfilePayload {
  name?: string;
  description?: string | null;
  pcShare?: number;
  playstationShare?: number;
  xboxShare?: number;
  switchShare?: number;
  leanLabel?: string | null;
  lifecycleIndex?: number;
  firstWeekToYearOneMultiplier?: number;
  year2Retention?: Year2Retention;
  lifecycleDriver?: string | null;
  peakCcuToWeekOneLow?: number;
  peakCcuToWeekOneHigh?: number;
  pcDefaultBoxleiterLow?: number | null;
  pcDefaultBoxleiterHigh?: number | null;
  psDefaultBoxleiterLow?: number | null;
  psDefaultBoxleiterHigh?: number | null;
}

export async function updateGenreProfile(
  id: string,
  payload: UpdateGenreProfilePayload,
): Promise<AdminGenreProfile> {
  const result = await adminFetch<AdminGenreProfile>(`/genre-profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  revalidatePath('/admin/genre-profiles');
  revalidatePath(`/admin/genre-profiles/${id}`);
  return result;
}

export async function updateGenreProfileAssignment(
  id: string,
  profileId: string | null,
): Promise<AdminGenreRow> {
  const result = await adminFetch<AdminGenreRow>(`/genres/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ profileId }),
  });
  revalidatePath('/admin/genre-profiles');
  return result;
}

export async function syncGenresFromIgdb(): Promise<AdminGenreIgdbSyncResult> {
  const result = await adminFetch<AdminGenreIgdbSyncResult>(
    '/genres/sync-igdb',
    { method: 'POST' },
  );
  revalidatePath('/admin/genre-profiles');
  return result;
}
