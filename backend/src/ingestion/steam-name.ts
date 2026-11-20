/**
 * Whether two store names are the same title once case, spacing, width and
 * trademark signs are ignored: "ELDEN RING" and "Elden Ring", "DOOM®" and
 * "DOOM". Used to keep a localized name only when it really differs.
 */
export function sameGameName(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[™®©℠]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
