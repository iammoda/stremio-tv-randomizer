const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const db = require('../services/db');
const randomizer = require('../services/randomizer');
const { errorHandler } = require('../middleware/errorHandler');

// Exercise the real HTTP routes and validation without connecting to a user's database.
const settings = new Map();
mock.method(db, 'getUserSettings', async (userId) =>
  settings.get(userId) || { randomizationMode: 'episode' });
mock.method(db, 'updateUserSettings', async (userId, value) => settings.set(userId, value));
mock.method(db, 'getUserShows', async () => [{ id: 'tt1234567' }]);
mock.method(randomizer, 'pickSmartRandomEpisode', async () => null);

const app = express();
app.use(express.json());
app.use('/api', require('../routes/api'));
app.use('/', require('../routes/stremio'));
app.use(errorHandler);
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  mock.restoreAll();
});

function putSettings(userId, value) {
  return fetch(`${baseUrl}/api/settings${userId ? `?user=${userId}` : ''}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

test('settings default to episode weighting and are not browser-cacheable', async () => {
  const response = await fetch(`${baseUrl}/api/settings?user=default-user`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { randomizationMode: 'episode' });
});

test('settings can be switched in both directions and stay isolated by user key', async () => {
  for (const mode of ['show', 'episode']) {
    const response = await putSettings('user-a', { randomizationMode: mode, ignored: true });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, randomizationMode: mode });
    assert.deepEqual(await fetch(`${baseUrl}/api/settings?user=user-a`).then((res) => res.json()), {
      randomizationMode: mode,
    });
    assert.deepEqual(await fetch(`${baseUrl}/api/settings?user=user-b`).then((res) => res.json()), {
      randomizationMode: 'episode',
    });
  }
});

test('invalid modes and missing user keys cannot overwrite preferences', async () => {
  await putSettings('validation-user', { randomizationMode: 'show' });
  for (const value of [{}, { randomizationMode: 'invalid' }, { randomizationMode: ['episode'] }]) {
    const response = await putSettings('validation-user', value);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'VALIDATION_ERROR');
  }
  assert.equal((await putSettings('', { randomizationMode: 'episode' })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/settings`)).status, 400);
  assert.deepEqual(settings.get('validation-user'), { randomizationMode: 'show' });
});

test('empty random selections return explanatory Stremio metadata with no episodes', async () => {
  for (const id of ['random-episode-action', 'random-episode-show:tt1234567']) {
    const response = await fetch(`${baseUrl}/meta/series/${encodeURIComponent(id)}.json?user=empty-user`);
    assert.equal(response.status, 200);
    const { meta } = await response.json();
    assert.equal(meta.id, id);
    assert.equal(meta.name, 'No eligible episodes');
    assert.deepEqual(meta.videos, []);
    assert.match(meta.description, /season filters/);
  }
});
