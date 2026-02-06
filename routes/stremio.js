const express = require('express');
const { manifest } = require('../config');
const { getUserId, getUserShows, hasShow, recordWatch } = require('../services/db');
const { fetchMeta } = require('../services/cinemeta');
const { pickSmartRandomEpisode } = require('../services/randomizer');
const { resolveEpisodeDescription } = require('../services/history');
const { parseEpisodeId, findEpisodeVideo, buildEpisodeMeta } = require('../utils/episode');
const { asyncHandler } = require('../middleware/errorHandler');
const { stremioLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply rate limiting to Stremio routes
router.use(stremioLimiter);

/**
 * Addon manifest
 */
router.get('/manifest.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.json(manifest);
});

/**
 * Catalog handler
 */
router.get('/catalog/:type/:id.json', asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const userId = getUserId(req);

  console.log('Catalog request:', type, id, req.query);

  if (id === 'random-episode') {
    const items = [];
    const userShows = await getUserShows(userId);

    if (userShows.length > 0) {
      items.push({
        id: 'random-episode-action',
        type: 'series',
        name: '🎲 Random All Shows',
        poster: 'https://i.redd.it/e2wriei591m51.jpg',
        description:
          'Click to play a random episode from any show in your list',
        behaviorHints: {
          bingeGroup: 'random-episode',
          featured: true,
        },
      });
    }

    items.push(
      ...userShows.map((show) => ({
        id: `random-episode-show:${show.id}`,
        type: 'series',
        name: `🎲 Random ${show.name}`,
        poster: show.poster,
        background: show.background,
      })),
    );

    return res.json({ metas: items });
  }

  res.json({ metas: [] });
}));

/**
 * Meta handler - the core logic for random episode selection
 * 
 * KEY FIX FOR METADATA MISMATCH:
 * When handling random-episode-action or random-episode-show:*, we:
 * 1. Pick a random episode
 * 2. Return metadata with the CANONICAL episode ID (e.g., tt0944947:1:5)
 * 3. This ensures subsequent requests use the stable episode ID
 * 4. Record the watch in history
 */
router.get('/meta/:type/:id.json', asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const userId = getUserId(req);

  console.log('Meta request:', type, id);

  // Handle direct episode ID requests (e.g., tt0944947:1:5)
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

  // Handle "Random All Shows" action
  if (id === 'random-episode-action') {
    const userShows = await getUserShows(userId);
    const payload = await pickSmartRandomEpisode(userId, userShows);
    
    if (!payload) {
      return res.json({ meta: null });
    }

    const description = await resolveEpisodeDescription(
      payload.seriesMeta,
      payload.video,
      payload.season,
      payload.episode,
    );

    // Record this watch in history
    await recordWatch(userId, {
      showId: payload.show.id,
      episodeId: payload.episodeId,
      season: payload.season,
      episode: payload.episode,
      showName: payload.seriesMeta.meta.name,
      episodeName: payload.video?.name || payload.video?.title || '',
      poster: payload.seriesMeta.meta.poster,
    });

    // KEY FIX: Return the canonical episode ID, not 'random-episode-action'
    // This ensures Stremio caches the correct metadata
    return res.json(buildEpisodeMeta(
      payload.seriesMeta,
      payload.episodeId,  // e.g., "tt0944947:1:5" - stable ID
      payload.season,
      payload.episode,
      payload.video,
      description,
    ));
  }

  // Handle "Random [Show Name]" action
  if (id.startsWith('random-episode-show:')) {
    const showId = id.replace('random-episode-show:', '').trim();
    if (!showId) {
      return res.json({ meta: null });
    }

    const userShows = await getUserShows(userId);
    const payload = await pickSmartRandomEpisode(userId, userShows, showId);

    if (!payload) {
      return res.json({ meta: null });
    }

    const description = await resolveEpisodeDescription(
      payload.seriesMeta,
      payload.video,
      payload.season,
      payload.episode,
    );

    // Record this watch in history
    await recordWatch(userId, {
      showId: payload.show.id,
      episodeId: payload.episodeId,
      season: payload.season,
      episode: payload.episode,
      showName: payload.seriesMeta.meta.name,
      episodeName: payload.video?.name || payload.video?.title || '',
      poster: payload.seriesMeta.meta.poster,
    });

    // KEY FIX: Return the canonical episode ID
    return res.json(buildEpisodeMeta(
      payload.seriesMeta,
      payload.episodeId,  // Stable episode ID
      payload.season,
      payload.episode,
      payload.video,
      description,
    ));
  }

  // Handle regular series metadata requests
  const userShow = userId ? await hasShow(userId, id) : false;
  if (userShow) {
    const meta = await fetchMeta('series', id);
    if (meta) return res.json(meta);
  }

  const meta = await fetchMeta(type, id);
  res.json(meta || { meta: null });
}));

/**
 * Stream handler
 * We don't provide streams - we rely on other addons (Torrentio, etc.)
 */
router.get('/stream/:type/:id.json', asyncHandler(async (req, res) => {
  console.log('Stream request:', req.params.type, req.params.id);
  
  // We don't provide streams, but returning empty array allows other addons to handle it
  res.json({ streams: [] });
}));

module.exports = router;
