/**
 * The public site estimates only games released from 2017 on: before that, our
 * model is not reliable enough to give a precise estimate.
 * Older games keep their page and signals, and their published figures still
 * feed the series and studio track record of newer games. The admin still sees
 * their estimates, and can let one older game through by hand
 * (`game.estimateBeforeFloor`). See the `estimate-scope-2017` skill.
 */
export const ESTIMATE_MIN_RELEASE = new Date('2017-01-01T00:00:00.000Z');

/**
 * Released before the floor. A game with no known release date stays in
 * scope, and so does an older game the admin let through by hand
 * (`game.estimateBeforeFloor`).
 */
export function estimateOutOfScope(game: {
  releaseDate: Date | null;
  estimateBeforeFloor?: boolean | null;
}): boolean {
  return (
    !game.estimateBeforeFloor &&
    game.releaseDate !== null &&
    game.releaseDate < ESTIMATE_MIN_RELEASE
  );
}

/**
 * Whether the public site shows no estimate for a game: released before 2017
 * (unless let through by hand), or hidden by hand in the admin (`game.estimateHidden`) because its public
 * signals do not measure the game alone.
 */
export function estimateNotPublic(game: {
  releaseDate: Date | null;
  estimateHidden?: boolean | null;
  estimateBeforeFloor?: boolean | null;
}): boolean {
  return Boolean(game.estimateHidden) || estimateOutOfScope(game);
}

/** SQL twin of `estimateNotPublic`, negated: the game's estimate is public. */
export function estimatePublicSql(gameAlias: string): string {
  return `(NOT ${gameAlias}."estimateHidden" AND (${gameAlias}."releaseDate" IS NULL OR ${gameAlias}."releaseDate" >= :estimateMinRelease OR ${gameAlias}."estimateBeforeFloor"))`;
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
