import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the lifecycle dimension to `genre_profile`. Stored alongside the
 * platform-split because both questions ("how does it spread across
 * stores" and "how does it decay over time") are properties of the same
 * game type — one profile, one row.
 *
 * New columns:
 *   lifecycleIndex                : normalised empirical score (0.4–2.5)
 *   firstWeekToYearOneMultiplier  : year-1 cumulative / week-1 units
 *   year2Retention                : 8-level qualitative grade (enum)
 *   lifecycleDriver               : free-text rationale
 *
 * The migration also reshapes the seed:
 *   - splits `western-rpg-arpg` into `western-rpg` and `action-rpg`
 *     because their lifecycles diverge (×2.2 vs ×2.7);
 *   - adds a 21st profile `narrative-walking-sim` (the user's table
 *     covered it but our previous seed didn't);
 *   - re-points the IGDB genre "Hack and slash/Beat 'em up" at the
 *     new `action-rpg` profile (rather than the renamed Western RPG one);
 *   - seeds lifecycle values for every existing profile, using the
 *     user-provided spreadsheet verbatim. The three profiles that
 *     weren't in the table (MOBA, MMORPG, Battle royale) get
 *     best-effort defaults marked as such in the driver text.
 *
 * NOT NULL is set on the new columns only after the backfill so the
 * `ALTER TABLE ADD` step doesn't fail on existing rows.
 */
export class AddGenreLifecycle1782221904142 implements MigrationInterface {
  name = 'AddGenreLifecycle1782221904142';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."genre_profile_year2retention_enum" AS ENUM('NEGATIVE', 'VERY_LOW', 'LOW', 'LOW_MEDIUM', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH', 'VERY_HIGH')`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "lifecycleIndex" numeric(3,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "firstWeekToYearOneMultiplier" numeric(4,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "year2Retention" "public"."genre_profile_year2retention_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ADD "lifecycleDriver" text`,
    );

    // Step 1 — split western-rpg-arpg into western-rpg + action-rpg.
    // We rename the existing row to keep its UUID (and thus the FKs
    // from `genre`) and append the new action-rpg row beside it.
    await queryRunner.query(
      `UPDATE "genre_profile"
         SET slug = 'western-rpg',
             name = 'RPG occidental'
       WHERE slug = 'western-rpg-arpg'`,
    );

    await queryRunner.query(
      `INSERT INTO "genre_profile"
         ("slug", "name", "pcShare", "playstationShare", "xboxShare", "switchShare", "leanLabel", "confidence")
       VALUES ('action-rpg', 'Action-RPG', 0.5, 0.275, 0.15, 0.075, 'PS', 'MEDIUM')`,
    );

    // Step 2 — repoint "Hack and slash/Beat 'em up" (IGDB id=25) onto
    // the freshly created action-rpg profile. It used to fall under
    // the merged "western-rpg-arpg" bucket.
    await queryRunner.query(
      `UPDATE "genre"
         SET "profileId" = (SELECT id FROM "genre_profile" WHERE slug = 'action-rpg')
       WHERE source = 'IGDB' AND "externalId" = 25`,
    );

    // Step 3 — add narrative-walking-sim. Platform shares are a
    // best guess (very PC-heavy, slight PS lean), confidence MEDIUM.
    await queryRunner.query(
      `INSERT INTO "genre_profile"
         ("slug", "name", "pcShare", "playstationShare", "xboxShare", "switchShare", "leanLabel", "confidence")
       VALUES ('narrative-walking-sim', 'Narratif / walking sim', 0.55, 0.25, 0.10, 0.10, 'PS', 'MEDIUM')`,
    );

    // Step 4 — seed lifecycle values for every profile. Values come
    // from the user-provided spreadsheet 1:1; MOBA / MMORPG / battle
    // royale were absent and get conservative defaults flagged in the
    // driver text.
    const lifecycle: ReadonlyArray<{
      slug: string;
      index: number;
      mult: number;
      retention:
        | 'NEGATIVE'
        | 'VERY_LOW'
        | 'LOW'
        | 'LOW_MEDIUM'
        | 'MEDIUM'
        | 'MEDIUM_HIGH'
        | 'HIGH'
        | 'VERY_HIGH';
      driver: string;
    }> = [
      { slug: 'grand-strategy-rts', index: 2.4, mult: 6.0, retention: 'VERY_HIGH', driver: 'Mods, MAJ continues, 29h moy.' },
      { slug: 'simulation', index: 2.3, mult: 6.0, retention: 'VERY_HIGH', driver: 'Mods, rejouabilité systémique' },
      { slug: 'sandbox', index: 2.5, mult: 6.5, retention: 'VERY_HIGH', driver: 'Social, infini, UGC' },
      { slug: 'survival-craft', index: 1.9, mult: 4.5, retention: 'HIGH', driver: 'Co-op + MAJ' },
      { slug: 'roguelike-deckbuilder', index: 1.8, mult: 4.5, retention: 'HIGH', driver: 'Rejouabilité + viral + prix bas' },
      { slug: 'co-op-party', index: 2.0, mult: 5.0, retention: 'MEDIUM_HIGH', driver: 'Viral/streamer (extrêmes ×20–500)' },
      { slug: 'tactical-competitive-shooter', index: 1.7, mult: 4.0, retention: 'HIGH', driver: 'Live service' },
      { slug: 'fighting', index: 1.4, mult: 3.5, retention: 'MEDIUM_HIGH', driver: 'Compétitif + DLC persos' },
      { slug: 'racing-arcade', index: 1.3, mult: 3.0, retention: 'MEDIUM', driver: 'DLC contenu (sim racing)' },
      { slug: 'action-rpg', index: 1.1, mult: 2.7, retention: 'MEDIUM', driver: 'Build variety, NG+' },
      { slug: 'horror', index: 1.3, mult: 3.5, retention: 'MEDIUM', driver: 'Viral/streamer' },
      { slug: 'western-rpg', index: 0.9, mult: 2.2, retention: 'MEDIUM', driver: 'Long mais finissable' },
      { slug: 'jrpg', index: 0.8, mult: 2.0, retention: 'LOW_MEDIUM', driver: 'Dense mais one-and-done' },
      { slug: 'platformer-mainstream', index: 0.8, mult: 2.0, retention: 'LOW', driver: 'Finissable' },
      { slug: 'cinematic-action-adventure-aaa', index: 0.7, mult: 1.8, retention: 'LOW', driver: 'Front-loaded, finissable' },
      { slug: 'visual-novel', index: 0.7, mult: 1.8, retention: 'LOW', driver: 'Finissable (rebonds en soldes)' },
      { slug: 'narrative-walking-sim', index: 0.5, mult: 1.3, retention: 'VERY_LOW', driver: 'One-and-done' },
      { slug: 'sport', index: 0.4, mult: 1.2, retention: 'NEGATIVE', driver: 'Édition N+1 cannibalise' },
      { slug: 'moba', index: 1.6, mult: 4.0, retention: 'HIGH', driver: 'Live service compétitif (défaut, à affiner)' },
      { slug: 'mmorpg', index: 1.6, mult: 4.0, retention: 'HIGH', driver: 'Box + extensions + sub (défaut, à affiner)' },
      { slug: 'battle-royale', index: 1.3, mult: 3.0, retention: 'MEDIUM', driver: 'F2P live service / paid box (défaut, à affiner)' },
    ];

    for (const l of lifecycle) {
      await queryRunner.query(
        `UPDATE "genre_profile"
           SET "lifecycleIndex" = $1,
               "firstWeekToYearOneMultiplier" = $2,
               "year2Retention" = $3::"public"."genre_profile_year2retention_enum",
               "lifecycleDriver" = $4
         WHERE slug = $5`,
        [l.index, l.mult, l.retention, l.driver, l.slug],
      );
    }

    // Safety: every profile must now carry lifecycle data. Throwing
    // before the NOT NULL flip prevents the migration from leaving an
    // unusable schema.
    const orphans = await queryRunner.query(
      `SELECT slug FROM "genre_profile"
        WHERE "lifecycleIndex" IS NULL
           OR "firstWeekToYearOneMultiplier" IS NULL
           OR "year2Retention" IS NULL`,
    );
    if (Array.isArray(orphans) && orphans.length > 0) {
      throw new Error(
        `Lifecycle seed left ${orphans.length} genre_profile row(s) without values: ${orphans
          .map((o: { slug: string }) => o.slug)
          .join(', ')}`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "genre_profile" ALTER COLUMN "lifecycleIndex" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ALTER COLUMN "firstWeekToYearOneMultiplier" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" ALTER COLUMN "year2Retention" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "lifecycleDriver"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "year2Retention"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."genre_profile_year2retention_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "firstWeekToYearOneMultiplier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre_profile" DROP COLUMN "lifecycleIndex"`,
    );
    // Re-merge action-rpg back into western-rpg-arpg.
    await queryRunner.query(
      `UPDATE "genre"
         SET "profileId" = (SELECT id FROM "genre_profile" WHERE slug = 'western-rpg')
       WHERE source = 'IGDB' AND "externalId" = 25`,
    );
    await queryRunner.query(
      `DELETE FROM "genre_profile" WHERE slug = 'action-rpg'`,
    );
    await queryRunner.query(
      `UPDATE "genre_profile"
         SET slug = 'western-rpg-arpg',
             name = 'RPG occidental / action-RPG'
       WHERE slug = 'western-rpg'`,
    );
    await queryRunner.query(
      `DELETE FROM "genre_profile" WHERE slug = 'narrative-walking-sim'`,
    );
  }
}
