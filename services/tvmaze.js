const { TVMAZE_URL } = require('../config');
const { stripHtml } = require('../utils/html');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');

// Cache TVmaze show IDs to avoid repeated lookups
const tvmazeShowIdCache = new Map();

/**
 * Look up TVmaze show ID from IMDB ID
 */
async function fetchTvmazeShowId(imdbId, fetchImpl = fetchWithTimeout) {
  if (!imdbId || !imdbId.startsWith('tt')) return null;
  if (tvmazeShowIdCache.has(imdbId)) return tvmazeShowIdCache.get(imdbId);

  try {
    const response = await fetchImpl(
      `${TVMAZE_URL}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`,
    );
    if (!response.ok) {
      // Cache "not found" so we don't hammer TVmaze; transient errors throw instead
      if (response.status === 404) tvmazeShowIdCache.set(imdbId, null);
      return null;
    }
    const data = await response.json();
    const tvmazeId = data && data.id ? String(data.id) : null;
    tvmazeShowIdCache.set(imdbId, tvmazeId);
    return tvmazeId;
  } catch (e) {
    console.error('TVmaze show lookup failed:', e.message || e);
    return null;
  }
}

/**
 * Fetch episode summary from TVmaze
 */
async function fetchTvmazeEpisodeSummary(imdbId, season, episode, fetchImpl = fetchWithTimeout) {
  const tvmazeId = await fetchTvmazeShowId(imdbId, fetchImpl);
  if (!tvmazeId || !Number.isFinite(season) || !Number.isFinite(episode)) {
    return '';
  }

  try {
    const response = await fetchImpl(
      `${TVMAZE_URL}/shows/${tvmazeId}/episodebynumber?season=${season}&number=${episode}`,
    );
    if (!response.ok) return '';
    const data = await response.json();
    return stripHtml(data && data.summary ? data.summary : '');
  } catch (e) {
    console.error('TVmaze episode lookup failed:', e.message || e);
    return '';
  }
}

/**
 * Search for TV shows
 */
async function searchShows(query, fetchImpl = fetchWithTimeout) {
  if (!query || query.length < 2) return [];

  try {
    const response = await fetchImpl(
      `${TVMAZE_URL}/search/shows?q=${encodeURIComponent(query)}`,
    );
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => ({
        id:
          item.show.externals && item.show.externals.imdb
            ? item.show.externals.imdb
            : `tvmaze-${item.show.id}`,
        name: item.show.name,
        poster: item.show.image ? item.show.image.medium : null,
        year: item.show.premiered ? item.show.premiered.substring(0, 4) : null,
      }))
      .filter((show) => show.poster);
  } catch (e) {
    console.error('TVmaze search failed:', e.message || e);
    return [];
  }
}

/**
 * Get show details from TVmaze ID (for converting tvmaze-* IDs to IMDB)
 */
async function getTvmazeShow(tvmazeId, fetchImpl = fetchWithTimeout) {
  try {
    const response = await fetchImpl(`${TVMAZE_URL}/shows/${tvmazeId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error('TVmaze show fetch failed:', e.message || e);
    return null;
  }
}

module.exports = {
  fetchTvmazeShowId,
  fetchTvmazeEpisodeSummary,
  searchShows,
  getTvmazeShow,
};
