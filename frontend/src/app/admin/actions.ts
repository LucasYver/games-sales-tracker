'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import {
  ADMIN_COOKIE,
  adminFetch,
  type AdminBlogDetail,
  type AdminGenreIgdbSyncResult,
  type SalesSource,
} from '@/lib/admin';
import { API_URL } from '@/lib/api';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/admin/login?error=missing');

  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    redirect('/admin/login?error=unreachable');
  }

  if (res.status === 401) redirect('/admin/login?error=invalid');
  if (!res.ok) redirect(`/admin/login?error=backend&code=${res.status}`);

  const body = (await res.json()) as { token: string };
  if (!body.token) redirect('/admin/login?error=backend');

  const store = await cookies();
  store.set(ADMIN_COOKIE, body.token, {
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

export async function recomputeRanks(): Promise<void> {
  await adminFetch('/ranks/recompute', { method: 'POST' });
  revalidatePath('/admin/ranks');
}

export async function setReferenceExclusion(
  gameId: string,
  excluded: boolean,
): Promise<void> {
  await adminFetch(`/games/${gameId}/reference-exclusion`, {
    method: 'POST',
    body: JSON.stringify({ excluded }),
  });
  revalidatePath(`/admin/games/${gameId}`);
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

export interface UpdateMilestonePayload {
  source?: SalesSource;
  platform?: string;
  units?: number;
  publisher?: string | null;
  sourceUrl?: string | null;
  note?: string | null;
  reportedAt?: string | null;
  isEngagement?: boolean;
  isEstimate?: boolean;
  confidenceScore?: number | null;
}

export interface CreateMilestonePayload {
  source: SalesSource;
  units: number;
  reportedAt: string;
  platform?: string;
  publisher?: string | null;
  sourceUrl?: string | null;
  note?: string | null;
  isEngagement?: boolean;
  isEstimate?: boolean;
  confidenceScore?: number | null;
}

export async function createMilestone(
  gameId: string,
  payload: CreateMilestonePayload,
): Promise<void> {
  await adminFetch(`/games/${gameId}/milestones`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  revalidatePath('/admin/milestones');
  revalidatePath(`/admin/games/${gameId}`);
}

export async function updateMilestone(
  id: string,
  gameId: string,
  payload: UpdateMilestonePayload,
): Promise<void> {
  await adminFetch(`/milestones/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  revalidatePath('/admin/milestones');
  revalidatePath(`/admin/games/${gameId}`);
  revalidatePath('/admin/trusted-sources', 'layout');
}

export async function deleteMilestone(
  id: string,
  gameId: string,
): Promise<void> {
  const result = await adminFetch<{ deleted: boolean }>(`/milestones/${id}`, {
    method: 'DELETE',
  });
  if (!result.deleted) {
    throw new Error('Milestone was not deleted (already removed?)');
  }
  revalidatePath('/admin/milestones');
  revalidatePath(`/admin/games/${gameId}`);
  revalidatePath('/admin/trusted-sources', 'layout');
}

export async function deleteSignal(id: string, gameId: string): Promise<void> {
  await adminFetch(`/signals/${id}`, { method: 'DELETE' });
  revalidatePath(`/admin/games/${gameId}`);
}

export interface UpdateTrustedSourcePayload {
  name?: string;
  category?: string;
  salesSource?: string;
  host?: string | null;
  handle?: string | null;
  url?: string | null;
  searchUrlTemplate?: string | null;
  feedUrl?: string | null;
  language?: string;
}

export async function updateTrustedSource(
  id: string,
  payload: UpdateTrustedSourcePayload,
): Promise<void> {
  await adminFetch(`/trusted-sources/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  revalidatePath('/admin/trusted-sources', 'layout');
}

export async function setTrustedSourceActive(
  id: string,
  active: boolean,
): Promise<void> {
  await adminFetch(`/trusted-sources/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });
  revalidatePath('/admin/trusted-sources');
}

export async function deleteTrustedSource(id: string): Promise<void> {
  await adminFetch(`/trusted-sources/${id}`, { method: 'DELETE' });
  revalidatePath('/admin/trusted-sources');
}

export async function rejectTrustedSourceMilestones(
  id: string,
): Promise<{ rejected: number }> {
  const result = await adminFetch<{ rejected: number }>(
    `/trusted-sources/${id}/milestones`,
    { method: 'DELETE' },
  );
  revalidatePath('/admin/trusted-sources', 'layout');
  revalidatePath('/admin/milestones');
  return result;
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

export async function syncGenresFromIgdb(): Promise<AdminGenreIgdbSyncResult> {
  const result = await adminFetch<AdminGenreIgdbSyncResult>(
    '/genres/sync-igdb',
    { method: 'POST' },
  );
  revalidatePath('/admin/genres');
  return result;
}

export interface SteamPsBackfillResult {
  started: boolean;
  alreadyRunning: boolean;
  games: number;
  tasks: {
    ccu: number;
    reviews: number;
    followers: number;
    ratings: number;
  };
}

export async function generateBlogDraft(
  gameId: string,
): Promise<AdminBlogDetail> {
  const result = await adminFetch<AdminBlogDetail>(
    `/games/${gameId}/blog-draft`,
    { method: 'POST' },
  );
  revalidatePath('/admin/blog');
  revalidatePath(`/admin/blog/${result.id}`);
  revalidatePath(`/admin/games/${gameId}`);
  return result;
}

function revalidatePublicBlog(post: AdminBlogDetail) {
  updateTag('blog');
  revalidatePath('/blog', 'layout');
  revalidatePath('/en/blog', 'layout');
  revalidatePath('/fr/blog', 'layout');
  for (const [locale, slug] of Object.entries(post.slugs ?? {})) {
    if (!slug) continue;
    revalidatePath(`/${locale}/blog/${slug}`);
    revalidatePath(`/blog/${slug}`);
  }
  if (post.gameSlug) {
    revalidatePath(`/en/game/${post.gameSlug}`);
    revalidatePath(`/fr/game/${post.gameSlug}`);
    revalidatePath(`/game/${post.gameSlug}`);
  }
}

export async function publishBlogPost(
  id: string,
  force = false,
): Promise<AdminBlogDetail> {
  const result = await adminFetch<AdminBlogDetail>(`/blog/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
  revalidatePath('/admin/blog');
  revalidatePath(`/admin/blog/${id}`);
  revalidatePublicBlog(result);
  return result;
}

export async function rejectBlogPost(
  id: string,
  reason?: string,
): Promise<AdminBlogDetail> {
  const result = await adminFetch<AdminBlogDetail>(`/blog/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  revalidatePath('/admin/blog');
  revalidatePath(`/admin/blog/${id}`);
  // Rejecting a refresh puts the previous live version back.
  if (result.isLive) revalidatePublicBlog(result);
  return result;
}

export async function unpublishBlogPost(id: string): Promise<AdminBlogDetail> {
  const result = await adminFetch<AdminBlogDetail>(`/blog/${id}/unpublish`, {
    method: 'POST',
  });
  revalidatePath('/admin/blog');
  revalidatePath(`/admin/blog/${id}`);
  revalidatePublicBlog(result);
  return result;
}

export async function updateBlogTranslation(
  id: string,
  locale: 'en' | 'fr',
  body: {
    title?: string;
    metaDescription?: string;
    excerpt?: string;
    tldr?: string[];
    bodyMarkdown?: string;
    faq?: { question: string; answer: string }[];
  },
): Promise<AdminBlogDetail> {
  const result = await adminFetch<AdminBlogDetail>(
    `/blog/${id}/translations/${locale}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  revalidatePath(`/admin/blog/${id}`);
  if (result.status === 'PUBLISHED') revalidatePublicBlog(result);
  return result;
}

export async function runSteamPsBackfill(): Promise<SteamPsBackfillResult> {
  const result = await adminFetch<SteamPsBackfillResult>('/backfill-steam-ps', {
    method: 'POST',
  });
  revalidatePath('/admin');
  return result;
}
