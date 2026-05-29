import {
  DuplicateWatchlistRequestError,
  NotFoundError,
  Watchlist,
} from '@server/entity/Watchlist';
import logger from '@server/logger';
import { Router } from 'express';
import { QueryFailedError } from 'typeorm';

import { MediaType } from '@server/constants/media';
import { watchlistCreate } from '@server/interfaces/api/watchlistCreate';

const watchlistRoutes = Router();

watchlistRoutes.post<never, Watchlist, Watchlist>(
  '/',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to add watchlist.',
        });
      }
      const values = watchlistCreate.parse(req.body);

      const request = await Watchlist.createWatchlist({
        watchlistRequest: values,
        user: req.user,
      });
      return res.status(201).json(request);
    } catch (error) {
      if (!(error instanceof Error)) {
        return;
      }
      switch (error.constructor) {
        case QueryFailedError:
          logger.warn('Something wrong with data watchlist', {
            tmdbId: req.body.tmdbId,
            mbId: req.body.mbId,
            mediaType: req.body.mediaType,
            label: 'Watchlist',
          });
          return next({ status: 409, message: 'Something wrong' });
        case DuplicateWatchlistRequestError:
          return next({ status: 409, message: error.message });
        default:
          return next({ status: 500, message: error.message });
      }
    }
  }
);

watchlistRoutes.delete('/:id', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to delete watchlist data.',
    });
  }
  try {
    // Music items are identified by a MusicBrainz id (string) and do not
    // include a mediaType query parameter; movies/TV use a numeric tmdbId
    // disambiguated by the required mediaType query parameter.
    const isNumericId = !isNaN(Number(req.params.id));

    if (isNumericId) {
      const mediaType = req.query.mediaType;
      if (mediaType !== MediaType.MOVIE && mediaType !== MediaType.TV) {
        return next({
          status: 400,
          message: 'Invalid mediaType query parameter.',
        });
      }

      await Watchlist.deleteWatchlist(
        Number(req.params.id),
        mediaType,
        req.user
      );
    } else {
      await Watchlist.deleteWatchlist(
        req.params.id,
        MediaType.MUSIC,
        req.user
      );
    }
    return res.status(204).send();
  } catch (e) {
    if (e instanceof NotFoundError) {
      return next({
        status: 404,
        message: e.message,
      });
    }
    return next({ status: 500, message: e.message });
  }
});

export default watchlistRoutes;
