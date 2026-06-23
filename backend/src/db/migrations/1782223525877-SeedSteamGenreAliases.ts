import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed Steam-flavoured genre aliases.
 *
 * `Game.genres` is populated by the ingestion pipeline with Steam's
 * short genre names (`"RPG"`, `"Adventure"`, `"Sports"`, ...) whenever
 * Steam data is available, falling back to IGDB's longer names only
 * for IGDB-only titles. The genre table was previously seeded with
 * IGDB names exclusively (`"Role-playing (RPG)"`, `"Sport"`, ...) so
 * `GenresService.resolveProfileForGame` would miss the vast majority
 * of games.
 *
 * This migration inserts Steam taxonomy entries (no `externalId` —
 * Steam genres are referenced by name) re-using the same profile
 * heuristic as the IGDB rows. Aliases that have no meaningful profile
 * (utilities, content warnings, generic "Action", "Indie", ...) land
 * unmapped so the admin can curate them.
 */
export class SeedSteamGenreAliases1782223525877 implements MigrationInterface {
  name = 'SeedSteamGenreAliases1782223525877';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const aliases: ReadonlyArray<{
      slug: string;
      name: string;
      profileSlug: string | null;
    }> = [
      { slug: 'steam-action', name: 'Action', profileSlug: null },
      {
        slug: 'steam-adventure',
        name: 'Adventure',
        profileSlug: 'cinematic-action-adventure-aaa',
      },
      { slug: 'steam-casual', name: 'Casual', profileSlug: null },
      {
        slug: 'steam-indie',
        name: 'Indie',
        profileSlug: null,
      },
      {
        slug: 'steam-massively-multiplayer',
        name: 'Massively Multiplayer',
        profileSlug: 'mmorpg',
      },
      { slug: 'steam-rpg', name: 'RPG', profileSlug: 'western-rpg' },
      {
        slug: 'steam-racing',
        name: 'Racing',
        profileSlug: 'racing-arcade',
      },
      {
        slug: 'steam-simulation',
        name: 'Simulation',
        profileSlug: 'simulation',
      },
      { slug: 'steam-sports', name: 'Sports', profileSlug: 'sport' },
      {
        slug: 'steam-strategy',
        name: 'Strategy',
        profileSlug: 'grand-strategy-rts',
      },
      { slug: 'steam-early-access', name: 'Early Access', profileSlug: null },
      { slug: 'steam-free-to-play', name: 'Free To Play', profileSlug: null },
      { slug: 'steam-violent', name: 'Violent', profileSlug: null },
      { slug: 'steam-gore', name: 'Gore', profileSlug: null },
      {
        slug: 'steam-sexual-content',
        name: 'Sexual Content',
        profileSlug: null,
      },
      { slug: 'steam-nudity', name: 'Nudity', profileSlug: null },
    ];

    for (const a of aliases) {
      await queryRunner.query(
        `INSERT INTO "genre" ("slug", "name", "source", "externalId", "profileId")
         VALUES ($1, $2, 'STEAM', NULL,
           CASE WHEN $3::text IS NULL THEN NULL
                ELSE (SELECT id FROM "genre_profile" WHERE slug = $3::text)
           END)
         ON CONFLICT (slug) DO NOTHING`,
        [a.slug, a.name, a.profileSlug],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "genre" WHERE source = 'STEAM' AND slug LIKE 'steam-%'`,
    );
  }
}
