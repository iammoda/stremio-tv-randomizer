const express = require('express');
const { MAX_SHOWS } = require('../config');
const {
  getUserId,
  getUserShows,
  getShowCount,
  hasShow,
  insertShow,
  deleteShow,
  getDb,
  getShowSettings,
  updateShowSettings,
  deleteShowSettings,
} = require('../services/db');
const { fetchMeta } = require('../services/cinemeta');
const { searchShows, getTvmazeShow } = require('../services/tvmaze');
const { getAvailableSeasons, getSeasonEpisodeCounts } = require('../services/randomizer');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiLimiter, searchLimiter } = require('../middleware/rateLimiter');
const {
  handleValidationErrors,
  validateUserId,
  validateImdbId,
  validateImdbIdBody,
  validateSearchQuery,
  validateSeasonSettings,
} = require('../middleware/validator');

const router = express.Router();

// Apply rate limiting to all API routes
router.use(apiLimiter);

/**
 * Health check
 */
router.get('/health', asyncHandler(async (req, res) => {
  await getDb();
  res.json({ ok: true });
}));

/**
 * Search for TV shows
 */
router.get('/search',
  searchLimiter,
  validateSearchQuery,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    const metas = await searchShows(q);
    res.json({ metas: metas.slice(0, 10) });
  })
);

/**
 * Get user's shows
 */
router.get('/shows',
  validateUserId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ shows: [], limit: MAX_SHOWS });
    }
    const shows = await getUserShows(userId);
    res.json({ shows, limit: MAX_SHOWS });
  })
);

/**
 * Add a show to user's list
 */
router.post('/shows',
  validateUserId,
  validateImdbIdBody,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    let { imdbId } = req.body;

    if (!userId) {
      return res.json({ success: false, error: 'Missing user key' });
    }

    const showCount = await getShowCount(userId);
    if (showCount >= MAX_SHOWS) {
      return res.json({ success: false, error: `Maximum of ${MAX_SHOWS} shows allowed` });
    }

    // Handle TVmaze IDs
    if (imdbId.startsWith('tvmaze-')) {
      const tvmazeId = imdbId.replace('tvmaze-', '');
      const show = await getTvmazeShow(tvmazeId);
      if (show && show.externals && show.externals.imdb) {
        imdbId = show.externals.imdb;
      } else {
        return res.json({ success: false, error: 'No IMDB ID available for this show' });
      }
    }

    const meta = await fetchMeta('series', imdbId);
    if (meta && meta.meta) {
      const exists = await hasShow(userId, imdbId);
      if (exists) {
        return res.json({ success: false, exists: true });
      }
      await insertShow(userId, {
        id: imdbId,
        name: meta.meta.name,
        poster: meta.meta.poster,
        background: meta.meta.background,
      });
      return res.json({ success: true });
    }

    res.json({ success: false, error: 'Failed to fetch show metadata' });
  })
);

/**
 * Remove a show from user's list
 */
router.delete('/shows/:imdbId',
  validateUserId,
  validateImdbId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ success: false });
    }
    await deleteShow(userId, req.params.imdbId);
    await deleteShowSettings(userId, req.params.imdbId);
    const shows = await getUserShows(userId);
    res.json({ success: true, shows });
  })
);

// ===================
// SHOW SETTINGS (SEASONS)
// ===================

/**
 * Get available seasons for a show
 */
router.get('/shows/:imdbId/seasons',
  validateImdbId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { imdbId } = req.params;
    const seasons = await getAvailableSeasons(imdbId);
    const episodeCounts = await getSeasonEpisodeCounts(imdbId);
    res.json({ seasons, episodeCounts });
  })
);

/**
 * Get show settings for a user
 */
router.get('/shows/:imdbId/settings',
  validateUserId,
  validateImdbId,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { imdbId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing user key' });
    }
    
    const settings = await getShowSettings(userId, imdbId);
    res.json({
      enabledSeasons: settings?.enabledSeasons || [],
    });
  })
);

/**
 * Update show settings for a user
 */
router.put('/shows/:imdbId/settings',
  validateUserId,
  validateImdbId,
  validateSeasonSettings,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const userId = getUserId(req);
    const { imdbId } = req.params;
    const { enabledSeasons } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing user key' });
    }
    
    await updateShowSettings(userId, imdbId, { enabledSeasons });
    res.json({ success: true, enabledSeasons });
  })
);

module.exports = router;
