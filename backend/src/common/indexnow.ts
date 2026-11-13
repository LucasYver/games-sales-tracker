import { Logger } from '@nestjs/common';
import axios from 'axios';
import { publicAppUrl } from '../blog/blog.types';

/**
 * Not a secret: IndexNow reads it from the public file
 * `frontend/public/<key>.txt`, which proves we own the host. Changing it means
 * renaming that file too.
 */
const INDEXNOW_KEY = '1a1d3cd8278eba0068e68c0d07f36906';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS_PER_REQUEST = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Mirrors `routing.locales` in `frontend/src/i18n/routing.ts`. */
const GAME_PAGE_LOCALES = ['en', 'fr', 'es', 'ru', 'ar'];

const logger = new Logger('IndexNow');

export function gamePageUrls(slug: string): string[] {
  return GAME_PAGE_LOCALES.map(
    (locale) => `${publicAppUrl()}/${locale}/game/${slug}`,
  );
}

/**
 * Sends URLs to IndexNow (Bing, Yandex and other participating engines; not
 * Google). Returns how many were accepted. Never throws: a search-engine
 * notification must not fail a publish or a cron, and the sitemap still lists
 * these pages.
 */
export async function submitToIndexNow(urls: string[]): Promise<number> {
  let accepted = 0;
  const base = publicAppUrl();
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
    const urlList = urls.slice(i, i + MAX_URLS_PER_REQUEST);
    try {
      await axios.post(
        INDEXNOW_ENDPOINT,
        {
          host: new URL(base).host,
          key: INDEXNOW_KEY,
          keyLocation: `${base}/${INDEXNOW_KEY}.txt`,
          urlList,
        },
        {
          timeout: REQUEST_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
      accepted += urlList.length;
    } catch (error) {
      logger.warn(`Submit of ${urlList.length} URLs failed: ${error}`);
    }
  }
  return accepted;
}

/** Production only, so local runs and previews never announce their pages. */
export async function notifyIndexNow(urls: string[]): Promise<void> {
  if (urls.length === 0 || process.env.VERCEL_ENV !== 'production') return;
  const accepted = await submitToIndexNow(urls);
  logger.log(`${accepted}/${urls.length} URLs accepted.`);
}
