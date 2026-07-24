const test = require('node:test');
const assert = require('node:assert/strict');

const {
  searchShows,
  getTvmazeShow,
  fetchTvmazeEpisodeSummary,
} = require('../services/tvmaze');

function fakeResponse(ok, payload, status = ok ? 200 : 500) {
  return { ok, status, json: async () => payload };
}

test('searchShows returns [] for non-OK responses', async () => {
  const result = await searchShows('breaking bad', async () =>
    fakeResponse(false, { error: 'server error' }),
  );
  assert.deepEqual(result, []);
});

test('searchShows returns [] for non-array payloads', async () => {
  const result = await searchShows('breaking bad', async () =>
    fakeResponse(true, { unexpected: true }),
  );
  assert.deepEqual(result, []);
});

test('searchShows maps results and drops entries without posters', async () => {
  const payload = [
    {
      show: {
        id: 1,
        name: 'Breaking Bad',
        externals: { imdb: 'tt0903747' },
        image: { medium: 'poster1.jpg' },
        premiered: '2008-01-20',
      },
    },
    {
      show: {
        id: 2,
        name: 'No IMDB Show',
        externals: {},
        image: { medium: 'poster2.jpg' },
        premiered: null,
      },
    },
    {
      show: {
        id: 3,
        name: 'No Poster Show',
        externals: { imdb: 'tt1' },
        image: null,
        premiered: '2010-01-01',
      },
    },
  ];

  const result = await searchShows('query', async () =>
    fakeResponse(true, payload),
  );

  assert.deepEqual(result, [
    { id: 'tt0903747', name: 'Breaking Bad', poster: 'poster1.jpg', year: '2008' },
    { id: 'tvmaze-2', name: 'No IMDB Show', poster: 'poster2.jpg', year: null },
  ]);
});

test('searchShows returns [] when fetch throws', async () => {
  const result = await searchShows('query', async () => {
    throw new Error('network down');
  });
  assert.deepEqual(result, []);
});

test('getTvmazeShow returns null for non-OK responses', async () => {
  const result = await getTvmazeShow('123', async () => fakeResponse(false, {}));
  assert.equal(result, null);
});

test('fetchTvmazeEpisodeSummary resolves and strips HTML from summaries', async () => {
  const summary = await fetchTvmazeEpisodeSummary(
    'tt9999901',
    1,
    2,
    async (url) => {
      if (url.includes('/lookup/shows')) {
        return fakeResponse(true, { id: 42 });
      }
      if (url.includes('/shows/42/episodebynumber')) {
        return fakeResponse(true, {
          summary: '<p>Walter &amp; Jesse cook.</p>',
        });
      }
      throw new Error(`unexpected url: ${url}`);
    },
  );

  assert.equal(summary, 'Walter & Jesse cook.');
});

test('fetchTvmazeEpisodeSummary returns empty string when show lookup fails', async () => {
  const summary = await fetchTvmazeEpisodeSummary(
    'tt9999902',
    1,
    2,
    async (url) => {
      if (url.includes('/lookup/shows')) {
        return fakeResponse(false, {}, 404);
      }
      throw new Error(`unexpected url: ${url}`);
    },
  );

  assert.equal(summary, '');
});
