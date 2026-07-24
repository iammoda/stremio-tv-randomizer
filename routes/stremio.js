const express = require('express');
const { manifest } = require('../config');
const {
  getUserId,
  getUserShows,
  hasShow,
  recordWatchedEpisode,
} = require('../services/db');
const { fetchMeta } = require('../services/cinemeta');
const { pickSmartRandomEpisode } = require('../services/randomizer');
const { resolveEpisodeDescription } = require('../services/descriptions');
const { parseEpisodeId, findEpisodeVideo, buildEpisodeMeta } = require('../utils/episode');
const { asyncHandler } = require('../middleware/errorHandler');
const { stremioLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply rate limiting to Stremio routes
router.use(stremioLimiter);

// Cache-Control presets.
// - Canonical/deterministic responses are safe to cache (client + CDN),
//   which absorbs Stremio's detail-page + player double meta request.
// - Random-action responses must never be cached, or clicks stop re-rolling.
const CACHE_STATIC = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';
const CACHE_MANIFEST = 'public, max-age=600, s-maxage=3600';
const CACHE_NONE = 'no-store';

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Addon manifest
 */
router.get('/manifest.json', (req, res) => {
  res.set('Cache-Control', CACHE_MANIFEST);
  res.json({
    ...manifest,
    logo: `${getBaseUrl(req)}/logo.png`,
  });
});

/**
 * Build catalog tiles for the user's shows, optionally filtered by search
 */
function buildCatalogItems(userShows, baseUrl, search = '') {
  const items = [];
  const query = String(search || '').trim().toLowerCase();
  const matchingShows = query
    ? userShows.filter((show) =>
        String(show.name || '').toLowerCase().includes(query),
      )
    : userShows;

  if (!query && userShows.length > 0) {
    items.push({
      id: 'random-episode-action',
      type: 'series',
      name: '🎲 Random All Shows',
      poster: `${baseUrl}/poster-random.png`,
      description:
        'Click to play a random episode from any show in your list',
      behaviorHints: {
        bingeGroup: 'random-episode',
        featured: true,
      },
    });
  }

  items.push(
    ...matchingShows.map((show) => ({
      id: `random-episode-show:${show.id}`,
      type: 'series',
      name: `🎲 Random ${show.name}`,
      poster: show.poster,
      background: show.background,
    })),
  );

  return items;
}

/**
 * Catalog handler (with optional extra args, e.g. search=...)
 */
const catalogHandler = asyncHandler(async (req, res) => {
  const { type, id, extra } = req.params;
  const userId = getUserId(req);

  // Per-user data that changes on add/remove — never cache
  res.set('Cache-Control', CACHE_NONE);

  console.log('Catalog request:', type, id, extra || '');

  if (id === 'random-episode') {
    const extraParams = Object.fromEntries(new URLSearchParams(extra || ''));
    const userShows = await getUserShows(userId);
    const items = buildCatalogItems(userShows, getBaseUrl(req), extraParams.search);
    return res.json({ metas: items });
  }

  res.json({ metas: [] });
});

router.get('/catalog/:type/:id.json', catalogHandler);
router.get('/catalog/:type/:id/:extra.json', catalogHandler);

/**
 * Pick a random episode and respond with meta under the CANONICAL episode ID
 * (e.g. tt0944947:1:5), never the random-action ID. This keeps follow-up
 * requests (player, stream addons) stable and cacheable.
 */
async function respondWithRandomEpisodeMeta(req, res, targetShowId = null) {
  const userId = getUserId(req);
  const userShows = await getUserShows(userId);
  const payload = await pickSmartRandomEpisode(userId, userShows, targetShowId);

  if (!payload) {
    return res.json({ meta: null });
  }

  const description = await resolveEpisodeDescription(
    payload.seriesMeta,
    payload.video,
    payload.season,
    payload.episode,
  );

  return res.json(buildEpisodeMeta(
    payload.seriesMeta,
    payload.episodeId,
    payload.season,
    payload.episode,
    payload.video,
    description,
  ));
}

/**
 * Meta handler - the core logic for random episode selection
 */
router.get('/meta/:type/:id.json', asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const userId = getUserId(req);

  console.log('Meta request:', type, id);

  // Handle direct episode ID requests (e.g., tt0944947:1:5).
  // Deterministic -> cacheable; the player's second meta request is served
  // from HTTP/CDN cache instead of hitting Cinemeta again.
  const episodeInfo = parseEpisodeId(id);
  if (episodeInfo) {
    const meta = await fetchMeta('series', episodeInfo.showId);
    if (meta && meta.meta) {
      const video = findEpisodeVideo(
        meta,
        episodeInfo.season,
        episodeInfo.episode,
      );
      const description = await resolveEpisodeDescription(
        meta,
        video,
        episodeInfo.season,
        episodeInfo.episode,
      );
      res.set('Cache-Control', CACHE_STATIC);
      return res.json(buildEpisodeMeta(
        meta,
        id,
        episodeInfo.season,
        episodeInfo.episode,
        video,
        description,
      ));
    }
  }

  // Handle "Random All Shows" action — must re-roll on every request
  if (id === 'random-episode-action') {
    res.set('Cache-Control', CACHE_NONE);
    return respondWithRandomEpisodeMeta(req, res);
  }

  // Handle "Random [Show Name]" action
  if (id.startsWith('random-episode-show:')) {
    res.set('Cache-Control', CACHE_NONE);
    const showId = id.replace('random-episode-show:', '').trim();
    if (!showId) {
      return res.json({ meta: null });
    }
    return respondWithRandomEpisodeMeta(req, res, showId);
  }

  // Handle regular series metadata requests
  const userShow = userId ? await hasShow(userId, id) : false;
  if (userShow) {
    const meta = await fetchMeta('series', id);
    if (meta) {
      res.set('Cache-Control', CACHE_STATIC);
      return res.json(meta);
    }
  }

  const meta = await fetchMeta(type, id);
  if (meta) res.set('Cache-Control', CACHE_STATIC);
  res.json(meta || { meta: null });
}));

/**
 * Stream handler
 * We don't provide streams - we rely on other addons (Torrentio, etc.)
 */
router.get('/stream/:type/:id.json', asyncHandler(async (req, res) => {
  console.log('Stream request:', req.params.type, req.params.id);

  res.set('Cache-Control', CACHE_STATIC);
  res.json({ streams: [] });
}));

/**
 * Subtitles handler — used as the "playback started" signal.
 *
 * Stremio requests subtitles from every subtitle-capable addon only when the
 * player actually opens a video (the request carries the real file's
 * videoHash/videoSize/filename). A meta request only means "clicked".
 * We record the watch for cooldown-based exclusion and return no subtitles.
 */
const subtitlesHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = getUserId(req);

  res.set('Cache-Control', CACHE_NONE);

  const episodeInfo = parseEpisodeId(id);
  if (userId && episodeInfo) {
    const inList = await hasShow(userId, episodeInfo.showId);
    if (inList) {
      const episodeId = `${episodeInfo.showId}:${episodeInfo.season}:${episodeInfo.episode}`;
      console.log('Recording watched episode:', episodeId);
      await recordWatchedEpisode(userId, {
        showId: episodeInfo.showId,
        episodeId,
        season: episodeInfo.season,
        episode: episodeInfo.episode,
      });
    }
  }

  res.json({ subtitles: [] });
});

router.get('/subtitles/:type/:id.json', subtitlesHandler);
router.get('/subtitles/:type/:id/:extra.json', subtitlesHandler);

module.exports = router;
