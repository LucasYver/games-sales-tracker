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
