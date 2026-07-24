const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickSmartRandomEpisode,
  pickEpisodeFromShow,
  __private,
} = require('../services/randomizer');

function makeSeriesMeta(showId, videos) {
  return {
    meta: {
      id: showId,
      name: `Show ${showId}`,
      videos,
    },
  };
}

function makeVideo(season, episode, extra = {}) {
  return {
    id: `${extra.showId || 'raw'}-${season}-${episode}-${extra.suffix || ''}`,
    season,
    episode,
    name: extra.name || `Episode ${episode}`,
    ...extra,
  };
}

// Shared no-op deps so unit tests never touch the real database
function noCooldownDeps() {
  return {
    getUserSettingsFn: async () => ({ cooldownDays: 0 }),
    getRecentlyWatchedFn: async () => [],
  };
}

test('buildEpisodeInventory normalizes, deduplicates, and prefers streamable episodes', () => {
  const meta = makeSeriesMeta('tt1000001', [
    makeVideo(1, 1, { suffix: 'a', name: 'Pilot' }),
    makeVideo(1, 1, { suffix: 'b', name: 'Pilot duplicate' }),
    { id: 'tt1000001:2:3', name: 'Fallback parsed episode' },
    { id: 'special-1', season: 0, episode: 0, name: 'Special' },
  ]);

  const inventory = __private.buildEpisodeInventory(meta);

  assert.equal(inventory.totalEpisodes, 2);
  assert.deepEqual(inventory.availableSeasons, [1, 2]);
  assert.deepEqual(inventory.seasonCounts, { 1: 1, 2: 1 });
  assert.deepEqual(
    inventory.episodes.map((episode) => episode.id),
    ['tt1000001:1:1', 'tt1000001:2:3'],
  );
});

test('getEligibleEpisodeCountFromStats falls back to total episodes when filters remove everything', () => {
  const stats = {
    totalEpisodes: 5,
    seasonCounts: {
      1: 2,
      2: 3,
    },
  };

  assert.equal(__private.getEligibleEpisodeCountFromStats(stats, []), 5);
  assert.equal(__private.getEligibleEpisodeCountFromStats(stats, [2]), 3);
  assert.equal(__private.getEligibleEpisodeCountFromStats(stats, [3]), 5);
});

test('pickWeightedShow maps global episode slots to the correct show weights', () => {
  const shows = [
    { show: { id: 'ttA' }, eligibleCount: 2 },
    { show: { id: 'ttB' }, eligibleCount: 8 },
  ];

  const counts = { ttA: 0, ttB: 0 };

  for (let slot = 0; slot < 10; slot += 1) {
    const picked = __private.pickWeightedShow(shows, () => slot);
    counts[picked.show.id] += 1;
  }

  assert.deepEqual(counts, { ttA: 2, ttB: 8 });
});

test('pickSmartRandomEpisode builds missing stats and keeps equal episode weighting across shows', async () => {
  const metas = {
    ttA: makeSeriesMeta('ttA', [makeVideo(1, 1), makeVideo(1, 2)]),
    ttB: makeSeriesMeta('ttB', [makeVideo(1, 1)]),
  };
  const statsStore = new Map();
  const fetchCalls = [];

  const result = await pickSmartRandomEpisode(
    'user-1',
    [{ id: 'ttA' }, { id: 'ttB' }],
    null,
    {
      ...noCooldownDeps(),
      fetchMetaFn: async (type, id) => {
        fetchCalls.push(id);
        return metas[id];
      },
      getShowSettingsMapFn: async () => new Map(),
      getShowEpisodeStatsMapFn: async () => new Map(statsStore),
      upsertShowEpisodeStatsFn: async (showId, stats) => {
        statsStore.set(showId, stats);
        return stats;
      },
      rngInt: (() => {
        const values = [2, 0];
        return () => values.shift();
      })(),
    },
  );

  assert.equal(result.show.id, 'ttB');
  assert.equal(result.episodeId, 'ttB:1:1');
  assert.equal(statsStore.get('ttA').totalEpisodes, 2);
  assert.equal(statsStore.get('ttB').totalEpisodes, 1);
  assert.deepEqual(fetchCalls, ['ttA', 'ttB', 'ttB']);
});

test('pickSmartRandomEpisode refreshes stale chosen-show stats and retries selection once', async () => {
  const statsStore = new Map([
    [
      'ttA',
      {
        showId: 'ttA',
        totalEpisodes: 2,
        seasonCounts: { 1: 2 },
        availableSeasons: [1],
        updatedAt: new Date('2026-03-18T00:00:00Z'),
      },
    ],
    [
      'ttB',
      {
        showId: 'ttB',
        totalEpisodes: 1,
        seasonCounts: { 1: 1 },
        availableSeasons: [1],
        updatedAt: new Date('2026-03-18T00:00:00Z'),
      },
    ],
  ]);

  const metas = {
    ttA: makeSeriesMeta('ttA', [makeVideo(1, 1)]),
    ttB: makeSeriesMeta('ttB', [makeVideo(1, 1)]),
  };

  const result = await pickSmartRandomEpisode(
    'user-2',
    [{ id: 'ttA' }, { id: 'ttB' }],
    null,
    {
      ...noCooldownDeps(),
      backgroundRefresh: false,
      fetchMetaFn: async (type, id) => metas[id],
      getShowSettingsMapFn: async () => new Map(),
      getShowEpisodeStatsMapFn: async () => new Map(statsStore),
      upsertShowEpisodeStatsFn: async (showId, stats) => {
        statsStore.set(showId, stats);
        return stats;
      },
      rngInt: (() => {
        const values = [1, 1, 0];
        return () => values.shift();
      })(),
    },
  );

  assert.equal(result.show.id, 'ttB');
  assert.equal(result.episodeId, 'ttB:1:1');
  assert.equal(statsStore.get('ttA').totalEpisodes, 1);
});

test('pickEpisodeFromShow falls back to all episodes if season filters remove everything', async () => {
  const result = await pickEpisodeFromShow(
    'user-3',
    { id: 'ttC' },
    {
      ...noCooldownDeps(),
      fetchMetaFn: async () =>
        makeSeriesMeta('ttC', [makeVideo(1, 1), makeVideo(2, 1)]),
      getShowSettingsFn: async () => ({ enabledSeasons: [9] }),
      rngInt: () => 1,
    },
  );

  assert.equal(result.episodeId, 'ttC:2:1');
  assert.equal(result.season, 2);
});

test('pickEpisodeFromShow excludes episodes watched within the cooldown window', async () => {
  const result = await pickEpisodeFromShow(
    'user-4',
    { id: 'ttD' },
    {
      fetchMetaFn: async () =>
        makeSeriesMeta('ttD', [makeVideo(1, 1), makeVideo(1, 2)]),
      getShowSettingsFn: async () => ({ enabledSeasons: [] }),
      getUserSettingsFn: async () => ({ cooldownDays: 30 }),
      getRecentlyWatchedFn: async () => [
        { showId: 'ttD', episodeId: 'ttD:1:1', season: 1, episode: 1 },
      ],
      rngInt: () => 0,
    },
  );

  // rng 0 would normally pick ttD:1:1, but it's on cooldown
  assert.equal(result.episodeId, 'ttD:1:2');
});

test('pickEpisodeFromShow allows repeats when every episode is on cooldown', async () => {
  const result = await pickEpisodeFromShow(
    'user-5',
    { id: 'ttE' },
    {
      fetchMetaFn: async () =>
        makeSeriesMeta('ttE', [makeVideo(1, 1), makeVideo(1, 2)]),
      getShowSettingsFn: async () => ({ enabledSeasons: [] }),
      getUserSettingsFn: async () => ({ cooldownDays: 30 }),
      getRecentlyWatchedFn: async () => [
        { showId: 'ttE', episodeId: 'ttE:1:1', season: 1, episode: 1 },
        { showId: 'ttE', episodeId: 'ttE:1:2', season: 1, episode: 2 },
      ],
      rngInt: () => 0,
    },
  );

  assert.ok(result, 'should fall back to repeats instead of returning nothing');
  assert.equal(result.episodeId, 'ttE:1:1');
});

test('pickSmartRandomEpisode subtracts watched episodes from show weights and excludes them from the pick', async () => {
  const now = new Date();
  const statsStore = new Map([
    [
      'ttA',
      {
        showId: 'ttA',
        totalEpisodes: 2,
        seasonCounts: { 1: 2 },
        availableSeasons: [1],
        updatedAt: now,
      },
    ],
    [
      'ttB',
      {
        showId: 'ttB',
        totalEpisodes: 1,
        seasonCounts: { 1: 1 },
        availableSeasons: [1],
        updatedAt: now,
      },
    ],
  ]);

  const metas = {
    ttA: makeSeriesMeta('ttA', [makeVideo(1, 1), makeVideo(1, 2)]),
    ttB: makeSeriesMeta('ttB', [makeVideo(1, 1)]),
  };

  const rngCalls = [];
  const result = await pickSmartRandomEpisode(
    'user-6',
    [{ id: 'ttA' }, { id: 'ttB' }],
    null,
    {
      backgroundRefresh: false,
      fetchMetaFn: async (type, id) => metas[id],
      getShowSettingsMapFn: async () => new Map(),
      getShowEpisodeStatsMapFn: async () => new Map(statsStore),
      upsertShowEpisodeStatsFn: async (showId, stats) => {
        statsStore.set(showId, stats);
        return stats;
      },
      getUserSettingsFn: async () => ({ cooldownDays: 30 }),
      getRecentlyWatchedFn: async () => [
        { showId: 'ttA', episodeId: 'ttA:1:1', season: 1, episode: 1 },
      ],
      rngInt: (maxExclusive) => {
        rngCalls.push(maxExclusive);
        return 0;
      },
    },
  );

  // Weights after exclusion: ttA=1 (2-1 watched), ttB=1 -> total 2, not 3
  assert.equal(rngCalls[0], 2);
  assert.equal(result.show.id, 'ttA');
  // The only unwatched ttA episode
  assert.equal(result.episodeId, 'ttA:1:2');
});

test('pickSmartRandomEpisode ignores watch history when the entire library is on cooldown', async () => {
  const now = new Date();
  const statsStore = new Map([
    [
      'ttA',
      {
        showId: 'ttA',
        totalEpisodes: 1,
        seasonCounts: { 1: 1 },
        availableSeasons: [1],
        updatedAt: now,
      },
    ],
  ]);

  const result = await pickSmartRandomEpisode(
    'user-7',
    [{ id: 'ttA' }],
    null,
    {
      backgroundRefresh: false,
      fetchMetaFn: async () => makeSeriesMeta('ttA', [makeVideo(1, 1)]),
      getShowSettingsMapFn: async () => new Map(),
      getShowEpisodeStatsMapFn: async () => new Map(statsStore),
      upsertShowEpisodeStatsFn: async () => null,
      getUserSettingsFn: async () => ({ cooldownDays: 30 }),
      getRecentlyWatchedFn: async () => [
        { showId: 'ttA', episodeId: 'ttA:1:1', season: 1, episode: 1 },
      ],
      rngInt: () => 0,
    },
  );

  assert.ok(result, 'should fall back to allowing repeats');
  assert.equal(result.episodeId, 'ttA:1:1');
});

test('pickSmartRandomEpisode refreshes stale stats in the background without blocking the pick', async () => {
  const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const statsStore = new Map([
    [
      'ttA',
      {
        showId: 'ttA',
        totalEpisodes: 1,
        seasonCounts: { 1: 1 },
        availableSeasons: [1],
        updatedAt: staleDate,
      },
    ],
  ]);
  const upserted = [];

  const result = await pickSmartRandomEpisode(
    'user-8',
    [{ id: 'ttA' }],
    null,
    {
      ...noCooldownDeps(),
      fetchMetaFn: async () => makeSeriesMeta('ttA', [makeVideo(1, 1)]),
      getShowSettingsMapFn: async () => new Map(),
      getShowEpisodeStatsMapFn: async () => new Map(statsStore),
      upsertShowEpisodeStatsFn: async (showId, stats) => {
        upserted.push(showId);
        statsStore.set(showId, stats);
        return stats;
      },
      rngInt: () => 0,
    },
  );

  assert.equal(result.episodeId, 'ttA:1:1');

  // Background refresh is fire-and-forget; give the microtask queue a moment
  for (let i = 0; i < 20 && upserted.length === 0; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(
    upserted.includes('ttA'),
    'stale stats should be refreshed in the background',
  );
});

test('resolveWatchedContext is inactive when cooldown is disabled', async () => {
  let watchedQueried = false;
  const context = await __private.resolveWatchedContext('user-9', {
    getUserSettingsFn: async () => ({ cooldownDays: 0 }),
    getRecentlyWatchedFn: async () => {
      watchedQueried = true;
      return [];
    },
    nowFn: () => new Date(),
  });

  assert.equal(context.active, false);
  assert.equal(watchedQueried, false, 'should not query watch history at all');
});

test('countWatchedInSeasons respects the effective season filter', () => {
  const entry = {
    episodeIds: new Set(['tt1:1:1', 'tt1:2:1', 'tt1:2:2']),
    seasonCounts: { 1: 1, 2: 2 },
  };

  assert.equal(__private.countWatchedInSeasons(entry, null), 3);
  assert.equal(__private.countWatchedInSeasons(entry, [2]), 2);
  assert.equal(__private.countWatchedInSeasons(entry, [3]), 0);
  assert.equal(__private.countWatchedInSeasons(null, [1]), 0);
});
