const { randomInt } = require('crypto');
const { DEFAULT_RANDOMIZATION_MODE } = require('../config');
const { fetchMeta } = require('./cinemeta');
const {
  getShowSettings,
  getShowSettingsMap,
  getUserSettings,
  getShowEpisodeStats,
  getShowEpisodeStatsMap,
  upsertShowEpisodeStats,
} = require('./db');
const { normalizeEpisode } = require('../utils/episode');

const SHOW_STATS_TTL_MS = 24 * 60 * 60 * 1000;
const SHOW_STATS_BUILD_CONCURRENCY = 5;
// Refresh older counts that included episodes which have not aired yet.
const EPISODE_ELIGIBILITY_VERSION = 1;

function defaultNow() {
  return new Date();
}

function defaultRandomInt(maxExclusive) {
  return randomInt(maxExclusive);
}

function getDependencies(options = {}) {
  return {
    fetchMetaFn: options.fetchMetaFn || fetchMeta,
    getShowSettingsFn: options.getShowSettingsFn || getShowSettings,
    getShowSettingsMapFn: options.getShowSettingsMapFn || getShowSettingsMap,
    getUserSettingsFn: options.getUserSettingsFn || getUserSettings,
    getShowEpisodeStatsFn: options.getShowEpisodeStatsFn || getShowEpisodeStats,
    getShowEpisodeStatsMapFn:
      options.getShowEpisodeStatsMapFn || getShowEpisodeStatsMap,
    upsertShowEpisodeStatsFn:
      options.upsertShowEpisodeStatsFn || upsertShowEpisodeStats,
    rngInt: options.rngInt || defaultRandomInt,
    nowFn: options.nowFn || defaultNow,
    statsTtlMs: Number.isFinite(options.statsTtlMs)
      ? options.statsTtlMs
      : SHOW_STATS_TTL_MS,
  };
}

/**
 * Build a normalized, deduplicated episode inventory from series metadata
 */
function buildEpisodeInventory(seriesMeta, now = defaultNow()) {
  const videos =
    seriesMeta && seriesMeta.meta && Array.isArray(seriesMeta.meta.videos)
      ? seriesMeta.meta.videos
      : [];

  if (videos.length === 0) {
    return {
      episodes: [],
      seasonCounts: {},
      availableSeasons: [],
      totalEpisodes: 0,
      nextReleaseAt: null,
    };
  }

  const deduped = [];
  const seen = new Set();

  for (const video of videos) {
    const normalized = normalizeEpisode(seriesMeta, video);
    if (!normalized || !normalized.id || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    deduped.push(normalized);
  }

  const streamable = deduped.filter(
    (item) => item.season > 0 && item.episode > 0,
  );
  const candidates = streamable.length > 0 ? streamable : deduped;
  let nextReleaseAt = null;
  const episodes = candidates.filter(({ video }) => {
    const releaseTime = [video?.released, video?.firstAired]
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => Date.parse(value))
      .find(Number.isFinite);
    // Unknown dates remain eligible; only a known future date excludes an episode.
    if (releaseTime === undefined || releaseTime <= now.getTime()) return true;
    if (nextReleaseAt === null || releaseTime < nextReleaseAt.getTime()) {
      nextReleaseAt = new Date(releaseTime);
    }
    return false;
  });

  // Keep upcoming seasons visible in settings, with zero eligible episodes.
  const seasonCounts = {};
  for (const candidate of candidates) {
    if (candidate.season > 0) seasonCounts[String(candidate.season)] = 0;
  }
  for (const episode of episodes) {
    if (episode.season > 0) {
      const key = String(episode.season);
      seasonCounts[key] = (seasonCounts[key] || 0) + 1;
    }
  }

  const availableSeasons = Object.keys(seasonCounts)
    .map(Number)
    .sort((a, b) => a - b);

  return {
    episodes,
    seasonCounts,
    availableSeasons,
    totalEpisodes: episodes.length,
    nextReleaseAt,
  };
}

/**
 * Filter an episode inventory by enabled seasons. An empty list means all seasons.
 */
function getEligibleEpisodesForShow(inventory, enabledSeasons = []) {
  const episodes = Array.isArray(inventory && inventory.episodes)
    ? inventory.episodes
    : [];

  if (episodes.length === 0) return [];
  if (!Array.isArray(enabledSeasons) || enabledSeasons.length === 0) {
    return episodes;
  }

  const seasons = new Set(enabledSeasons.map(Number));
  return episodes.filter((item) => seasons.has(item.season));
}

/**
 * Compute how many episodes remain eligible after applying season filters
 */
function getEligibleEpisodeCountFromStats(stats, enabledSeasons = []) {
  if (!stats || !Number.isFinite(stats.totalEpisodes) || stats.totalEpisodes <= 0) {
    return 0;
  }

  if (!Array.isArray(enabledSeasons) || enabledSeasons.length === 0) {
    return stats.totalEpisodes;
  }

  const seasonCounts = stats.seasonCounts || {};
  return [...new Set(enabledSeasons.map(Number))].reduce((sum, season) => {
    return sum + (seasonCounts[String(season)] || 0);
  }, 0);
}

function isStatsStale(stats, now = defaultNow(), statsTtlMs = SHOW_STATS_TTL_MS) {
  if (!stats || !stats.updatedAt || stats.eligibilityVersion !== EPISODE_ELIGIBILITY_VERSION) {
    return true;
  }
  const updatedAt = new Date(stats.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return true;
  if (stats.nextReleaseAt && new Date(stats.nextReleaseAt).getTime() <= now.getTime()) {
    return true;
  }
  return now.getTime() - updatedAt.getTime() >= statsTtlMs;
}

function buildStatsPayload(showId, inventory, nowFn = defaultNow) {
  return {
    showId,
    seasonCounts: inventory.seasonCounts,
    availableSeasons: inventory.availableSeasons,
    totalEpisodes: inventory.totalEpisodes,
    eligibilityVersion: EPISODE_ELIGIBILITY_VERSION,
    nextReleaseAt: inventory.nextReleaseAt,
    updatedAt: nowFn(),
  };
}

/**
 * Refresh the cached stats for a show from live metadata
 */
async function refreshShowEpisodeStats(showId, options = {}) {
  if (!showId) return null;

  const deps = getDependencies(options);
  const seriesMeta =
    options.seriesMeta || (await deps.fetchMetaFn('series', showId));

  if (!seriesMeta || !seriesMeta.meta) {
    return null;
  }

  const now = deps.nowFn();
  const inventory = buildEpisodeInventory(seriesMeta, now);
  const payload = buildStatsPayload(showId, inventory, () => now);
  return deps.upsertShowEpisodeStatsFn(showId, payload);
}

async function getOrRefreshShowEpisodeStats(showId, options = {}) {
  if (!showId) return null;

  const deps = getDependencies(options);
  const existing = await deps.getShowEpisodeStatsFn(showId);

  if (existing && (!options.refreshStale || !isStatsStale(existing, deps.nowFn(), deps.statsTtlMs))) {
    return existing;
  }

  const refreshed = await refreshShowEpisodeStats(showId, options);
  return refreshed || existing;
}

async function mapWithConcurrency(items, limit, iteratee) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Pick a show using weighted counts so each eligible episode has equal odds
 */
function pickWeightedShow(showsWithCounts, rngInt = defaultRandomInt) {
  if (!Array.isArray(showsWithCounts) || showsWithCounts.length === 0) {
    return null;
  }

  const totalWeight = showsWithCounts.reduce(
    (sum, item) => sum + item.eligibleCount,
    0,
  );

  if (totalWeight <= 0) return null;

  const target = rngInt(totalWeight);
  let running = 0;

  for (const item of showsWithCounts) {
    running += item.eligibleCount;
    if (target < running) {
      return item;
    }
  }

  return showsWithCounts[showsWithCounts.length - 1];
}

function pickEpisodeFromEligibleEpisodes(eligibleEpisodes, rngInt = defaultRandomInt) {
  if (!Array.isArray(eligibleEpisodes) || eligibleEpisodes.length === 0) {
    return null;
  }
  return eligibleEpisodes[rngInt(eligibleEpisodes.length)];
}

async function pickEpisodeFromShow(userId, show, options = {}) {
  if (!show || !show.id) return null;

  const deps = getDependencies(options);
  const meta = await deps.fetchMetaFn('series', show.id);
  if (!meta || !meta.meta) return null;

  const settings =
    options.settings ||
    (await deps.getShowSettingsFn(userId, show.id)) ||
    { enabledSeasons: [] };
  const inventory = buildEpisodeInventory(meta, deps.nowFn());
  const eligibleEpisodes = getEligibleEpisodesForShow(
    inventory,
    settings.enabledSeasons || [],
  );
  const picked = pickEpisodeFromEligibleEpisodes(eligibleEpisodes, deps.rngInt);

  if (!picked) return null;

  return {
    seriesMeta: meta,
    episodeId: picked.id,
    season: picked.season,
    episode: picked.episode,
    video: picked.video,
    show,
  };
}

async function pickAcrossAllShows(userId, showPool, options = {}) {
  const deps = getDependencies(options);
  const now = deps.nowFn();
  const showIds = showPool.map((show) => show.id);
  const [settingsMap, cachedStatsMap, userSettings] = await Promise.all([
    deps.getShowSettingsMapFn(userId, showIds),
    deps.getShowEpisodeStatsMapFn(showIds),
    deps.getUserSettingsFn(userId),
  ]);
  const mode = userSettings?.randomizationMode || DEFAULT_RANDOMIZATION_MODE;
  const loadedShows = new Map();
  const unavailableShows = new Set();

  async function loadShow(show) {
    if (!loadedShows.has(show.id)) {
      const meta = await deps.fetchMetaFn('series', show.id);
      loadedShows.set(show.id, meta?.meta
        ? { meta, inventory: buildEpisodeInventory(meta, now) }
        : null);
    }
    return loadedShows.get(show.id);
  }

  async function saveStats(show, inventory) {
    const stats = buildStatsPayload(show.id, inventory, () => now);
    await deps.upsertShowEpisodeStatsFn(show.id, stats);
    cachedStatsMap.set(show.id, stats);
  }

  // Refresh before weighting, including zero-count shows which could never be picked.
  const staleShows = showPool.filter((show) =>
    isStatsStale(cachedStatsMap.get(show.id), now, deps.statsTtlMs));
  await mapWithConcurrency(staleShows, SHOW_STATS_BUILD_CONCURRENCY, async (show) => {
    const loaded = await loadShow(show);
    if (!loaded) {
      unavailableShows.add(show.id);
      return;
    }
    await saveStats(show, loaded.inventory);
  });

  let candidates = showPool.filter((show) => !unavailableShows.has(show.id));
  while (candidates.length > 0) {
    const showsWithCounts = candidates.map((show) => ({
      show,
      settings: settingsMap.get(show.id) || { enabledSeasons: [] },
      eligibleCount: getEligibleEpisodeCountFromStats(
        cachedStatsMap.get(show.id),
        settingsMap.get(show.id)?.enabledSeasons || [],
      ),
    })).filter((item) => item.eligibleCount > 0);

    if (showsWithCounts.length === 0) return null;

    const chosenShow = mode === 'show'
      ? showsWithCounts[deps.rngInt(showsWithCounts.length)]
      : pickWeightedShow(showsWithCounts, deps.rngInt);
    const loaded = await loadShow(chosenShow.show);
    if (!loaded) {
      candidates = candidates.filter((show) => show.id !== chosenShow.show.id);
      continue;
    }

    const eligibleEpisodes = getEligibleEpisodesForShow(
      loaded.inventory,
      chosenShow.settings.enabledSeasons || [],
    );
    if (eligibleEpisodes.length !== chosenShow.eligibleCount) {
      // Correct the weights and draw again. Each show's metadata is fetched only once
      // per selection, so mismatches converge instead of exhausting a fixed retry count.
      await saveStats(chosenShow.show, loaded.inventory);
      continue;
    }

    const picked = pickEpisodeFromEligibleEpisodes(eligibleEpisodes, deps.rngInt);
    return {
      seriesMeta: loaded.meta,
      episodeId: picked.id,
      season: picked.season,
      episode: picked.episode,
      video: picked.video,
      show: chosenShow.show,
    };
  }
  return null;
}

/**
 * Pick a random episode from the user's shows
 */
async function pickSmartRandomEpisode(userId, userShows, targetShowId = null, options = {}) {
  if (!Array.isArray(userShows) || userShows.length === 0) return null;

  const showPool = targetShowId
    ? userShows.filter((show) => show.id === targetShowId)
    : userShows;

  if (showPool.length === 0) return null;

  if (targetShowId) {
    return pickEpisodeFromShow(userId, showPool[0], options);
  }

  return pickAcrossAllShows(userId, showPool, options);
}

async function getShowEpisodeStatsSnapshot(showId, options = {}) {
  return getOrRefreshShowEpisodeStats(showId, {
    ...options,
    refreshStale: true,
  });
}

/**
 * Get available seasons for filtering UI
 */
async function getAvailableSeasons(showId, options = {}) {
  const stats = await getShowEpisodeStatsSnapshot(showId, options);
  return stats && Array.isArray(stats.availableSeasons)
    ? stats.availableSeasons
    : [];
}

/**
 * Get episode count per season for a show
 */
async function getSeasonEpisodeCounts(showId, options = {}) {
  const stats = await getShowEpisodeStatsSnapshot(showId, options);
  return (stats && stats.seasonCounts) || {};
}

module.exports = {
  SHOW_STATS_TTL_MS,
  pickSmartRandomEpisode,
  pickEpisodeFromShow,
  refreshShowEpisodeStats,
  getShowEpisodeStatsSnapshot,
  getAvailableSeasons,
  getSeasonEpisodeCounts,
  __private: {
    buildEpisodeInventory,
    getEligibleEpisodesForShow,
    getEligibleEpisodeCountFromStats,
    pickWeightedShow,
    pickEpisodeFromEligibleEpisodes,
    isStatsStale,
    buildStatsPayload,
  },
};
