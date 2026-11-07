import { companyKey } from './game-companies';

type Query = <T = unknown>(sql: string, params?: unknown[]) => Promise<T>;

export type GameCompany = {
  id: string;
  /** The company name on the game (`game.publisher` / `game.developer`). */
  name: string | null;
  /** The current link, when known: games already right are skipped. */
  linkedId?: string | null;
};

/** How long an instance trusts its copy of the registry. */
const REGISTRY_TTL_MS = 10 * 60 * 1000;

/**
 * One row per company in `table` (`publisher`, `developer`) and the game's
 * link to it (`column`). Spellings of one company share a row (`companyKey`:
 * "CAPCOM Co., Ltd." joins "Capcom"); `canonical` can send a name to a
 * curated row (renames, subsidiaries). A name nobody has met gets its row.
 * Each call costs one read of the registry (cached), at most one insert and
 * one update.
 */
export class CompanyRegistry {
  private cache: { byKey: Map<string, string>; loadedAt: number } | null = null;

  constructor(
    private readonly query: Query,
    private readonly table: 'publisher' | 'developer',
    private readonly column: 'publisherId' | 'developerId',
    private readonly canonical: (name: string) => string = (name) => name,
    /** Names that win a key shared with other rows. */
    private readonly preferred: ReadonlySet<string> = new Set(),
  ) {}

  /** Returns the number of games whose link changed. */
  async linkGames(games: GameCompany[]): Promise<number> {
    if (games.length === 0) return 0;
    const target = (raw: string | null) => {
      const name = raw?.trim();
      return name ? this.canonical(name) : null;
    };
    const keyOf = (name: string) => companyKey(name) || name.toLowerCase();

    let byKey = await this.load();
    const missing = new Map<string, string>();
    for (const game of games) {
      const name = target(game.name);
      if (!name) continue;
      const key = keyOf(name);
      if (!byKey.has(key) && !missing.has(key)) missing.set(key, name);
    }
    if (missing.size > 0) {
      await this.insertNames([...missing.values()]);
      byKey = await this.load(true);
    }

    const ids: string[] = [];
    const companyIds: (string | null)[] = [];
    for (const game of games) {
      const name = target(game.name);
      const id = name ? (byKey.get(keyOf(name)) ?? null) : null;
      if (game.linkedId !== undefined && game.linkedId === id) continue;
      ids.push(game.id);
      companyIds.push(id);
    }
    if (ids.length === 0) return 0;
    await this.query(
      `UPDATE game AS g SET "${this.column}" = v.company_id
       FROM unnest($1::uuid[], $2::uuid[]) AS v(id, company_id)
       WHERE g.id = v.id AND g."${this.column}" IS DISTINCT FROM v.company_id`,
      [ids, companyIds],
    );
    return ids.length;
  }

  async insertNames(names: string[]): Promise<void> {
    if (names.length === 0) return;
    await this.query(
      `INSERT INTO "${this.table}" (name)
       SELECT DISTINCT unnest($1::varchar[])
       ON CONFLICT (name) DO NOTHING`,
      [names],
    );
    this.cache = null;
  }

  private async load(force = false): Promise<Map<string, string>> {
    if (
      !force &&
      this.cache &&
      Date.now() - this.cache.loadedAt < REGISTRY_TTL_MS
    ) {
      return this.cache.byKey;
    }
    const rows = await this.query<{ id: string; name: string }[]>(
      `SELECT id, name FROM "${this.table}"`,
    );
    rows.sort(
      (a, b) =>
        Number(this.preferred.has(b.name)) - Number(this.preferred.has(a.name)),
    );
    const byKey = new Map<string, string>();
    for (const row of rows) {
      const key = companyKey(row.name) || row.name.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, row.id);
    }
    this.cache = { byKey, loadedAt: Date.now() };
    return byKey;
  }
}
