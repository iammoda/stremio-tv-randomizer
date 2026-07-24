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
      fetchMetaFn: async () =>
        makeSeriesMeta('ttC', [makeVideo(1, 1), makeVideo(2, 1)]),
      getShowSettingsFn: async () => ({ enabledSeasons: [9] }),
      rngInt: () => 1,
    },
  );

  assert.equal(result.episodeId, 'ttC:2:1');
  assert.equal(result.season, 2);
});
