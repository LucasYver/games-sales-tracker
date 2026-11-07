/**
 * Whether the nightly IGDB refresh may move a game's release dates. Pure.
 *
 * `releaseDate` is the earliest launch across our platforms. It is written at
 * ingestion, from Steam or IGDB, and nothing re-read it afterwards, so a
 * delayed game kept its old date. The refresh now follows IGDB, but only for
 * games still waiting for their launch or with no date at all. A released
 * game keeps the dates it has: moving them would shift its estimates (first
 * week, per-platform launch) after the fact, for example to an early-access
 * date IGDB lists a week before the launch.
 */

/** Smaller gaps are time zones and store-entry rounding, not a new date. */
const MIN_CHANGE_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Earliest date across our platform buckets, else IGDB's own first date. */
export function igdbEarliestRelease(
  platformDates: Iterable<Date>,
  firstReleaseDate: Date | null,
): Date | null {
  let earliest: Date | null = null;
  for (const date of platformDates) {
    if (!earliest || date < earliest) earliest = date;
  }
  return earliest ?? firstReleaseDate;
}

/**
 * True while the launch is not behind us: no date yet, a date still in the
 * future, or IGDB now giving a future date (a delay announced after launch
 * day was stored, or a wrong past date).
 */
export function releaseDatesMayMove(
  current: Date | null,
  igdb: Date | null,
  now: Date,
): boolean {
  return !current || current > now || (igdb !== null && igdb > now);
}

/** The new `releaseDate`, or null to leave the stored one alone. */
export function nextReleaseDate(
  current: Date | null,
  igdb: Date | null,
  now: Date,
): Date | null {
  if (!igdb || !releaseDatesMayMove(current, igdb, now)) return null;
  if (
    current &&
    Math.abs(igdb.getTime() - current.getTime()) < MIN_CHANGE_DAYS * DAY_MS
  ) {
    return null;
  }
  return igdb;
}
