/** No estimate exists before 2017 (see the estimate-scope-2017 skill). */
const FIRST_HUB_YEAR = 2017;

/** Years that have a public page, newest first. */
export function hubYears(): number[] {
  const latest = new Date().getUTCFullYear();
  return Array.from(
    { length: latest - FIRST_HUB_YEAR + 1 },
    (_, index) => latest - index,
  );
}

/** The year page a release date belongs to, if it has one. */
export function hubYearOf(releaseDate: string | null): number | null {
  if (!releaseDate) return null;
  const year = new Date(releaseDate).getUTCFullYear();
  return hubYears().includes(year) && new Date(releaseDate) <= new Date()
    ? year
    : null;
}
