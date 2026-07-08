import ExternalAPI from '@server/api/externalapi';
import MusicBrainz from '@server/api/musicbrainz';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import MetadataArtist from '@server/entity/MetadataArtist';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import { In } from 'typeorm';
import type { TmdbSearchPersonResponse } from './interfaces';

interface SearchPersonOptions {
  query: string;
  page?: number;
  includeAdult?: boolean;
  language?: string;
}

class TmdbPersonMapper extends ExternalAPI {
  private readonly CACHE_TTL = 43200;
  private readonly STALE_THRESHOLD = 30 * 24 * 60 * 60 * 1000;
  private tmdb: TheMovieDb;

  constructor() {
    super(
      'https://api.themoviedb.org/3',
      {
        api_key: '431a8708161bcd1f1fbe7536137e61ed',
      },
      {
        nodeCache: cacheManager.getCache('tmdb').data,
        rateLimit: {
          maxRequests: 20,
          maxRPS: 50,
        },
      }
    );
    this.tmdb = new TheMovieDb();
  }

  private isMetadataStale(metadata: MetadataArtist | null): boolean {
    if (!metadata || !metadata.tmdbUpdatedAt) return true;
    return Date.now() - metadata.tmdbUpdatedAt.getTime() > this.STALE_THRESHOLD;
  }

  private createEmptyResponse() {
    return { personId: null, profilePath: null };
  }

  public async getMappingFromCache(
    artistId: string
  ): Promise<{ personId: number | null; profilePath: string | null } | null> {
    try {
      const metadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: artistId },
        select: ['tmdbPersonId', 'tmdbThumb', 'tmdbUpdatedAt'],
      });

      if (!metadata) {
        return null;
      }

      if (this.isMetadataStale(metadata)) {
        return null;
      }

      return {
        personId: metadata.tmdbPersonId ? Number(metadata.tmdbPersonId) : null,
        profilePath: metadata.tmdbThumb,
      };
    } catch (error) {
      logger.error('Failed to get person mapping from cache', {
        label: 'TmdbPersonMapper',
        artistId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  public async getMapping(
    artistId: string,
    artistName: string
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    try {
      const metadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: artistId },
        select: ['tmdbPersonId', 'tmdbThumb', 'tmdbUpdatedAt'],
      });

      if (metadata?.tmdbPersonId || metadata?.tmdbThumb) {
        return {
          personId: metadata.tmdbPersonId
            ? Number(metadata.tmdbPersonId)
            : null,
          profilePath: metadata.tmdbThumb,
        };
      }

      if (metadata && !this.isMetadataStale(metadata)) {
        return this.createEmptyResponse();
      }

      return await this.fetchMapping(artistId, artistName);
    } catch (error) {
      logger.error('Failed to get person mapping', {
        label: 'TmdbPersonMapper',
        artistId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createEmptyResponse();
    }
  }

  private async fetchMapping(
    artistId: string,
    artistName: string
  ): Promise<{ personId: number | null; profilePath: string | null }> {
    try {
      const existingMetadata = await getRepository(MetadataArtist).findOne({
        where: { mbArtistId: artistId },
        select: ['tmdbPersonId', 'tmdbThumb', 'tmdbUpdatedAt'],
      });

      if (existingMetadata?.tmdbPersonId) {
        return {
          personId: Number(existingMetadata.tmdbPersonId),
          profilePath: existingMetadata.tmdbThumb,
        };
      }

      // Verify identity via a real cross-reference (MusicBrainz URL relations
      // -> IMDb / Wikidata -> TMDB), never a name match, so we don't conflate
      // same-named people (e.g. a musician and an unrelated actor).
      const musicbrainz = new MusicBrainz();
      const { imdbId, wikidataId } = await musicbrainz.getArtistExternalIds(
        artistId
      );

      let match: { id: number; profilePath: string | null } | null = null;

      if (imdbId) {
        match = await this.resolveTmdbPersonByImdb(imdbId);
      }

      if (!match && wikidataId) {
        match = await this.resolveTmdbPersonByWikidata(wikidataId);
      }

      const mapping = {
        personId: match?.id ?? null,
        profilePath: match?.profilePath ?? null,
      };

      await getRepository(MetadataArtist)
        .upsert(
          {
            mbArtistId: artistId,
            tmdbPersonId: mapping.personId?.toString() ?? null,
            tmdbThumb: mapping.profilePath,
            tmdbUpdatedAt: new Date(),
          },
          {
            conflictPaths: ['mbArtistId'],
          }
        )
        .catch((e) => {
          logger.error('Failed to save artist metadata', {
            label: 'TmdbPersonMapper',
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        });

      return mapping;
    } catch (error) {
      await getRepository(MetadataArtist).upsert(
        {
          mbArtistId: artistId,
          tmdbPersonId: null,
          tmdbThumb: null,
          tmdbUpdatedAt: new Date(),
        },
        {
          conflictPaths: ['mbArtistId'],
        }
      );
      return this.createEmptyResponse();
    }
  }

  /**
   * Resolve a verified TMDB person from an IMDb name id (nm) via TMDB's
   * find-by-external-id endpoint. An identity cross-reference, not a name
   * guess, so it will not conflate same-named people.
   */
  private async resolveTmdbPersonByImdb(
    imdbId: string
  ): Promise<{ id: number; profilePath: string | null } | null> {
    const res = await this.tmdb.getByExternalId({
      externalId: imdbId,
      type: 'imdb',
    });
    const person = res.person_results?.[0];
    if (!person) {
      return null;
    }
    return {
      id: person.id,
      profilePath: person.profile_path
        ? `https://image.tmdb.org/t/p/w500${person.profile_path}`
        : null,
    };
  }

  /**
   * Resolve a verified TMDB person from a Wikidata entity by bridging through
   * its IMDb ID claim (P345). Returns null when the entity has no IMDb link.
   */
  private async resolveTmdbPersonByWikidata(
    wikidataId: string
  ): Promise<{ id: number; profilePath: string | null } | null> {
    try {
      const response = await fetch(
        `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`
      );
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as {
        entities?: Record<
          string,
          {
            claims?: Record<
              string,
              { mainsnak?: { datavalue?: { value?: unknown } } }[]
            >;
          }
        >;
      };
      const imdbId =
        data.entities?.[wikidataId]?.claims?.P345?.[0]?.mainsnak?.datavalue
          ?.value;
      if (typeof imdbId === 'string' && /^nm\d+$/.test(imdbId)) {
        return await this.resolveTmdbPersonByImdb(imdbId);
      }
      return null;
    } catch {
      return null;
    }
  }

  public async batchGetMappings(
    artists: { artistId: string; artistName: string }[]
  ): Promise<
    Record<string, { personId: number | null; profilePath: string | null }>
  > {
    if (!artists.length) return {};

    const metadataRepository = getRepository(MetadataArtist);
    const artistIds = artists.map((a) => a.artistId);

    const existingMetadata = await metadataRepository.find({
      where: { mbArtistId: In(artistIds) },
      select: ['mbArtistId', 'tmdbPersonId', 'tmdbThumb', 'tmdbUpdatedAt'],
    });

    const results: Record<
      string,
      { personId: number | null; profilePath: string | null }
    > = {};
    const artistsToFetch: { artistId: string; artistName: string }[] = [];

    artists.forEach(({ artistId, artistName }) => {
      const metadata = existingMetadata.find((m) => m.mbArtistId === artistId);

      if (metadata?.tmdbPersonId || metadata?.tmdbThumb) {
        results[artistId] = {
          personId: metadata.tmdbPersonId
            ? Number(metadata.tmdbPersonId)
            : null,
          profilePath: metadata.tmdbThumb,
        };
      } else if (metadata && !this.isMetadataStale(metadata)) {
        results[artistId] = this.createEmptyResponse();
      } else {
        artistsToFetch.push({ artistId, artistName });
      }
    });

    if (artistsToFetch.length > 0) {
      const batchSize = 5;
      for (let i = 0; i < artistsToFetch.length; i += batchSize) {
        const batch = artistsToFetch.slice(i, i + batchSize);
        const batchPromises = batch.map(({ artistId, artistName }) =>
          this.fetchMapping(artistId, artistName)
            .then((mapping) => {
              results[artistId] = mapping;
              return true;
            })
            .catch(() => {
              results[artistId] = this.createEmptyResponse();
              return false;
            })
        );

        await Promise.all(batchPromises);
      }
    }

    return results;
  }

  public async searchPerson(
    options: SearchPersonOptions
  ): Promise<TmdbSearchPersonResponse> {
    try {
      return await this.get<TmdbSearchPersonResponse>(
        '/search/person',
        {
          params: {
            query: options.query,
            page: options.page?.toString() ?? '1',
            include_adult: options.includeAdult ? 'true' : 'false',
            language: options.language ?? 'en',
          },
        },
        this.CACHE_TTL
      );
    } catch (e) {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  }
}

export default TmdbPersonMapper;
