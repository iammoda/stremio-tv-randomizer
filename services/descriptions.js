const { normalizeText } = require('../utils/html');
const { fetchMeta } = require('./cinemeta');
const { fetchTvmazeEpisodeSummary } = require('./tvmaze');

/**
 * Resolve the best available episode description
 * Prefers episode-specific description over series description
 * Falls back to TVmaze if Cinemeta lacks episode description
 */
async function resolveEpisodeDescription(seriesMeta, video, season, episode) {
  const videoDescription =
    (video && (video.description || video.overview)) || '';
  const seriesDescription = seriesMeta.meta.description || '';
  const normalizedVideo = normalizeText(videoDescription);
  const normalizedSeries = normalizeText(seriesDescription);

  // If video has a unique description, use it
  if (videoDescription && normalizedVideo && normalizedVideo !== normalizedSeries) {
    return videoDescription;
  }

  // Try to get description from TVmaze
  const tvmazeSummary = await fetchTvmazeEpisodeSummary(
    seriesMeta.meta.id,
    season,
    episode,
  );
  if (tvmazeSummary) return tvmazeSummary;

  // Fall back to video description if available
  if (videoDescription) return videoDescription;
  
  // Last resort: series description
  return seriesDescription;
}

module.exports = {
  resolveEpisodeDescription,
};
