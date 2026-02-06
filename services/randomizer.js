const { fetchMeta } = require('./cinemeta');
const { getShowSettings } = require('./db');
const { normalizeEpisode } = require('../utils/episode');

/**
 * Pick a smart random episode from user's shows
 * 
 * Algorithm:
 * 1. Shuffle shows to randomize selection
 * 2. For each show, get available episodes
 * 3. Filter by enabled seasons (per-show settings)
 * 4. Pick a random episode from the filtered list
 * 5. Return first successful pick
 * 
 * @param {string} userId - User ID
 * @param {Array} userShows - List of user's shows
 * @param {string|null} targetShowId - If set, only pick from this show
 * @returns {Object|null} Episode data or null if none found
 */
async function pickSmartRandomEpisode(userId, userShows, targetShowId = null) {
  if (!userShows || userShows.length === 0) return null;

  // Filter to target show if specified
  const showPool = targetShowId
    ? userShows.filter((s) => s.id === targetShowId)
    : userShows;

  if (showPool.length === 0) return null;

  // Shuffle shows to randomize which show we try first
  const shuffled = [...showPool].sort(() => Math.random() - 0.5);

  for (const show of shuffled) {
    const result = await pickEpisodeFromShow(userId, show);
    if (result) return result;
  }

  return null;
}

/**
 * Pick a random episode from a specific show, respecting settings
 */
async function pickEpisodeFromShow(userId, show) {
  // Fetch show metadata
  const meta = await fetchMeta('series', show.id);
  if (!meta || !meta.meta || !meta.meta.videos || meta.meta.videos.length === 0) {
    return null;
  }

  // Get enabled seasons for this show (empty array = all seasons)
  const settings = await getShowSettings(userId, show.id);
  const enabledSeasons = settings?.enabledSeasons || [];

  // Normalize and filter episodes
  const normalizedVideos = meta.meta.videos.map((video) =>
    normalizeEpisode(meta, video),
  );

  // Filter to streamable episodes (season > 0, episode > 0)
  let streamable = normalizedVideos.filter(
    (item) => item.season > 0 && item.episode > 0,
  );

  // If no streamable episodes, use all normalized videos
  if (streamable.length === 0) {
    streamable = normalizedVideos;
  }

  // Filter by enabled seasons if configured
  let filteredEpisodes = streamable;
  if (enabledSeasons.length > 0) {
    filteredEpisodes = streamable.filter((item) =>
      enabledSeasons.includes(item.season),
    );
    // If filtering removes all episodes, fall back to all streamable
    if (filteredEpisodes.length === 0) {
      filteredEpisodes = streamable;
    }
  }

  const picked =
    filteredEpisodes[Math.floor(Math.random() * filteredEpisodes.length)];

  return {
    seriesMeta: meta,
    episodeId: picked.id,
    season: picked.season,
    episode: picked.episode,
    video: picked.video,
    show,
  };
}

/**
 * Get available seasons for filtering UI
 */
async function getAvailableSeasons(showId) {
  const meta = await fetchMeta('series', showId);
  if (!meta || !meta.meta || !meta.meta.videos) {
    return [];
  }

  const seasons = new Set();
  for (const video of meta.meta.videos) {
    const season = Number(video.season);
    if (Number.isFinite(season) && season > 0) {
      seasons.add(season);
    }
  }

  return Array.from(seasons).sort((a, b) => a - b);
}

/**
 * Get episode count per season for a show
 */
async function getSeasonEpisodeCounts(showId) {
  const meta = await fetchMeta('series', showId);
  if (!meta || !meta.meta || !meta.meta.videos) {
    return {};
  }

  const counts = {};
  for (const video of meta.meta.videos) {
    const season = Number(video.season);
    if (Number.isFinite(season) && season > 0) {
      counts[season] = (counts[season] || 0) + 1;
    }
  }

  return counts;
}

module.exports = {
  pickSmartRandomEpisode,
  pickEpisodeFromShow,
  getAvailableSeasons,
  getSeasonEpisodeCounts,
};
