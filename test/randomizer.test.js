const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHOW_STATS_TTL_MS,
  pickSmartRandomEpisode,
  pickEpisodeFromShow,
  getShowEpisodeStatsSnapshot,
  __private,
} = require('../services/randomizer');

const NOW = new Date('2026-10-03T12:00:00Z');
const video = (season, episode, extra = {}) => ({ season, episode, ...extra });
const meta = (id, videos) => ({ meta: { id, name: id, videos } });

function statsFor(series, updatedAt = NOW) {
  return __private.buildStatsPayload(
    series.meta.id, __private.buildEpisodeInventory(series, updatedAt), () => updatedAt,
  );
}

function fixture({ metas, stats = new Map(), settings = new Map(), mode = 'episode', rngInt = () => 0 }) {
  const fetches = [];
  const writes = [];
  const options = {
    fetchMetaFn: async (type, id) => {
      assert.equal(type, 'series');
      fetches.push(id);
      return metas[id] || null;
    },
    getUserSettingsFn: async () => ({ randomizationMode: mode }),
    getShowSettingsFn: async (userId, id) => settings.get(id),
    getShowSettingsMapFn: async () => settings,
    getShowEpisodeStatsFn: async (id) => stats.get(id),
    getShowEpisodeStatsMapFn: async () => new Map(stats),
    upsertShowEpisodeStatsFn: async (id, value) => {
      writes.push(id);
      stats.set(id, value);
      return value;
    },
    nowFn: () => NOW,
    rngInt,
  };
  return { options, stats, fetches, writes };
}

test('inventory normalizes and deduplicates regular episodes', () => {
  const inventory = __private.buildEpisodeInventory(meta('tt1', [
    video(1, 1, { id: 'pilot-a' }),
    video(1, 1, { id: 'pilot-b' }),
    { id: 'tt1:2:3', name: 'Parsed episode' },
    video(0, 0),
  ]), NOW);
  assert.equal(inventory.totalEpisodes, 2);
  assert.deepEqual(inventory.availableSeasons, [1, 2]);
  assert.deepEqual(inventory.seasonCounts, { 1: 1, 2: 1 });
  assert.deepEqual(inventory.episodes.map((episode) => episode.id), ['tt1:1:1', 'tt1:2:3']);
});

test('future dates are excluded; unknown dates stay eligible and upcoming seasons remain visible', () => {
  const inventory = __private.buildEpisodeInventory(meta('tt1', [
    video(1, 1, { released: '2026-10-03T11:59:59Z' }),
    video(1, 2, { released: NOW.toISOString() }),
    video(1, 3),
    video(1, 4, { released: 'unknown' }),
    video(2, 1, { released: '2026-10-04T00:00:00Z' }),
    video(2, 2, { firstAired: '2026-10-03T13:00:00Z' }),
    video(2, 3, { released: 'unknown', firstAired: '2026-10-05T00:00:00Z' }),
  ]), NOW);
  assert.deepEqual(inventory.episodes.map((episode) => episode.id), [
    'tt1:1:1', 'tt1:1:2', 'tt1:1:3', 'tt1:1:4',
  ]);
  assert.deepEqual(inventory.availableSeasons, [1, 2]);
  assert.deepEqual(inventory.seasonCounts, { 1: 4, 2: 0 });
  assert.equal(inventory.nextReleaseAt.toISOString(), '2026-10-03T13:00:00.000Z');
});

test('a future-only regular inventory stays empty instead of falling back to future episodes or specials', () => {
  const inventory = __private.buildEpisodeInventory(meta('tt1', [
    video(1, 1, { released: '2099-01-01' }),
    video(0, 1, { released: '2020-01-01' }),
  ]), NOW);
  assert.deepEqual(inventory.episodes, []);
  assert.deepEqual(inventory.seasonCounts, { 1: 0 });
});

test('season filters agree with cached counts and never widen an empty selection', () => {
  const inventory = __private.buildEpisodeInventory(meta('tt1', [
    video(1, 1), video(1, 2), video(2, 1),
  ]), NOW);
  for (const [seasons, expected] of [[[], 3], [[1], 2], [[2], 1], [[9], 0], [['1', 1], 2]]) {
    assert.equal(__private.getEligibleEpisodesForShow(inventory, seasons).length, expected);
    assert.equal(__private.getEligibleEpisodeCountFromStats(inventory, seasons), expected);
  }
});

test('cache expiry handles old schemas, zero counts, TTL boundaries and newly aired episodes', () => {
  const empty = statsFor(meta('tt1', []));
  assert.equal(__private.isStatsStale(empty, NOW), false);
  assert.equal(__private.isStatsStale({ ...empty, eligibilityVersion: undefined }, NOW), true);
  assert.equal(__private.isStatsStale({ ...empty, updatedAt: 'invalid' }, NOW), true);
  assert.equal(__private.isStatsStale({
    ...empty, updatedAt: new Date(NOW.getTime() - SHOW_STATS_TTL_MS),
  }, NOW), true);
  assert.equal(__private.isStatsStale({ ...empty, nextReleaseAt: NOW.toISOString() }, NOW), true);
  assert.equal(__private.isStatsStale({ ...empty, nextReleaseAt: '2099-01-01' }, NOW), false);
});

test('both modes give exact expected probabilities for differently sized shows', async () => {
  const metas = {
    ttA: meta('ttA', [video(1, 1), video(1, 2)]),
    ttB: meta('ttB', Array.from({ length: 8 }, (_, i) => video(1, i + 1))),
  };
  for (const mode of ['episode', 'show']) {
    const counts = { ttA: 0, ttB: 0 };
    const slots = mode === 'episode' ? 10 : 2;
    for (let slot = 0; slot < slots; slot += 1) {
      let draw = 0;
      const { options } = fixture({
        metas, mode,
        stats: new Map(Object.entries(metas).map(([id, series]) => [id, statsFor(series)])),
        rngInt: (max) => {
          if (draw++ === 0) {
            assert.equal(max, slots);
            return slot;
          }
          return 0;
        },
      });
      const result = await pickSmartRandomEpisode('user', [{ id: 'ttA' }, { id: 'ttB' }], null, options);
      counts[result.show.id] += 1;
    }
    assert.deepEqual(counts, mode === 'episode' ? { ttA: 2, ttB: 8 } : { ttA: 1, ttB: 1 });
  }
});

test('users without a saved mode keep episode weighting; refreshed metadata is reused', async () => {
  const metas = {
    ttA: meta('ttA', [video(1, 1), video(1, 2)]),
    ttB: meta('ttB', [video(1, 1)]),
  };
  const draws = [2, 0];
  const f = fixture({ metas, rngInt: () => draws.shift() });
  f.options.getUserSettingsFn = async () => null;
  const result = await pickSmartRandomEpisode('user', [{ id: 'ttA' }, { id: 'ttB' }], null, f.options);
  assert.equal(result.show.id, 'ttB');
  assert.deepEqual(f.fetches, ['ttA', 'ttB']);
  assert.deepEqual(f.writes, ['ttA', 'ttB']);
});

test('both modes omit shows whose selected seasons have no eligible episodes', async () => {
  const metas = {
    ttA: meta('ttA', [video(1, 1)]),
    ttB: meta('ttB', [video(1, 1), video(2, 1, { released: '2099-01-01' })]),
    ttC: meta('ttC', [video(1, 1)]),
  };
  for (const mode of ['episode', 'show']) {
    const f = fixture({
      metas, mode,
      settings: new Map([['ttA', { enabledSeasons: [9] }], ['ttB', { enabledSeasons: [2] }]]),
    });
    const result = await pickSmartRandomEpisode('user', Object.keys(metas).map((id) => ({ id })), null, f.options);
    assert.equal(result.episodeId, 'ttC:1:1');
  }
});

test('stale zero-count shows are refreshed before selection and re-enter the pool', async () => {
  const old = new Date(NOW.getTime() - SHOW_STATS_TTL_MS);
  const f = fixture({
    metas: { ttA: meta('ttA', [video(1, 1)]) },
    stats: new Map([['ttA', statsFor(meta('ttA', []), old)]]),
  });
  const result = await pickSmartRandomEpisode('user', [{ id: 'ttA' }], null, f.options);
  assert.equal(result.episodeId, 'ttA:1:1');
  assert.equal(f.stats.get('ttA').totalEpisodes, 1);
  assert.deepEqual(f.fetches, ['ttA']);
});

test('stale positive counts refresh before they skew the episode weighting', async () => {
  const metas = {
    ttA: meta('ttA', [video(1, 1)]),
    ttB: meta('ttB', [video(1, 1)]),
  };
  let draw = 0;
  const f = fixture({
    metas,
    stats: new Map([
      ['ttA', statsFor(meta('ttA', [video(1, 1), video(1, 2)]), new Date('2020-01-01'))],
      ['ttB', statsFor(metas.ttB)],
    ]),
    rngInt: (max) => {
      if (draw++ === 0) { assert.equal(max, 2); return 1; }
      return 0;
    },
  });
  const result = await pickSmartRandomEpisode('user', [{ id: 'ttA' }, { id: 'ttB' }], null, f.options);
  assert.equal(result.show.id, 'ttB');
  assert.equal(f.stats.get('ttA').totalEpisodes, 1);
});

test('known air dates refresh empty caches without waiting for the TTL', async () => {
  const series = meta('ttA', [video(1, 1, { released: NOW.toISOString() })]);
  const f = fixture({
    metas: { ttA: series },
    stats: new Map([['ttA', statsFor(series, new Date(NOW.getTime() - 1000))]]),
  });
  assert.equal(f.stats.get('ttA').totalEpisodes, 0);
  const result = await pickSmartRandomEpisode('user', [{ id: 'ttA' }], null, f.options);
  assert.equal(result.episodeId, 'ttA:1:1');
  assert.equal(f.stats.get('ttA').nextReleaseAt, null);
});

test('pre-upgrade counts are rebuilt even when their timestamps are fresh', async () => {
  const f = fixture({
    metas: { ttA: meta('ttA', [video(1, 1, { released: '2099-01-01' })]) },
    stats: new Map([['ttA', { totalEpisodes: 1, seasonCounts: { 1: 1 }, updatedAt: NOW }]]),
  });
  assert.equal(await pickSmartRandomEpisode('user', [{ id: 'ttA' }], null, f.options), null);
  assert.equal(f.stats.get('ttA').totalEpisodes, 0);
});

test('multiple live-count mismatches converge without discarding a valid pool', async () => {
  const metas = {
    ttA: meta('ttA', [video(1, 1)]),
    ttB: meta('ttB', [video(1, 1)]),
  };
  const draws = [0, 1, 0, 0];
  const f = fixture({
    metas,
    stats: new Map(Object.keys(metas).map((id) => [
      id, statsFor(meta(id, [video(1, 1), video(1, 2)])),
    ])),
    rngInt: () => draws.shift(),
  });
  const result = await pickSmartRandomEpisode('user', [{ id: 'ttA' }, { id: 'ttB' }], null, f.options);
  assert.equal(result.episodeId, 'ttA:1:1');
  assert.deepEqual(f.fetches, ['ttA', 'ttB']);
  assert.deepEqual(f.writes, ['ttA', 'ttB']);
});

test('metadata failures skip unavailable shows without overwriting their cached counts', async () => {
  const failedStats = statsFor(meta('ttA', [video(1, 1)]));
  const goodMeta = meta('ttC', [video(1, 1)]);
  const f = fixture({
    metas: { ttC: goodMeta },
    stats: new Map([
      ['ttA', failedStats],
      ['ttB', { ...failedStats, updatedAt: new Date('2020-01-01') }],
      ['ttC', statsFor(goodMeta)],
    ]),
  });
  const result = await pickSmartRandomEpisode('user', [{ id: 'ttA' }, { id: 'ttB' }, { id: 'ttC' }], null, f.options);
  assert.equal(result.episodeId, 'ttC:1:1');
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.fetches, ['ttB', 'ttA', 'ttC']);
  assert.equal(f.stats.get('ttA'), failedStats);
});

test('specific-show picks respect filters and air dates without loading the global mode', async () => {
  const series = meta('ttA', [video(1, 1), video(2, 1, { released: '2099-01-01' })]);
  for (const seasons of [[9], [2]]) {
    const f = fixture({ metas: { ttA: series }, settings: new Map([['ttA', { enabledSeasons: seasons }]]) });
    f.options.getUserSettingsFn = async () => { throw new Error('Global mode is not needed'); };
    assert.equal(await pickSmartRandomEpisode('user', [{ id: 'ttA' }], 'ttA', f.options), null);
  }
  const f = fixture({ metas: { ttA: series } });
  assert.equal((await pickEpisodeFromShow('user', { id: 'ttA' }, f.options)).episodeId, 'ttA:1:1');
});

test('season settings snapshots refresh expired empty inventories', async () => {
  const f = fixture({
    metas: { ttA: meta('ttA', [video(3, 1)]) },
    stats: new Map([['ttA', statsFor(meta('ttA', []), new Date('2020-01-01'))]]),
  });
  const snapshot = await getShowEpisodeStatsSnapshot('ttA', f.options);
  assert.deepEqual(snapshot.availableSeasons, [3]);
  assert.deepEqual(snapshot.seasonCounts, { 3: 1 });
});
