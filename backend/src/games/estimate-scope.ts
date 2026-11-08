/**
 * The public site estimates only games released from 2017 on: before that, our
 * model is not reliable enough to give a precise estimate.
 * Older games keep their page and signals, and their published figures still
 * feed the series and studio track record of newer games. The admin still sees
 * their estimates. See the `estimate-scope-2017` skill.
 */
export const ESTIMATE_MIN_RELEASE = new Date('2017-01-01T00:00:00.000Z');

/** A game with no known release date stays in scope. */
export function estimateOutOfScope(releaseDate: Date | null): boolean {
  return releaseDate !== null && releaseDate < ESTIMATE_MIN_RELEASE;
}

/**
 * A game whose release date is still ahead has no sales yet: the public site
 * shows no figure, no platform split and no declared milestone until launch.
 */
export function awaitingRelease(
  releaseDate: Date | null,
  now: Date = new Date(),
): boolean {
  return releaseDate !== null && releaseDate > now;
}

/**
 * SQL twin of the launch rule for a snapshot or estimate row: only a figure
 * computed from a signal captured after launch is public. Estimates rebuilt
 * before release (pre-orders, ratings on a store page) stay admin-only.
 */
export function computedAfterReleaseSql(
  gameAlias: string,
  computedAt: string,
): string {
  return `(${gameAlias}."releaseDate" IS NULL OR (${gameAlias}."releaseDate" <= NOW() AND ${computedAt} >= ${gameAlias}."releaseDate"))`;
}
