import axios from 'axios';
import { publicAppUrl } from '../blog/blog.types';
import { submitToIndexNow } from '../common/indexnow';

/**
 * One-off: sends every URL of the live sitemap to IndexNow. After this first
 * send, new games and published posts are sent as they appear (see
 * `notifyIndexNow`), so there is no reason to run it on a schedule: IndexNow
 * asks for changed pages only.
 *
 * Reads the public sitemap and opens no database connection. The key file must
 * already be live, so run it after the deploy that ships it.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/submit-indexnow.ts [--dry-run]
 */

async function fetchLocs(url: string): Promise<string[]> {
  const { data } = await axios.get<string>(url, { responseType: 'text' });
  return [...data.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = await fetchLocs(`${publicAppUrl()}/sitemap.xml`);
  const urls: string[] = [];
  for (const file of files) urls.push(...(await fetchLocs(file)));
  console.log(`${urls.length} URLs in ${files.length} sitemap files.`);
  if (dryRun) return;

  const accepted = await submitToIndexNow(urls);
  console.log(`${accepted}/${urls.length} URLs accepted.`);
  if (accepted < urls.length) process.exitCode = 1;
}

void main();
