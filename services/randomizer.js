const { randomInt } = require('crypto');
const { fetchMeta } = require('./cinemeta');
const {
  getShowSettings,
  getShowSettingsMap,
  getShowEpisodeStats,
  getShowEpisodeStatsMap,
  upsertShowEpisodeStats,
  getUserSettings,
  getRecentlyWatchedEpisodes,
} = require('./db');
const { normalizeEpisode } = require('../utils/episode');

const SHOW_STATS_TTL_MS = 24 * 60 * 60 * 1000;
const SHOW_STATS_BUILD_CONCURRENCY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    getShowEpisodeStatsFn: options.getShowEpisodeStatsFn || getShowEpisodeStats,
    getShowEpisodeStatsMapFn:
      options.getShowEpisodeStatsMapFn || getShowEpisodeStatsMap,
    upsertShowEpisodeStatsFn:
      options.upsertShowEpisodeStatsFn || upsertShowEpisodeStats,
    getUserSettingsFn: options.getUserSettingsFn || getUserSettings,
    getRecentlyWatchedFn:
      options.getRecentlyWatchedFn || getRecentlyWatchedEpisodes,
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
function buildEpisodeInventory(seriesMeta) {
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
  const episodes = streamable.length > 0 ? streamable : deduped;

  const seasonCounts = {};
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
  };
}

/**
 * Filter an episode inventory by enabled seasons, falling back to all episodes
 */
function getEligibleEpisodesForShow(inventory, enabledSeasons = []) {
  const episodes = Array.isArray(inventory && inventory.episodes)
    ? inventory.episodes
    : [];

  if (episodes.length === 0) return [];
  if (!Array.isArray(enabledSeasons) || enabledSeasons.length === 0) {
    return episodes;
  }

  const filtered = episodes.filter((item) => enabledSeasons.includes(item.season));
  return filtered.length > 0 ? filtered : episodes;
}

/**
 * Resolve the season filter that will actually be applied for a show.
 * Returns null when no filter applies (none configured, or the configured
 * filter matches nothing and falls back to all episodes).
 */
function getEffectiveEnabledSeasons(stats, enabledSeasons = []) {
  if (!Array.isArray(enabledSeasons) || enabledSeasons.length === 0) {
    return null;
  }
  const seasonCounts = (stats && stats.seasonCounts) || {};
  const filteredCount = enabledSeasons.reduce(
    (sum, season) => sum + (seasonCounts[String(season)] || 0),
    0,
  );
  return filteredCount > 0 ? enabledSeasons : null;
}

/**
 * Compute how many episodes remain eligible after applying season filters
 */
function getEligibleEpisodeCountFromStats(stats, enabledSeasons = []) {
  if (!stats || !Number.isFinite(stats.totalEpisodes) || stats.totalEpisodes <= 0) {
    return 0;
  }

  const effectiveSeasons = getEffectiveEnabledSeasons(stats, enabledSeasons);
  if (!effectiveSeasons) {
    return stats.totalEpisodes;
  }

  const seasonCounts = stats.seasonCounts || {};
  return effectiveSeasons.reduce((sum, season) => {
    return sum + (seasonCounts[String(season)] || 0);
  }, 0);
}

function isStatsStale(stats, now = defaultNow(), statsTtlMs = SHOW_STATS_TTL_MS) {
  if (!stats || !stats.updatedAt) return true;
  const updatedAt = new Date(stats.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return true;
  return now.getTime() - updatedAt.getTime() > statsTtlMs;
}

function buildStatsPayload(showId, inventory, nowFn = defaultNow) {
  return {
    showId,
    seasonCounts: inventory.seasonCounts,
    availableSeasons: inventory.availableSeasons,
    totalEpisodes: inventory.totalEpisodes,
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

  const inventory = buildEpisodeInventory(seriesMeta);
  const payload = buildStatsPayload(showId, inventory, deps.nowFn);
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

async function populateMissingShowStats(shows, options = {}) {
  if (!Array.isArray(shows) || shows.length === 0) return new Map();

  const results = await mapWithConcurrency(
    shows,
    SHOW_STATS_BUILD_CONCURRENCY,
    async (show) => {
      const stats = await refreshShowEpisodeStats(show.id, options);
      return [show.id, stats];
    },
  );

  return new Map(results.filter((entry) => entry[1]));
}

// Guard so overlapping requests don't refresh the same show repeatedly
const backgroundRefreshInFlight = new Set();

/**
 * Opportunistically refresh stale cached stats without blocking the pick.
 * Keeps availableSeasons/episode counts current for long-running shows.
 */
function scheduleStaleStatsRefresh(shows, options = {}) {
  const candidates = (shows || []).filter(
    (show) => show && show.id && !backgroundRefreshInFlight.has(show.id),
  );
  if (candidates.length === 0) return Promise.resolve();

  for (const show of candidates) {
    backgroundRefreshInFlight.add(show.id);
  }

  return mapWithConcurrency(
    candidates,
    SHOW_STATS_BUILD_CONCURRENCY,
    async (show) => {
      try {
        await refreshShowEpisodeStats(show.id, options);
      } catch (error) {
        console.error('Background stats refresh failed:', show.id, error);
      } finally {
        backgroundRefreshInFlight.delete(show.id);
      }
    },
  );
}

/**
 * Load the user's watched-episode cooldown state.
 * Returns { active, byShow } where byShow maps showId to
 * { episodeIds: Set, seasonCounts: { [season]: count } }.
 */
async function resolveWatchedContext(userId, deps) {
  const inactive = { active: false, byShow: new Map() };
  if (!userId) return inactive;

  const settings = (await deps.getUserSettingsFn(userId)) || {};
  const cooldownDays = Number(settings.cooldownDays);
  if (!Number.isFinite(cooldownDays) || cooldownDays <= 0) {
    return inactive;
  }

  const since = new Date(deps.nowFn().getTime() - cooldownDays * DAY_MS);
  const watched = (await deps.getRecentlyWatchedFn(userId, since)) || [];

  const byShow = new Map();
  for (const row of watched) {
    if (!row || !row.showId || !row.episodeId) continue;
    let entry = byShow.get(row.showId);
    if (!entry) {
      entry = { episodeIds: new Set(), seasonCounts: {} };
      byShow.set(row.showId, entry);
    }
    if (entry.episodeIds.has(row.episodeId)) continue;
    entry.episodeIds.add(row.episodeId);
    const season = Number(row.season);
    const key = String(Number.isFinite(season) ? season : 0);
    entry.seasonCounts[key] = (entry.seasonCounts[key] || 0) + 1;
  }

  return { active: true, byShow };
}

/**
 * How many of a show's recently-watched episodes fall inside the
 * effective season filter (all of them when no filter applies).
 */
function countWatchedInSeasons(watchedEntry, effectiveSeasons) {
  if (!watchedEntry) return 0;
  if (!effectiveSeasons) return watchedEntry.episodeIds.size;
  return effectiveSeasons.reduce(
    (sum, season) => sum + (watchedEntry.seasonCounts[String(season)] || 0),
    0,
  );
}

/**
 * Remove recently-watched episodes from a pool, falling back to the full
 * pool when everything is on cooldown (repeats beat returning nothing).
 */
function excludeWatchedEpisodes(episodes, watchedEntry) {
  if (!watchedEntry || watchedEntry.episodeIds.size === 0) return episodes;
  const filtered = episodes.filter(
    (item) => !watchedEntry.episodeIds.has(item.id),
  );
  return filtered.length > 0 ? filtered : episodes;
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
  const [meta, watchedContext] = await Promise.all([
    deps.fetchMetaFn('series', show.id),
    options.watchedContext || resolveWatchedContext(userId, deps),
  ]);
  if (!meta || !meta.meta) return null;

  const settings =
    options.settings ||
    (await deps.getShowSettingsFn(userId, show.id)) ||
    { enabledSeasons: [] };
  const inventory = buildEpisodeInventory(meta);
  const seasonEligible = getEligibleEpisodesForShow(
    inventory,
    settings.enabledSeasons || [],
  );
  const eligibleEpisodes = watchedContext.active
    ? excludeWatchedEpisodes(seasonEligible, watchedContext.byShow.get(show.id))
    : seasonEligible;
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

async function pickAcrossAllShows(
  userId,
  showPool,
  options = {},
  retried = false,
  presetWatchedContext = null,
) {
  const deps = getDependencies(options);
  const showIds = showPool.map((show) => show.id);
  const [settingsMap, cachedStatsMap, watchedContext] = await Promise.all([
    deps.getShowSettingsMapFn(userId, showIds),
    deps.getShowEpisodeStatsMapFn(showIds),
    presetWatchedContext || resolveWatchedContext(userId, deps),
  ]);

  const missingShows = showPool.filter((show) => !cachedStatsMap.has(show.id));
  if (missingShows.length > 0) {
    const refreshedMap = await populateMissingShowStats(missingShows, options);
    for (const [showId, stats] of refreshedMap.entries()) {
      cachedStatsMap.set(showId, stats);
    }
  }

  // Keep long-running shows fresh without blocking this pick
  if (!retried && options.backgroundRefresh !== false) {
    const staleShows = showPool.filter((show) => {
      const stats = cachedStatsMap.get(show.id);
      return stats && isStatsStale(stats, deps.nowFn(), deps.statsTtlMs);
    });
    if (staleShows.length > 0) {
      scheduleStaleStatsRefresh(staleShows, options);
    }
  }

  const showsWithCounts = showPool.map((show) => {
    const settings = settingsMap.get(show.id) || { enabledSeasons: [] };
    const stats = cachedStatsMap.get(show.id);
    const effectiveSeasons = getEffectiveEnabledSeasons(
      stats,
      settings.enabledSeasons || [],
    );
    const statsEligibleCount = getEligibleEpisodeCountFromStats(
      stats,
      settings.enabledSeasons || [],
    );
    const watchedCount = watchedContext.active
      ? countWatchedInSeasons(watchedContext.byShow.get(show.id), effectiveSeasons)
      : 0;
    return {
      show,
      settings,
      cachedStats: stats,
      statsEligibleCount,
      availableCount: Math.max(0, statsEligibleCount - watchedCount),
    };
  });

  // Prefer unwatched episodes; if the whole library is on cooldown,
  // fall back to ignoring watch history rather than failing.
  let useWatchedExclusion = watchedContext.active;
  let candidates = showsWithCounts.filter((item) => item.availableCount > 0);
  if (candidates.length === 0) {
    useWatchedExclusion = false;
    candidates = showsWithCounts.filter((item) => item.statsEligibleCount > 0);
  }
  if (candidates.length === 0) return null;

  const weighted = candidates.map((item) => ({
    ...item,
    eligibleCount: useWatchedExclusion
      ? item.availableCount
      : item.statsEligibleCount,
  }));

  const chosenShow = pickWeightedShow(weighted, deps.rngInt);
  if (!chosenShow) return null;

  const liveMeta = await deps.fetchMetaFn('series', chosenShow.show.id);
  if (!liveMeta || !liveMeta.meta) {
    if (retried) return null;
    await refreshShowEpisodeStats(chosenShow.show.id, options);
    return pickAcrossAllShows(userId, showPool, options, true, watchedContext);
  }

  const inventory = buildEpisodeInventory(liveMeta);
  const seasonEligible = getEligibleEpisodesForShow(
    inventory,
    chosenShow.settings.enabledSeasons || [],
  );
  const liveCount = seasonEligible.length;

  if (liveCount === 0 || liveCount !== chosenShow.statsEligibleCount) {
    if (retried) return null;
    await refreshShowEpisodeStats(chosenShow.show.id, {
      ...options,
      seriesMeta: liveMeta,
    });
    return pickAcrossAllShows(userId, showPool, options, true, watchedContext);
  }

  const eligibleEpisodes = useWatchedExclusion
    ? excludeWatchedEpisodes(
        seasonEligible,
        watchedContext.byShow.get(chosenShow.show.id),
      )
    : seasonEligible;

  const picked = pickEpisodeFromEligibleEpisodes(eligibleEpisodes, deps.rngInt);
  if (!picked) return null;

  return {
    seriesMeta: liveMeta,
    episodeId: picked.id,
    season: picked.season,
    episode: picked.episode,
    video: picked.video,
    show: chosenShow.show,
  };
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

module.exports = {
  SHOW_STATS_TTL_MS,
  pickSmartRandomEpisode,
  pickEpisodeFromShow,
  refreshShowEpisodeStats,
  getShowEpisodeStatsSnapshot,
  __private: {
    buildEpisodeInventory,
    getEligibleEpisodesForShow,
    getEligibleEpisodeCountFromStats,
    getEffectiveEnabledSeasons,
    countWatchedInSeasons,
    excludeWatchedEpisodes,
    resolveWatchedContext,
    pickWeightedShow,
    pickEpisodeFromEligibleEpisodes,
    isStatsStale,
    buildStatsPayload,
  },
};
