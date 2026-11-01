/**
 * Google AdSense settings. Leave them unset and the site loads no ad code:
 * no script, no ad block and no ads.txt. Both are read at build time.
 */

/** Publisher id, `ca-pub-…`. Loads the script and serves ads.txt. */
export const ADSENSE_CLIENT =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || null;

/** Ad unit shown at the bottom of game pages. */
export const ADSENSE_GAME_SLOT =
  process.env.NEXT_PUBLIC_ADSENSE_GAME_SLOT?.trim() || null;
