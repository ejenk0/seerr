# Music support — merge & fix log (for the eventual PR)

Running log of everything found and changed while rebasing the music/Lidarr
feature onto current mainline and making it deployable. Intended to become the
PR description (or upstream discussion notes).

## Overview

- **Goal:** integrate the music/Lidarr feature (upstream `HiItsStolas:lidarr`,
  draft PR seerr-team/seerr#2132 — the branch behind the `preview-music-support`
  image) with current mainline so it can be built and deployed.
- **Base branch:** upstream default is **`develop`** (there is no `main`).
  Merged **274 commits** of `develop` into the feature branch.
- **Fork / image:** `ejenk0/seerr`, branch `music`; CI builds amd64 →
  `ghcr.io/ejenk0/seerr:music` (+ immutable `:music-<sha>`).
- **Strategy:** merge `develop` into the feature branch (not rebase) to resolve
  conflicts once and keep a maintainable long-lived branch.

## 1. Conflict resolution (36 files)

Adopted `develop`'s refactors while preserving all music functionality (mbId,
`music` media type, Lidarr settings, music quota, album/artist cards,
MusicBrainz/CoverArt/TheAudioDB metadata). Notable conflict clusters:

- **`Blacklist` → `Blocklist` rename** (develop renamed it project-wide:
  entities, routes, interfaces, components, pages, DB migration). Re-applied the
  music `mbId`/`music`-mediaType behaviour on top of the new names.
- **express 4→5 / next 14→16 / mime 3→4** dependency bumps (`package.json`):
  took develop's versions as the base, re-added music-only deps still in use
  (`dompurify`, `jsdom`); regenerated `pnpm-lock.yaml`.
- **BaseScanner** `loop`/`processItem` refactor — kept music's `processMusic`
  and added a `MusicAlbum` branch to develop's dispatcher.
- **i18n** message formatting, **unified image proxy**, search/discover hooks.

## 2. Post-merge compile fixes

- `react-toast-notifications` was dropped by develop in favour of
  `@app/hooks/useToasts` (identical API). Converted the 3 unconverted music
  files: `MusicRequestModal`, `Settings/LidarrModal`, `MusicDetails`.
- `JellyfinScanner.processMusic` collided with the new
  `BaseScanner.processMusic(mbId, opts)` → renamed the Jellyfin item-handler to
  `processJellyfinMusic` (matches the `processJellyfin*` pattern).
- `MusicDetails` still referenced old `Blacklist` names — including the request
  path **`/api/v1/blacklist` → `/api/v1/blocklist`** (would 404 at runtime).
- `MiniQuotaDisplay` used `<Infinity>` instead of the imported `<InfinityIcon>`.
- `JellyfinLibraryItemExtended.MusicBrainzReleaseGroup` was declared required;
  made optional (`?`) to match siblings and existing test mocks.

## 3. Express 5 route incompatibility — **crash on startup**

`server/routes/caaproxy.ts` and `tmdbproxy.ts` used the express-4 catch-all
`'/*'`. Under the merged express 5 / `path-to-regexp` v8 this throws
`Missing parameter name at index 2: /*` and the server exits on boot. Changed to
the named wildcard `'/*path'` (handlers read `req.path`, so no further change).
(`tadbproxy.ts` was already migrated during conflict resolution.)
**Found by booting the image against a copy of the production DB.**

## 4. `AddMusicSupport` migration — **the deploy blocker**

The upstream music branch shipped one auto-generated migration
(`1762648478949-AddMusicSupport`). Two problems on top of `develop`:

1. **Ordering:** its timestamp predates `RenameBlacklistToBlocklist`
   (`1771080196816`), which stable releases already ran. On an existing DB it
   runs as "pending" in timestamp order and its SQL targets a table literally
   named `blacklist`, which no longer exists → `no such table: blacklist`,
   startup aborts.
2. **Clobbering:** it does full SQLite table rebuilds with column lists captured
   from an old schema snapshot, which would drop columns later `develop`
   migrations added to `user`/`media`/`watchlist`.

**Fix:** replaced it with `1780000000000-AddMusicSupport` (sqlite) /
`1780000000001` (postgres), stamped after every existing migration, targeting
the post-rename `blocklist` table. New metadata tables use
`CREATE TABLE IF NOT EXISTS`.

**Follow-up fix (found via a failed album request):** music `media`/`watchlist`/
`blocklist` rows have a **NULL `tmdbId`** (they key on `mbId`), but `tmdbId` was
still `NOT NULL` → requesting an album failed with
`SQLITE_CONSTRAINT: NOT NULL constraint failed: media.tmdbId`. SQLite can't
`ALTER COLUMN`, so the migration now **rebuilds those three tables** with
`tmdbId` nullable (+ `mbId` column and all indexes), copying every existing
column **by name** so nothing develop added is dropped. Postgres uses
`ALTER COLUMN ... DROP NOT NULL`.

Modified the existing (unreleased) migration rather than adding a new one,
because production has not applied it yet. *Once cut over, further schema
changes must be new migrations.*

**Note on the production DB:** it already had the old migration recorded and
empty `metadata_album`/`metadata_artist` tables left over from a previous failed
attempt; the `IF NOT EXISTS` creates absorb that partial state.

## 5. Discover "music" filter: split into Release Type + Genre

The single control labelled **"Genres"** was actually a hardcoded list of
MusicBrainz **release types** (Album/EP/Single/…), and the backend filtered on a
broken fallback chain (`secondary_type` → `release_tags[0]` → `primary_type`).
Split into two independent filters:

- **Release Type** (`releaseType` param) — primary/secondary type, present on
  ~all releases.
- **Genre** (`genre` param) — real genres from `release_tags`; a *creatable*
  multiselect (genres are free-text and present on only ~10% of fresh releases),
  with suggestions sourced from the discover sample. Added `releaseTags` to the
  API result payload.

Applied as independent AND `.filter()` passes.

## 6. Deployment/runtime note — Node Happy Eyeballs timeout (NOT yet in code)

`/discover/music` returned **500** with an `AggregateError` from ListenBrainz
calls. Root cause is not a code bug: Node's `autoSelectFamily` (Happy Eyeballs)
gives each connection attempt only **250 ms**; `listenbrainz.org` is hosted in
Germany and the deployment is in Australia (~250–300 ms RTT), so every attempt
aborts just before the handshake completes. IPv6 also fails fast (no IPv6 route
on the docker network).

**Mitigation applied at the deployment** (not committed):
`NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000`.

**Decision needed before cutover:** bake
`net.setDefaultAutoSelectFamilyAttemptTimeout(5000)` into server startup (makes
the image self-sufficient and helps any high-latency-from-EU deployment), or
ship it as a documented compose env var. Recommend the code change for the fork.

## Verification

- Client + server `tsc --noEmit` clean after every step.
- Migration validated against a `.backup` copy of the production v3.2.0 DB:
  applies cleanly, preserves all rows, integrity OK.
- Image booted against a prod-DB copy: server ready, migrations apply, talks to
  Lidarr. (Album-request success after the `tmdbId` fix + filter UI: verifying
  on the current rebuild.)

## Open items / known limitations

- [ ] Decide on the Happy Eyeballs timeout fix (code vs env) — section 6.
- [ ] Genre suggestions are sparse (~10% of fresh releases carry tags); the
      control is creatable so users can still type any genre.
- [ ] `/discover/music` first load is slow (~14 s) due to serial MusicBrainz/
      CoverArt/ListenBrainz lookups to Germany; cache warms subsequent loads.
- [ ] `preview.yml` / `release.yml` left untouched (they target Docker Hub and
      need secrets the fork lacks); a dedicated `music-ghcr.yml` builds to GHCR.
