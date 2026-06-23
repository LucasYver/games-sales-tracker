import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `genre_profile` (the platform-split bucket table) and `genre`
 * (the per-tag taxonomy that points at a profile).
 *
 * Seeds:
 *   - 19 canonical genre profiles with empirical PC/PS/Xbox/Switch shares.
 *   - The official IGDB genre catalog (as of 2026) with a heuristic
 *     profile assignment for the unambiguous ones. Ambiguous entries
 *     are inserted with `profileId = NULL` and left to the admin.
 *
 * The bookkeeping at the top (`sales_estimate` FK/index rename, the
 * redundant `estimation_method` family index, and the
 * `estimate_snapshot.reconciliation` default touch-up) is noise from
 * TypeORM's auto-generation: it doesn't recognise the explicit
 * constraint names set by earlier migrations and rewrites them to its
 * own canonical hashes. The renames are idempotent and produce the
 * same final shape, so we keep them as-is.
 */
export class AddGenreProfileAndGenre1782220528695
  implements MigrationInterface
{
  name = 'AddGenreProfileAndGenre1782220528695';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP CONSTRAINT "FK_sales_estimate_methodId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_estimation_method_family"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sales_estimate_game_platform_method_at"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."genre_profile_confidence_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH')`,
    );
    await queryRunner.query(
      `CREATE TABLE "genre_profile" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "pcShare" numeric(4,3) NOT NULL, "playstationShare" numeric(4,3) NOT NULL, "xboxShare" numeric(4,3) NOT NULL, "switchShare" numeric(4,3) NOT NULL, "leanLabel" character varying, "confidence" "public"."genre_profile_confidence_enum" NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fc11a7934931409d6a15b84e75b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d0976f3cdcea6b3c08cdea4165" ON "genre_profile" ("slug") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."genre_source_enum" AS ENUM('IGDB', 'STEAM', 'MANUAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "genre" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "name" character varying NOT NULL, "source" "public"."genre_source_enum" NOT NULL, "externalId" integer, "profileId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0285d4f1655d080cfcf7d1ab141" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8fc42c0cf741b5006b5ffd12f2" ON "genre" ("slug") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_be531706a29506f16adecec6ea" ON "genre" ("source", "externalId") WHERE "externalId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_598dfdca01612842260cdcece0" ON "estimation_method" ("family") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6edd602d56c5ac7969f25f80c0" ON "sales_estimate" ("gameId", "platform", "methodId", "computedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD CONSTRAINT "FK_50c25fdb94c32f4257920e89e9f" FOREIGN KEY ("methodId") REFERENCES "estimation_method"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "genre" ADD CONSTRAINT "FK_18e47012b97b1d719faafb7b734" FOREIGN KEY ("profileId") REFERENCES "genre_profile"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Seed: 19 canonical profiles. Numeric shares sum to ~1.0 per row
    // (verified manually); minor rounding rebalanced so they hit 1.000.
    const profiles: ReadonlyArray<{
      slug: string;
      name: string;
      pc: number;
      ps: number;
      xbox: number;
      switch: number;
      lean: string;
      confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    }> = [
      { slug: 'grand-strategy-rts', name: 'Grand strategy / 4X / RTS', pc: 0.88, ps: 0.036, xbox: 0.06, switch: 0.024, lean: 'Xbox', confidence: 'HIGH' },
      { slug: 'moba', name: 'MOBA', pc: 0.95, ps: 0.02, xbox: 0.015, switch: 0.015, lean: '—', confidence: 'HIGH' },
      { slug: 'mmorpg', name: 'MMORPG', pc: 0.8, ps: 0.08, xbox: 0.08, switch: 0.04, lean: 'équilibré', confidence: 'MEDIUM' },
      { slug: 'simulation', name: 'Simulation (gestion, colonie, véhicule)', pc: 0.8, ps: 0.07, xbox: 0.06, switch: 0.07, lean: 'équilibré', confidence: 'HIGH' },
      { slug: 'tactical-competitive-shooter', name: 'Tactical / competitive shooter', pc: 0.78, ps: 0.099, xbox: 0.099, switch: 0.022, lean: 'équilibré', confidence: 'HIGH' },
      { slug: 'survival-craft', name: 'Survie / craft', pc: 0.7, ps: 0.12, xbox: 0.12, switch: 0.06, lean: 'équilibré', confidence: 'MEDIUM' },
      { slug: 'visual-novel', name: 'Visual novel', pc: 0.75, ps: 0.112, xbox: 0.013, switch: 0.125, lean: 'Switch/PS', confidence: 'MEDIUM' },
      { slug: 'roguelike-deckbuilder', name: 'Roguelike / deckbuilder', pc: 0.68, ps: 0.08, xbox: 0.064, switch: 0.176, lean: 'Switch', confidence: 'MEDIUM' },
      { slug: 'co-op-party', name: 'Co-op / party', pc: 0.58, ps: 0.147, xbox: 0.126, switch: 0.147, lean: 'équilibré', confidence: 'MEDIUM' },
      { slug: 'horror', name: 'Horreur', pc: 0.55, ps: 0.179, xbox: 0.158, switch: 0.113, lean: 'équilibré', confidence: 'LOW' },
      { slug: 'western-rpg-arpg', name: 'RPG occidental / action-RPG', pc: 0.5, ps: 0.275, xbox: 0.15, switch: 0.075, lean: 'PS', confidence: 'MEDIUM' },
      { slug: 'sandbox', name: 'Sandbox (Roblox/Minecraft type)', pc: 0.45, ps: 0.165, xbox: 0.165, switch: 0.22, lean: 'équilibré', confidence: 'LOW' },
      { slug: 'battle-royale', name: 'Battle royale', pc: 0.35, ps: 0.357, xbox: 0.228, switch: 0.065, lean: 'PS', confidence: 'MEDIUM' },
      { slug: 'cinematic-action-adventure-aaa', name: 'Action-aventure cinématique AAA', pc: 0.38, ps: 0.403, xbox: 0.155, switch: 0.062, lean: 'PS fort', confidence: 'HIGH' },
      { slug: 'jrpg', name: 'JRPG', pc: 0.4, ps: 0.27, xbox: 0.06, switch: 0.27, lean: 'PS/Switch', confidence: 'MEDIUM' },
      { slug: 'fighting', name: 'Fighting', pc: 0.35, ps: 0.292, xbox: 0.195, switch: 0.163, lean: 'équilibré', confidence: 'MEDIUM' },
      { slug: 'racing-arcade', name: 'Course / racing arcade', pc: 0.32, ps: 0.272, xbox: 0.238, switch: 0.17, lean: 'équilibré', confidence: 'MEDIUM' },
      { slug: 'platformer-mainstream', name: 'Plateforme (mainstream)', pc: 0.3, ps: 0.14, xbox: 0.07, switch: 0.49, lean: 'Switch fort', confidence: 'MEDIUM' },
      { slug: 'sport', name: 'Sport', pc: 0.2, ps: 0.44, xbox: 0.24, switch: 0.12, lean: 'PS fort', confidence: 'HIGH' },
    ];

    for (const p of profiles) {
      await queryRunner.query(
        `INSERT INTO "genre_profile" ("slug", "name", "pcShare", "playstationShare", "xboxShare", "switchShare", "leanLabel", "confidence")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [p.slug, p.name, p.pc, p.ps, p.xbox, p.switch, p.lean, p.confidence],
      );
    }

    // Seed: IGDB official genre catalog (as of 2026). External ids are
    // IGDB's `/genres` ids. Profile assignment is heuristic; left NULL
    // when no obvious bucket fits (Music, Puzzle, Indie, etc.) so the
    // admin can map them by hand.
    const igdbGenres: ReadonlyArray<{
      externalId: number;
      slug: string;
      name: string;
      profileSlug: string | null;
    }> = [
      { externalId: 2, slug: 'point-and-click', name: 'Point-and-click', profileSlug: null },
      { externalId: 4, slug: 'fighting', name: 'Fighting', profileSlug: 'fighting' },
      { externalId: 5, slug: 'shooter', name: 'Shooter', profileSlug: 'tactical-competitive-shooter' },
      { externalId: 7, slug: 'music', name: 'Music', profileSlug: null },
      { externalId: 8, slug: 'platform', name: 'Platform', profileSlug: 'platformer-mainstream' },
      { externalId: 9, slug: 'puzzle', name: 'Puzzle', profileSlug: null },
      { externalId: 10, slug: 'racing', name: 'Racing', profileSlug: 'racing-arcade' },
      { externalId: 11, slug: 'real-time-strategy-rts', name: 'Real Time Strategy (RTS)', profileSlug: 'grand-strategy-rts' },
      { externalId: 12, slug: 'role-playing-rpg', name: 'Role-playing (RPG)', profileSlug: 'western-rpg-arpg' },
      { externalId: 13, slug: 'simulator', name: 'Simulator', profileSlug: 'simulation' },
      { externalId: 14, slug: 'sport', name: 'Sport', profileSlug: 'sport' },
      { externalId: 15, slug: 'strategy', name: 'Strategy', profileSlug: 'grand-strategy-rts' },
      { externalId: 16, slug: 'turn-based-strategy-tbs', name: 'Turn-based strategy (TBS)', profileSlug: 'grand-strategy-rts' },
      { externalId: 24, slug: 'tactical', name: 'Tactical', profileSlug: 'tactical-competitive-shooter' },
      { externalId: 25, slug: 'hack-and-slash-beat-em-up', name: "Hack and slash/Beat 'em up", profileSlug: 'western-rpg-arpg' },
      { externalId: 26, slug: 'quiz-trivia', name: 'Quiz/Trivia', profileSlug: null },
      { externalId: 30, slug: 'pinball', name: 'Pinball', profileSlug: null },
      { externalId: 31, slug: 'adventure', name: 'Adventure', profileSlug: 'cinematic-action-adventure-aaa' },
      { externalId: 32, slug: 'indie', name: 'Indie', profileSlug: null },
      { externalId: 33, slug: 'arcade', name: 'Arcade', profileSlug: null },
      { externalId: 34, slug: 'visual-novel', name: 'Visual Novel', profileSlug: 'visual-novel' },
      { externalId: 35, slug: 'card-and-board-game', name: 'Card & Board Game', profileSlug: null },
      { externalId: 36, slug: 'moba', name: 'MOBA', profileSlug: 'moba' },
    ];

    for (const g of igdbGenres) {
      await queryRunner.query(
        `INSERT INTO "genre" ("slug", "name", "source", "externalId", "profileId")
         VALUES ($1, $2, 'IGDB', $3,
           CASE WHEN $4::text IS NULL THEN NULL
                ELSE (SELECT id FROM "genre_profile" WHERE slug = $4::text)
           END)`,
        [g.slug, g.name, g.externalId, g.profileSlug],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "genre" DROP CONSTRAINT "FK_18e47012b97b1d719faafb7b734"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" DROP CONSTRAINT "FK_50c25fdb94c32f4257920e89e9f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6edd602d56c5ac7969f25f80c0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_598dfdca01612842260cdcece0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be531706a29506f16adecec6ea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8fc42c0cf741b5006b5ffd12f2"`,
    );
    await queryRunner.query(`DROP TABLE "genre"`);
    await queryRunner.query(`DROP TYPE "public"."genre_source_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d0976f3cdcea6b3c08cdea4165"`,
    );
    await queryRunner.query(`DROP TABLE "genre_profile"`);
    await queryRunner.query(
      `DROP TYPE "public"."genre_profile_confidence_enum"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sales_estimate_game_platform_method_at" ON "sales_estimate" ("computedAt", "gameId", "methodId", "platform") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_estimation_method_family" ON "estimation_method" ("family") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_estimate" ADD CONSTRAINT "FK_sales_estimate_methodId" FOREIGN KEY ("methodId") REFERENCES "estimation_method"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
