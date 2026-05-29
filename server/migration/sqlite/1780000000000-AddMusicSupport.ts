import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive music-support schema migration (re-authored for this fork).
 *
 * The upstream music branch shipped a single auto-generated AddMusicSupport
 * migration (timestamp 1762648478949) that performed full SQLite table
 * rebuilds and targeted a table literally named "blacklist". That is broken
 * for two reasons when applied on top of mainline `develop`:
 *   1. Ordering: its timestamp predates RenameBlacklistToBlocklist
 *      (1771080196816), which stable releases already ran, so on boot it would
 *      execute against the now-renamed "blocklist" table and fail with
 *      "no such table: blacklist", aborting startup.
 *   2. Clobbering: its table-rebuild INSERT...SELECT statements use fixed
 *      column lists captured from an older schema snapshot, which would drop
 *      columns added to user/media/watchlist by later develop migrations.
 *
 * This replacement is stamped after every existing migration and is purely
 * additive (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN / CREATE
 * INDEX), so it is safe both on a fresh database and when upgrading an
 * existing install. It targets the post-rename "blocklist" table. The
 * metadata_album / metadata_artist creates use IF NOT EXISTS so a database
 * left in a partial state by a previous failed run of the old migration
 * (empty metadata tables already present) upgrades cleanly.
 */
export class AddMusicSupport1780000000000 implements MigrationInterface {
  name = 'AddMusicSupport1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // New metadata tables (IF NOT EXISTS tolerates partial prior runs).
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "metadata_album" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mbAlbumId" varchar NOT NULL, "caaUrl" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_fb8eda254e560f96039f7a0d812" UNIQUE ("mbAlbumId"))`
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "metadata_artist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mbArtistId" varchar NOT NULL, "tmdbPersonId" varchar, "tmdbThumb" varchar, "tmdbUpdatedAt" datetime, "tadbThumb" varchar, "tadbCover" varchar, "tadbUpdatedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_bff8b9448b4a8a3af0f8957d4b7" UNIQUE ("mbArtistId"))`
    );

    // Per-user music request quota.
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "musicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "musicQuotaDays" integer`);

    // MusicBrainz id on media + index.
    await queryRunner.query(`ALTER TABLE "media" ADD COLUMN "mbId" varchar`);
    await queryRunner.query(
      `CREATE INDEX "IDX_6c866e76dd595ad15b8c5bf9c1" ON "media" ("mbId")`
    );

    // MusicBrainz id on watchlist + index + per-user uniqueness.
    // NULL mbId rows (movie/tv) remain distinct under SQLite's NULL handling,
    // so existing movie/tv watchlist entries are unaffected.
    await queryRunner.query(`ALTER TABLE "watchlist" ADD COLUMN "mbId" varchar`);
    await queryRunner.query(
      `CREATE INDEX "IDX_a40b88a30fc50cf10264e279c9" ON "watchlist" ("mbId")`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UNIQUE_USER_FOREIGN" ON "watchlist" ("mbId", "requestedById")`
    );

    // MusicBrainz id on blocklist (post-rename table name) + index.
    await queryRunner.query(`ALTER TABLE "blocklist" ADD COLUMN "mbId" varchar`);
    await queryRunner.query(
      `CREATE INDEX "IDX_4f7c7041c1792b568be902f097" ON "blocklist" ("mbId")`
    );

    // Lidarr service binding on override rules.
    await queryRunner.query(
      `ALTER TABLE "override_rule" ADD COLUMN "lidarrServiceId" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "override_rule" DROP COLUMN "lidarrServiceId"`);
    await queryRunner.query(`DROP INDEX "IDX_4f7c7041c1792b568be902f097"`);
    await queryRunner.query(`ALTER TABLE "blocklist" DROP COLUMN "mbId"`);
    await queryRunner.query(`DROP INDEX "UNIQUE_USER_FOREIGN"`);
    await queryRunner.query(`DROP INDEX "IDX_a40b88a30fc50cf10264e279c9"`);
    await queryRunner.query(`ALTER TABLE "watchlist" DROP COLUMN "mbId"`);
    await queryRunner.query(`DROP INDEX "IDX_6c866e76dd595ad15b8c5bf9c1"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "mbId"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaLimit"`);
    await queryRunner.query(`DROP TABLE "metadata_artist"`);
    await queryRunner.query(`DROP TABLE "metadata_album"`);
  }
}
