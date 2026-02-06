const { CINEMETA_URL } = require('../config');
const fetchFn = global.fetch || require('node-fetch');

/**
 * Fetch metadata from Cinemeta
 */
async function fetchMeta(type, id) {
  try {
    const response = await fetchFn(`${CINEMETA_URL}/meta/${type}/${id}.json`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    console.error('Failed to fetch meta:', e);
  }
  return null;
}

/**
 * Get all available seasons for a show
 */
async function getShowSeasons(showId) {
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

module.exports = {
  fetchMeta,
  getShowSeasons,
};
