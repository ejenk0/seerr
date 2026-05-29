import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Music-support schema migration (re-authored for this fork).
 *
 * The upstream music branch shipped a single auto-generated AddMusicSupport
 * migration (ts 1762648478949) that was stamped *before*
 * RenameBlacklistToBlocklist (1771080196816) and rebuilt tables targeting a
 * "blacklist" table that no longer exists on top of mainline `develop` →
 * "no such table: blacklist" on boot. This replacement is stamped after every
 * existing migration and targets the post-rename "blocklist" table.
 *
 * It is additive where possible (CREATE TABLE IF NOT EXISTS / ADD COLUMN), but
 * media/watchlist/blocklist require a table rebuild because SQLite cannot relax
 * a NOT NULL constraint via ALTER, and music rows have a NULL tmdbId (they key
 * off mbId instead). Without this, inserting a music Media row fails with
 * "NOT NULL constraint failed: media.tmdbId". The rebuilds reproduce the exact
 * current (post-develop) schema with tmdbId made nullable and an mbId column +
 * index added, copying every existing column by name so nothing is dropped.
 * defer_foreign_keys lets the drop/rename dance run inside the migration
 * transaction without tripping FK checks.
 */
export class AddMusicSupport1780000000000 implements MigrationInterface {
  name = 'AddMusicSupport1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA defer_foreign_keys = ON`);

    // --- New metadata tables (IF NOT EXISTS tolerates a partial prior run) ---
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "metadata_album" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mbAlbumId" varchar NOT NULL, "caaUrl" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_fb8eda254e560f96039f7a0d812" UNIQUE ("mbAlbumId"))`
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "metadata_artist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mbArtistId" varchar NOT NULL, "tmdbPersonId" varchar, "tmdbThumb" varchar, "tmdbUpdatedAt" datetime, "tadbThumb" varchar, "tadbCover" varchar, "tadbUpdatedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_bff8b9448b4a8a3af0f8957d4b7" UNIQUE ("mbArtistId"))`
    );

    // --- Simple additive columns (no constraint change needed) ---
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "musicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "musicQuotaDays" integer`);
    await queryRunner.query(`ALTER TABLE "override_rule" ADD COLUMN "lidarrServiceId" integer`);

    // --- media: rebuild with tmdbId nullable + mbId column ---
    await queryRunner.query(
      `CREATE TABLE "temporary_media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer, "tvdbId" integer, "imdbId" varchar, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastSeasonChange" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaAddedAt" datetime DEFAULT (CURRENT_TIMESTAMP), "serviceId" integer, "serviceId4k" integer, "externalServiceId" integer, "externalServiceId4k" integer, "externalServiceSlug" varchar, "externalServiceSlug4k" varchar, "ratingKey" varchar, "ratingKey4k" varchar, "jellyfinMediaId" varchar, "jellyfinMediaId4k" varchar, "mbId" varchar, CONSTRAINT "UQ_41a289eb1fa489c1bc6f38d9c3c" UNIQUE ("tvdbId"))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_media"("id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k") SELECT "id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k" FROM "media"`
    );
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(`ALTER TABLE "temporary_media" RENAME TO "media"`);
    await queryRunner.query(`CREATE INDEX "IDX_7157aad07c73f6a6ae3bbd5ef5" ON "media" ("tmdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_41a289eb1fa489c1bc6f38d9c3" ON "media" ("tvdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_7ff2d11f6a83cb52386eaebe74" ON "media" ("imdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_c730c2d67f271a372c39a07b7e" ON "media" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_5d6218de4f547909391a5c1347" ON "media" ("status4k")`);
    await queryRunner.query(`CREATE INDEX "IDX_f8233358694d1677a67899b90a" ON "media" ("tmdbId", "mediaType")`);
    await queryRunner.query(`CREATE INDEX "IDX_6c866e76dd595ad15b8c5bf9c1" ON "media" ("mbId")`);

    // --- watchlist: rebuild with tmdbId nullable + mbId column + per-user mbId uniqueness ---
    await queryRunner.query(
      `CREATE TABLE "temporary_watchlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "ratingKey" varchar NOT NULL, "mediaType" varchar NOT NULL, "title" varchar NOT NULL, "tmdbId" integer, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestedById" integer, "mediaId" integer, "mbId" varchar, CONSTRAINT "UNIQUE_USER_DB" UNIQUE ("tmdbId", "mediaType", "requestedById"), CONSTRAINT "FK_6641da8d831b93dfcb429f8b8bc" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_ae34e6b153a90672eb9dc4857d7" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_watchlist"("id", "ratingKey", "mediaType", "title", "tmdbId", "createdAt", "updatedAt", "requestedById", "mediaId") SELECT "id", "ratingKey", "mediaType", "title", "tmdbId", "createdAt", "updatedAt", "requestedById", "mediaId" FROM "watchlist"`
    );
    await queryRunner.query(`DROP TABLE "watchlist"`);
    await queryRunner.query(`ALTER TABLE "temporary_watchlist" RENAME TO "watchlist"`);
    await queryRunner.query(`CREATE INDEX "IDX_939f205946256cc0d2a1ac51a8" ON "watchlist" ("tmdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_ae34e6b153a90672eb9dc4857d" ON "watchlist" ("requestedById")`);
    await queryRunner.query(`CREATE INDEX "IDX_6641da8d831b93dfcb429f8b8b" ON "watchlist" ("mediaId")`);
    await queryRunner.query(`CREATE INDEX "IDX_a40b88a30fc50cf10264e279c9" ON "watchlist" ("mbId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UNIQUE_USER_FOREIGN" ON "watchlist" ("mbId", "requestedById")`);

    // --- blocklist: rebuild with tmdbId nullable + mbId column ---
    await queryRunner.query(
      `CREATE TABLE "temporary_blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "title" varchar, "tmdbId" integer, "blocklistedTags" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "mediaId" integer, "mbId" varchar, CONSTRAINT "REL_62b7ade94540f9f8d8bede54b9" UNIQUE ("mediaId"), CONSTRAINT "UQ_81504e02db89b4c1e3152729fa6" UNIQUE ("tmdbId", "mediaType"), CONSTRAINT "FK_5c8af2d0e83b3be6d250eccc19d" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_356721a49f145aa439c16e6b999" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_blocklist"("id", "mediaType", "title", "tmdbId", "blocklistedTags", "createdAt", "userId", "mediaId") SELECT "id", "mediaType", "title", "tmdbId", "blocklistedTags", "createdAt", "userId", "mediaId" FROM "blocklist"`
    );
    await queryRunner.query(`DROP TABLE "blocklist"`);
    await queryRunner.query(`ALTER TABLE "temporary_blocklist" RENAME TO "blocklist"`);
    await queryRunner.query(`CREATE INDEX "IDX_356721a49f145aa439c16e6b99" ON "blocklist" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_09b94c932e84635c5461f3c0a9" ON "blocklist" ("tmdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_4f7c7041c1792b568be902f097" ON "blocklist" ("mbId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA defer_foreign_keys = ON`);

    // blocklist: drop mbId, restore tmdbId NOT NULL
    await queryRunner.query(
      `CREATE TABLE "temporary_blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "title" varchar, "tmdbId" integer NOT NULL, "blocklistedTags" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "mediaId" integer, CONSTRAINT "REL_62b7ade94540f9f8d8bede54b9" UNIQUE ("mediaId"), CONSTRAINT "UQ_81504e02db89b4c1e3152729fa6" UNIQUE ("tmdbId", "mediaType"), CONSTRAINT "FK_5c8af2d0e83b3be6d250eccc19d" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_356721a49f145aa439c16e6b999" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_blocklist"("id", "mediaType", "title", "tmdbId", "blocklistedTags", "createdAt", "userId", "mediaId") SELECT "id", "mediaType", "title", "tmdbId", "blocklistedTags", "createdAt", "userId", "mediaId" FROM "blocklist" WHERE "tmdbId" IS NOT NULL`
    );
    await queryRunner.query(`DROP TABLE "blocklist"`);
    await queryRunner.query(`ALTER TABLE "temporary_blocklist" RENAME TO "blocklist"`);
    await queryRunner.query(`CREATE INDEX "IDX_356721a49f145aa439c16e6b99" ON "blocklist" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_09b94c932e84635c5461f3c0a9" ON "blocklist" ("tmdbId")`);

    // watchlist: drop mbId + UNIQUE_USER_FOREIGN, restore tmdbId NOT NULL
    await queryRunner.query(
      `CREATE TABLE "temporary_watchlist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "ratingKey" varchar NOT NULL, "mediaType" varchar NOT NULL, "title" varchar NOT NULL, "tmdbId" integer NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestedById" integer, "mediaId" integer, CONSTRAINT "UNIQUE_USER_DB" UNIQUE ("tmdbId", "mediaType", "requestedById"), CONSTRAINT "FK_6641da8d831b93dfcb429f8b8bc" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_ae34e6b153a90672eb9dc4857d7" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_watchlist"("id", "ratingKey", "mediaType", "title", "tmdbId", "createdAt", "updatedAt", "requestedById", "mediaId") SELECT "id", "ratingKey", "mediaType", "title", "tmdbId", "createdAt", "updatedAt", "requestedById", "mediaId" FROM "watchlist" WHERE "tmdbId" IS NOT NULL`
    );
    await queryRunner.query(`DROP TABLE "watchlist"`);
    await queryRunner.query(`ALTER TABLE "temporary_watchlist" RENAME TO "watchlist"`);
    await queryRunner.query(`CREATE INDEX "IDX_939f205946256cc0d2a1ac51a8" ON "watchlist" ("tmdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_ae34e6b153a90672eb9dc4857d" ON "watchlist" ("requestedById")`);
    await queryRunner.query(`CREATE INDEX "IDX_6641da8d831b93dfcb429f8b8b" ON "watchlist" ("mediaId")`);

    // media: drop mbId, restore tmdbId NOT NULL
    await queryRunner.query(
      `CREATE TABLE "temporary_media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "tvdbId" integer, "imdbId" varchar, "status" integer NOT NULL DEFAULT (1), "status4k" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastSeasonChange" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaAddedAt" datetime DEFAULT (CURRENT_TIMESTAMP), "serviceId" integer, "serviceId4k" integer, "externalServiceId" integer, "externalServiceId4k" integer, "externalServiceSlug" varchar, "externalServiceSlug4k" varchar, "ratingKey" varchar, "ratingKey4k" varchar, "jellyfinMediaId" varchar, "jellyfinMediaId4k" varchar, CONSTRAINT "UQ_41a289eb1fa489c1bc6f38d9c3c" UNIQUE ("tvdbId"))`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_media"("id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k") SELECT "id", "mediaType", "tmdbId", "tvdbId", "imdbId", "status", "status4k", "createdAt", "updatedAt", "lastSeasonChange", "mediaAddedAt", "serviceId", "serviceId4k", "externalServiceId", "externalServiceId4k", "externalServiceSlug", "externalServiceSlug4k", "ratingKey", "ratingKey4k", "jellyfinMediaId", "jellyfinMediaId4k" FROM "media" WHERE "tmdbId" IS NOT NULL`
    );
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(`ALTER TABLE "temporary_media" RENAME TO "media"`);
    await queryRunner.query(`CREATE INDEX "IDX_7157aad07c73f6a6ae3bbd5ef5" ON "media" ("tmdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_41a289eb1fa489c1bc6f38d9c3" ON "media" ("tvdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_7ff2d11f6a83cb52386eaebe74" ON "media" ("imdbId")`);
    await queryRunner.query(`CREATE INDEX "IDX_c730c2d67f271a372c39a07b7e" ON "media" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_5d6218de4f547909391a5c1347" ON "media" ("status4k")`);
    await queryRunner.query(`CREATE INDEX "IDX_f8233358694d1677a67899b90a" ON "media" ("tmdbId", "mediaType")`);

    await queryRunner.query(`ALTER TABLE "override_rule" DROP COLUMN "lidarrServiceId"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaLimit"`);
    await queryRunner.query(`DROP TABLE "metadata_artist"`);
    await queryRunner.query(`DROP TABLE "metadata_album"`);
  }
}
