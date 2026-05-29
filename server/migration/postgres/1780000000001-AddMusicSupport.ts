import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive music-support schema migration for Postgres (re-authored for this
 * fork). See the SQLite counterpart (1780000000000) for the full rationale:
 * the original upstream music migration was timestamped before
 * RenameBlacklistToBlocklist and targeted the pre-rename "blacklist" table,
 * which breaks on top of mainline `develop`. This version is stamped after all
 * existing migrations, is purely additive, and targets the post-rename
 * "blocklist" table. (This deployment uses SQLite; this file exists for
 * Postgres parity.)
 */
export class AddMusicSupport1780000000001 implements MigrationInterface {
  name = 'AddMusicSupport1780000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "metadata_album" ("id" SERIAL NOT NULL, "mbAlbumId" character varying NOT NULL, "caaUrl" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fb8eda254e560f96039f7a0d812" UNIQUE ("mbAlbumId"), CONSTRAINT "PK_02aaaa276bcc3de3ead4bd2b8f3" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "metadata_artist" ("id" SERIAL NOT NULL, "mbArtistId" character varying NOT NULL, "tmdbPersonId" character varying, "tmdbThumb" character varying, "tmdbUpdatedAt" TIMESTAMP WITH TIME ZONE, "tadbThumb" character varying, "tadbCover" character varying, "tadbUpdatedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_bff8b9448b4a8a3af0f8957d4b7" UNIQUE ("mbArtistId"), CONSTRAINT "PK_06d683fc350297c5aef7f0fe5c4" PRIMARY KEY ("id"))`
    );

    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "musicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "musicQuotaDays" integer`);

    await queryRunner.query(`ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "mbId" character varying`);
    await queryRunner.query(
      `CREATE INDEX "IDX_6c866e76dd595ad15b8c5bf9c1" ON "media" ("mbId")`
    );

    await queryRunner.query(`ALTER TABLE "watchlist" ADD COLUMN IF NOT EXISTS "mbId" character varying`);
    await queryRunner.query(
      `CREATE INDEX "IDX_a40b88a30fc50cf10264e279c9" ON "watchlist" ("mbId")`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD CONSTRAINT "UNIQUE_USER_FOREIGN" UNIQUE ("mbId", "requestedById")`
    );

    await queryRunner.query(`ALTER TABLE "blocklist" ADD COLUMN IF NOT EXISTS "mbId" character varying`);
    await queryRunner.query(
      `CREATE INDEX "IDX_4f7c7041c1792b568be902f097" ON "blocklist" ("mbId")`
    );

    await queryRunner.query(`ALTER TABLE "override_rule" ADD COLUMN IF NOT EXISTS "lidarrServiceId" integer`);

    // Music media has no tmdbId (keyed on mbId) — relax the NOT NULL constraint.
    await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "tmdbId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "watchlist" ALTER COLUMN "tmdbId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "blocklist" ALTER COLUMN "tmdbId" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "blocklist" ALTER COLUMN "tmdbId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "watchlist" ALTER COLUMN "tmdbId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "media" ALTER COLUMN "tmdbId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "override_rule" DROP COLUMN "lidarrServiceId"`);
    await queryRunner.query(`DROP INDEX "IDX_4f7c7041c1792b568be902f097"`);
    await queryRunner.query(`ALTER TABLE "blocklist" DROP COLUMN "mbId"`);
    await queryRunner.query(`ALTER TABLE "watchlist" DROP CONSTRAINT "UNIQUE_USER_FOREIGN"`);
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
