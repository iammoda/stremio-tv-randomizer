/**
 * Parse an episode ID string into components
 * Format: "tt1234567:1:5" -> { showId: "tt1234567", season: 1, episode: 5 }
 */
function parseEpisodeId(id) {
  if (!id || !id.startsWith('tt') || !id.includes(':')) return null;
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const season = Number(parts[1]);
  const episode = Number(parts[2]);
  if (Number.isNaN(season) || Number.isNaN(episode)) return null;
  return { showId: parts[0], season, episode };
}

/**
 * Format season and episode numbers as "S01E05"
 */
function formatEpisodeLabel(season, episode) {
  const safeSeason = Number.isFinite(season) ? season : 0;
  const safeEpisode = Number.isFinite(episode) ? episode : 0;
  return `S${String(safeSeason).padStart(2, '0')}E${String(safeEpisode).padStart(2, '0')}`;
}

/**
 * Extract season and episode numbers from a video object
 */
function getSeasonEpisodeFromVideo(video) {
  let season = Number(video && video.season);
  let episode = Number(video && (video.episode || video.number));
  if (!Number.isFinite(season) || !Number.isFinite(episode)) {
    const parsed = video && typeof video.id === 'string' ? parseEpisodeId(video.id) : null;
    if (parsed) {
      season = parsed.season;
      episode = parsed.episode;
    }
  }
  if (!Number.isFinite(season)) season = 0;
  if (!Number.isFinite(episode)) episode = 0;
  return { season, episode };
}

/**
 * Build an episode ID from components
 */
function buildEpisodeId(seriesId, season, episode, fallbackId) {
  if (fallbackId && typeof fallbackId === 'string' && fallbackId.startsWith('tt') && fallbackId.includes(':')) {
    return fallbackId;
  }
  if (!seriesId) return fallbackId || '';
  return `${seriesId}:${season}:${episode}`;
}

/**
 * Normalize an episode video object into a consistent format
 */
function normalizeEpisode(seriesMeta, video) {
  const { season, episode } = getSeasonEpisodeFromVideo(video || {});
  const id = buildEpisodeId(seriesMeta.meta.id, season, episode, video && video.id);
  return { id, season, episode, video };
}

/**
 * Find a specific episode video in metadata
 */
function findEpisodeVideo(meta, season, episode) {
  if (!meta || !meta.meta || !meta.meta.videos) return null;
  return meta.meta.videos.find(
    (v) =>
      Number(v.season) === season &&
      Number(v.episode || v.number) === episode,
  );
}

/**
 * Build complete episode metadata for Stremio response
 */
function buildEpisodeMeta(seriesMeta, episodeId, season, episode, video, descriptionOverride) {
  const episodeTitle =
    video && (video.name || video.title) ? video.name || video.title : '';
  const label = formatEpisodeLabel(season, episode);
  const showName = seriesMeta.meta.name;
  const displayTitle = episodeTitle
    ? `${showName} — ${episodeTitle} (${label})`
    : `${showName} — (${label})`;
  const releaseInfo =
    (video && video.released ? video.released.substring(0, 4) : '') ||
    seriesMeta.meta.releaseInfo ||
    '';
  const description =
    descriptionOverride ||
    (video && (video.description || video.overview)) ||
    seriesMeta.meta.description ||
    '';
  return {
    meta: {
      id: episodeId,
      type: 'series',
      name: displayTitle,
      series: showName,
      seriesId: seriesMeta.meta.id,
      season,
      episode,
      logo: seriesMeta.meta.logo,
      poster: seriesMeta.meta.poster,
      background: seriesMeta.meta.background,
      description,
      releaseInfo,
      released: video ? video.released || video.firstAired || '' : '',
      imdbRating: seriesMeta.meta.imdbRating,
      runtime: seriesMeta.meta.runtime,
      genres: seriesMeta.meta.genres,
      cast: seriesMeta.meta.cast,
      director: seriesMeta.meta.director,
      writer: seriesMeta.meta.writer,
      behaviorHints: {
        bingeGroup: seriesMeta.meta.id,
        featured: true,
        videoSize: 1080,
      },
      videos: [
        {
          id: episodeId,
          title: episodeTitle || `Episode ${episode}`,
          season,
          episode,
          released: video ? video.released || video.firstAired || '' : '',
          overview: description,
        },
      ],
    },
  };
}

module.exports = {
  parseEpisodeId,
  formatEpisodeLabel,
  getSeasonEpisodeFromVideo,
  buildEpisodeId,
  normalizeEpisode,
  findEpisodeVideo,
  buildEpisodeMeta,
};
