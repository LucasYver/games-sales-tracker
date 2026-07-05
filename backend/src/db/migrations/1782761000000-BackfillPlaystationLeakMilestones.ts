import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ingest the first-party PlayStation sales figures leaked in the Dec 2023
 * Rhysida/Insomniac breach (internal SIE shipments as of 2022-02-27) as
 * `PLAYSTATION_LEAK` milestones scoped to `PLATFORM = PLAYSTATION`, dated at
 * the leak's snapshot date. Source of record: `backend/scripts/
 * playstation_leak_2022.csv`.
 *
 * Only the 20 leak rows that map to a game already in our catalogue are
 * inserted. The `(gameId, units)` pairs are embedded rather than name-matched
 * so the mapping is explicit and reviewable (Spider-Man → "Marvel's
 * Spider-Man", etc.). Two Director's Cut SKUs are folded into their base game
 * (Ghost of Tsushima 7.603M + 1.857M = 9.46M; Death Stranding 4.385M + 0.335M
 * = 4.72M) so each game gets a single PlayStation total.
 *
 * Leak rows with no game in our catalogue are intentionally skipped: Spider-Man
 * Miles Morales, Uncharted Nathan Drake Collection, Ratchet & Clank (2016),
 * Uncharted The Lost Legacy, Demon's Souls, MLB The Show 21, Predator: Hunting
 * Grounds, Uncharted Legacy of Thieves.
 *
 * Caveats baked into the note: these are shipments (sell-in), a frozen
 * 2022-02-27 snapshot, and PlayStation-scoped (not global). `isEstimate` is
 * false — they are actual internal figures, not modelled. The JOIN to `game`
 * drops any row whose gameId is absent, and `NOT EXISTS` makes the migration
 * idempotent and rejection-aware.
 */
export class BackfillPlaystationLeakMilestones1782761000000
  implements MigrationInterface
{
  name = 'BackfillPlaystationLeakMilestones1782761000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "milestone" (
        "id", "gameId", "source", "units", "platform",
        "isEstimate", "confidenceScore", "sourceUrl", "note",
        "reportedAt", "isEngagement"
      )
      SELECT
        uuid_generate_v4(), v."gameId"::uuid, 'PLAYSTATION_LEAK', v."units"::int, 'PLAYSTATION',
        false, 85, NULL,
        'PlayStation first-party sales leak (Rhysida/Insomniac breach, Dec 2023): internal SIE shipments as of 2022-02-27, PlayStation-scoped. Sell-in figure.',
        '2022-02-27T00:00:00.000Z', false
      FROM (VALUES
        ('e336cbc0-27ea-456f-9bbb-d8b59c3b0a35', 22685000),
        ('fe35c494-dddf-47e4-a54f-b38809fd09c2', 21023000),
        ('d2fbfc5a-7656-4643-8b25-8af022764639', 19297000),
        ('4f4e433b-2bb7-417a-9737-8ddaf5c2c078', 18652000),
        ('0a593754-ad0b-4ba2-a32e-e79ab5110272', 18632000),
        ('463535ec-e68d-4fd3-be2a-e288385e0ab8', 12977000),
        ('0ad77b77-45d6-48c4-a30e-04b4f8283442', 10302000),
        ('5d74e891-7571-4793-bfe3-498baba330d4', 9460000),
        ('ebe9e400-5baa-41e6-8c36-47b0bf2e3c90', 7648000),
        ('692b720c-8de7-423d-b519-59ed8d6f6111', 7238000),
        ('7dd0c2a8-3dc3-4395-b37a-8d52cdea1514', 5621000),
        ('c28a0370-0c19-4a78-b45b-a04eb9e6a4fe', 5542000),
        ('c961aad0-aa06-468d-a29b-ab8d3a61e511', 5346000),
        ('7daed57f-c844-44a3-bc9f-677b64fc3247', 5303000),
        ('8c98f681-7e83-4262-9be2-33af7ccf5bfe', 4971000),
        ('66c8a157-a1ba-4664-96e4-49573e733760', 4720000),
        ('25505c5f-b788-4087-a7f9-999916fa101d', 4039000),
        ('5d8f4335-9097-42df-958f-a9a7b07138ef', 2724000),
        ('061194d2-78e5-4826-b6fc-36720b6d527b', 1555000),
        ('802751bc-440c-4b9c-a3ac-479903b49955', 1016000)
      ) AS v("gameId", "units")
      JOIN "game" g ON g."id" = v."gameId"::uuid AND g."deletedAt" IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM "milestone" m
        WHERE m."gameId" = v."gameId"::uuid AND m."source" = 'PLAYSTATION_LEAK'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "milestone" WHERE "source" = 'PLAYSTATION_LEAK'`,
    );
  }
}
