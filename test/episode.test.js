const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseEpisodeId,
  formatEpisodeLabel,
  buildEpisodeId,
  findEpisodeVideo,
  buildEpisodeMeta,
} = require('../utils/episode');

test('parseEpisodeId parses canonical episode IDs', () => {
  assert.deepEqual(parseEpisodeId('tt0944947:1:5'), {
    showId: 'tt0944947',
    season: 1,
    episode: 5,
  });
  assert.deepEqual(parseEpisodeId('tt123:10:22'), {
    showId: 'tt123',
    season: 10,
    episode: 22,
  });
});

test('parseEpisodeId rejects malformed IDs', () => {
  assert.equal(parseEpisodeId('tt0944947'), null);
  assert.equal(parseEpisodeId('random-episode-action'), null);
  assert.equal(parseEpisodeId('abc:1:2'), null);
  assert.equal(parseEpisodeId('tt123:x:2'), null);
  assert.equal(parseEpisodeId('tt123:1'), null);
  assert.equal(parseEpisodeId(''), null);
  assert.equal(parseEpisodeId(null), null);
});

test('formatEpisodeLabel pads season and episode numbers', () => {
  assert.equal(formatEpisodeLabel(1, 5), 'S01E05');
  assert.equal(formatEpisodeLabel(12, 103), 'S12E103');
  assert.equal(formatEpisodeLabel(NaN, undefined), 'S00E00');
});

test('buildEpisodeId prefers a canonical fallback and builds from parts otherwise', () => {
  assert.equal(buildEpisodeId('tt1', 2, 3, 'tt1:2:3'), 'tt1:2:3');
  assert.equal(buildEpisodeId('tt1', 2, 3, 'not-canonical'), 'tt1:2:3');
  assert.equal(buildEpisodeId('tt1', 2, 3), 'tt1:2:3');
});

test('findEpisodeVideo matches by season and episode (or number)', () => {
  const meta = {
    meta: {
      videos: [
        { id: 'a', season: 1, episode: 1 },
        { id: 'b', season: 2, number: 4 },
      ],
    },
  };

  assert.equal(findEpisodeVideo(meta, 1, 1).id, 'a');
  assert.equal(findEpisodeVideo(meta, 2, 4).id, 'b');
  assert.equal(findEpisodeVideo(meta, 3, 1), undefined);
  assert.equal(findEpisodeVideo(null, 1, 1), null);
});

test('buildEpisodeMeta returns canonical ID, display title, and defaultVideoId', () => {
  const seriesMeta = {
    meta: {
      id: 'tt0944947',
      name: 'Game of Thrones',
      description: 'Series description',
      poster: 'poster.jpg',
      background: 'bg.jpg',
      releaseInfo: '2011-2019',
    },
  };
  const video = {
    id: 'tt0944947:1:5',
    name: 'The Wolf and the Lion',
    released: '2011-05-15T00:00:00.000Z',
  };

  const result = buildEpisodeMeta(
    seriesMeta,
    'tt0944947:1:5',
    1,
    5,
    video,
    'Episode description',
  );

  assert.equal(result.meta.id, 'tt0944947:1:5');
  assert.equal(
    result.meta.name,
    'Game of Thrones — The Wolf and the Lion (S01E05)',
  );
  assert.equal(result.meta.type, 'series');
  assert.equal(result.meta.description, 'Episode description');
  assert.equal(result.meta.releaseInfo, '2011');
  // Opens the detail page directly on this episode's streams
  assert.equal(result.meta.behaviorHints.defaultVideoId, 'tt0944947:1:5');
  assert.equal(result.meta.videos.length, 1);
  assert.equal(result.meta.videos[0].id, 'tt0944947:1:5');
  assert.equal(result.meta.videos[0].season, 1);
  assert.equal(result.meta.videos[0].episode, 5);
});

test('buildEpisodeMeta handles missing video gracefully', () => {
  const seriesMeta = {
    meta: {
      id: 'tt1',
      name: 'Some Show',
      description: 'Fallback description',
    },
  };

  const result = buildEpisodeMeta(seriesMeta, 'tt1:2:3', 2, 3, null, '');

  assert.equal(result.meta.name, 'Some Show — (S02E03)');
  assert.equal(result.meta.description, 'Fallback description');
  assert.equal(result.meta.videos[0].title, 'Episode 3');
});
