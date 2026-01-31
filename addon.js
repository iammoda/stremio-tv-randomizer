require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { MongoClient } = require('mongodb');
const fetchFn = global.fetch || require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
let mongoClient;
let mongoDb;
let mongoClientPromise;

async function fetchMeta(type, id) {
  try {
    const response = await fetchFn(`${CINEMETA_URL}/meta/${type}/${id}.json`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    console.error('Failed to fetch meta:', e);
  }
  return null;
}

function getDbNameFromUri(uri) {
  try {
    const parsed = new URL(uri);
    if (!parsed.pathname || parsed.pathname === '/') return null;
    return parsed.pathname.replace('/', '') || null;
  } catch (e) {
    return null;
  }
}

async function getDb() {
  if (!MONGODB_URI) {
    throw new Error('Missing MONGODB_URI');
  }
  if (mongoDb) return mongoDb;
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      tls: true,
    });
  }
  if (!mongoClientPromise) {
    mongoClientPromise = mongoClient.connect();
  }
  await mongoClientPromise;
  const dbName = MONGODB_DB || getDbNameFromUri(MONGODB_URI);
  if (!dbName) {
    console.warn('No database name set in MONGODB_URI or MONGODB_DB');
  }
  mongoDb = mongoClient.db(dbName || undefined);
  return mongoDb;
}

function getUserId(req) {
  const userId =
    (req.query.user || req.query.uid || req.headers['x-user-id'] || '').trim();
  return userId || null;
}

async function getUserShows(userId) {
  if (!userId) return [];
  const db = await getDb();
  const rows = await db
    .collection('shows')
    .find({ userId })
    .sort({ createdAt: -1 })
    .project({ _id: 0, showId: 1, name: 1, poster: 1, background: 1 })
    .toArray();
  return rows.map((row) => ({
    id: row.showId,
    name: row.name,
    poster: row.poster,
    background: row.background,
  }));
}

async function getShowCount(userId) {
  if (!userId) return 0;
  const db = await getDb();
  return db.collection('shows').countDocuments({ userId });
}

async function hasShow(userId, showId) {
  if (!userId) return false;
  const db = await getDb();
  const existing = await db
    .collection('shows')
    .findOne({ userId, showId }, { projection: { _id: 1 } });
  return Boolean(existing);
}

async function insertShow(userId, show) {
  if (!userId) return;
  const db = await getDb();
  await db.collection('shows').insertOne({
    userId,
    showId: show.id,
    name: show.name,
    poster: show.poster,
    background: show.background,
    createdAt: new Date(),
  });
}

async function deleteShow(userId, showId) {
  if (!userId) return;
  const db = await getDb();
  await db.collection('shows').deleteOne({ userId, showId });
}

function parseEpisodeId(id) {
  if (!id || !id.startsWith('tt') || !id.includes(':')) return null;
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const season = Number(parts[1]);
  const episode = Number(parts[2]);
  if (Number.isNaN(season) || Number.isNaN(episode)) return null;
  return { showId: parts[0], season, episode };
}

function findEpisodeVideo(meta, season, episode) {
  if (!meta || !meta.meta || !meta.meta.videos) return null;
  return meta.meta.videos.find(
    (v) =>
      Number(v.season) === season &&
      Number(v.episode || v.number) === episode,
  );
}

function buildEpisodeMeta(meta, episodeId, season, episode, video) {
  const videoTitle =
    video && (video.name || video.title)
      ? video.name || video.title
      : `S${season}E${episode}`;
  return {
    meta: {
      id: episodeId,
      type: 'series',
      name: `${meta.meta.name} - ${videoTitle}`,
      poster: meta.meta.poster,
      background: meta.meta.background,
      description: video ? video.description || video.overview || '' : '',
      releaseInfo: video && video.released ? video.released.substring(0, 4) : '',
      videos: [
        {
          id: episodeId,
          title: videoTitle,
          season,
          episode: video ? video.episode || video.number || episode : episode,
          released: video ? video.released || video.firstAired || '' : '',
        },
      ],
      behaviorHints: {
        bingeGroup: meta.meta.id,
        featured: true,
        videoSize: 1080,
        defaultVideoId: episodeId,
      },
    },
  };
}

const MAX_SHOWS = 150;

async function addShow(userId, imdbId) {
  let actualImdbId = imdbId;

  if (!userId) {
    return { success: false, error: 'Missing user key' };
  }

  const showCount = await getShowCount(userId);
  if (showCount >= MAX_SHOWS) {
    return { success: false, error: `Maximum of ${MAX_SHOWS} shows allowed` };
  }

  if (imdbId.startsWith('tvmaze-')) {
    const tvmazeId = imdbId.replace('tvmaze-', '');
    try {
      const response = await fetchFn(
        `https://api.tvmaze.com/shows/${tvmazeId}`,
      );
      const show = await response.json();
      if (show.externals && show.externals.imdb) {
        actualImdbId = show.externals.imdb;
      } else {
        return { success: false, error: 'No IMDB ID available for this show' };
      }
    } catch (e) {
      console.error('TVmaze lookup failed:', e);
      return { success: false, error: 'Failed to lookup show' };
    }
  }

  const meta = await fetchMeta('series', actualImdbId);

  if (meta && meta.meta) {
    const exists = await hasShow(userId, actualImdbId);
    if (exists) {
      return { success: false, exists: true };
    }
    await insertShow(userId, {
      id: actualImdbId,
      name: meta.meta.name,
      poster: meta.meta.poster,
      background: meta.meta.background,
    });
    return { success: true };
  }
  return { success: false, error: 'Failed to fetch show metadata' };
}

async function removeShow(userId, imdbId) {
  await deleteShow(userId, imdbId);
}

const manifest = {
  id: 'org.tvrandomizer.addon',
  version: '1.0.0',
  name: 'TV Show Randomizer',
  description: 'Randomly play episodes from your favorite TV shows',
  logo: 'https://via.placeholder.com/256x256.png?text=Random+TV',
  configurable: true,
  behaviorHints: {
    configurable: true,
  },
  config: [
    {
      key: 'user',
      type: 'text',
      title: 'User Key',
      required: true,
    },
  ],
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'episode'],
  catalogs: [
    {
      type: 'series',
      id: 'random-episode',
      name: 'Find Random Episode',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'my-shows',
      name: 'My Shows',
    },
    {
      type: 'series',
      id: 'add-shows',
      name: 'Add Shows',
    },
  ],
  idPrefixes: ['tt', 'random-episode-action'],
};

async function handleCatalog(type, id, extra, userId) {
  if (id === 'random-episode') {
    const items = [];
    const userShows = await getUserShows(userId);

    if (userShows.length > 0) {
      items.push({
        id: 'random-episode-action',
        type: 'series',
        name: '🎲 Random Episode',
        poster: 'https://i.imgflip.com/1ur9b0.jpg',
        description:
          'Click to play a random episode from any show in your list',
        behaviorHints: {
          bingeGroup: 'random-episode',
          featured: true,
        },
      });
    }

    items.push(
      ...userShows.map((show) => ({
        id: show.id,
        type: 'series',
        name: show.name,
        poster: show.poster,
        background: show.background,
      })),
    );

    return { metas: items };
  }

  if (id === 'my-shows') {
    return {
      metas: (await getUserShows(userId)).map((show) => ({
        id: show.id,
        type: 'series',
        name: show.name,
        poster: show.poster,
        background: show.background,
      })),
    };
  }

  return { metas: [] };
}

async function handleMeta(type, id, userId) {
  const episodeInfo = parseEpisodeId(id);
  if (episodeInfo) {
    const meta = await fetchMeta('series', episodeInfo.showId);
    if (meta && meta.meta) {
      const video = findEpisodeVideo(
        meta,
        episodeInfo.season,
        episodeInfo.episode,
      );
      return buildEpisodeMeta(
        meta,
        id,
        episodeInfo.season,
        episodeInfo.episode,
        video,
      );
    }
  }

  if (id === 'random-episode-action') {
    const userShows = await getUserShows(userId);
    if (userShows.length === 0) {
      return { meta: null };
    }

    const randomShow = userShows[Math.floor(Math.random() * userShows.length)];
    const meta = await fetchMeta('series', randomShow.id);

    if (meta && meta.meta && meta.meta.videos && meta.meta.videos.length > 0) {
      const randomEpisode =
        meta.meta.videos[Math.floor(Math.random() * meta.meta.videos.length)];
      return {
        meta: {
          id: randomShow.id,
          type: 'series',
          name: randomShow.name,
          poster: randomShow.poster,
          background: randomShow.background,
          description:
            randomEpisode.description || randomEpisode.overview || '',
          releaseInfo: randomEpisode.released
            ? randomEpisode.released.substring(0, 4)
            : '',
          videos: [
            {
              id: randomEpisode.id,
              title: randomEpisode.name || randomEpisode.title,
              season: randomEpisode.season || 0,
              episode: randomEpisode.episode || randomEpisode.number || 1,
              released:
                randomEpisode.released || randomEpisode.firstAired || '',
            },
          ],
          behaviorHints: {
            bingeGroup: randomShow.id,
            featured: true,
            videoSize: 1080,
            defaultVideoId: randomEpisode.id,
          },
        },
      };
    }

    return { meta: null };
  }

  const userShow = userId ? await hasShow(userId, id) : false;
  if (userShow) {
    const meta = await fetchMeta('series', id);
    if (meta) return meta;
  }

  return await fetchMeta(type, id);
}

async function handleStream(type, id) {
  if (parseEpisodeId(id)) {
    return { streams: [] };
  }

  if (id === 'random-episode-action') {
    return { streams: [] };
  }

  return { streams: [] };
}

app.get('/manifest.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.json(manifest);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'install.html'));
});

app.get('/myshows', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/configure', (req, res) => {
  const params = new URLSearchParams(req.query).toString();
  res.redirect(params ? `/myshows?${params}` : '/myshows');
});

app.get('/settings', (req, res) => {
  res.redirect('/myshows');
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json({ metas: [] });
  }

  try {
    const response = await fetchFn(
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`,
    );
    const data = await response.json();

    const metas = data
      .map((item) => ({
        id:
          item.show.externals && item.show.externals.imdb
            ? item.show.externals.imdb
            : `tvmaze-${item.show.id}`,
        name: item.show.name,
        poster: item.show.image ? item.show.image.medium : null,
        year: item.show.premiered ? item.show.premiered.substring(0, 4) : null,
      }))
      .filter((show) => show.poster);

    res.json({ metas: metas.slice(0, 10) });
  } catch (e) {
    console.error('Search error:', e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await getDb();
    res.json({ ok: true });
  } catch (e) {
    console.error('Health check error:', e);
    res.status(500).json({ ok: false, error: e.message || 'DB error' });
  }
});

app.get('/api/shows', (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(400).json({ shows: [], limit: MAX_SHOWS });
  }
  getUserShows(userId)
    .then((shows) => res.json({ shows, limit: MAX_SHOWS }))
    .catch((e) => {
      console.error('Load shows error:', e);
      res.status(500).json({ shows: [], limit: MAX_SHOWS });
    });
});

app.post('/api/shows', async (req, res) => {
  try {
    const { imdbId } = req.body;
    const userId = getUserId(req);
    const result = await addShow(userId, imdbId);
    res.json(result);
  } catch (e) {
    console.error('Add show error:', e);
    res.status(500).json({ success: false, error: 'Failed to add show' });
  }
});

app.delete('/api/shows/:imdbId', (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(400).json({ success: false });
  }
  removeShow(userId, req.params.imdbId)
    .then(async () => ({ success: true, shows: await getUserShows(userId) }))
    .then((payload) => res.json(payload))
    .catch((e) => {
      console.error('Remove show error:', e);
      res.status(500).json({ success: false });
    });
});

app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    console.log('Catalog request:', req.params.type, req.params.id, req.query);
    const extra = {};
    if (req.query.search) extra.search = req.query.search;
    const userId = getUserId(req);
    const result = await handleCatalog(
      req.params.type,
      req.params.id,
      extra,
      userId,
    );
    res.json(result);
  } catch (e) {
    console.error('Catalog error:', e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    console.log('Meta request:', req.params.type, req.params.id);
    const userId = getUserId(req);
    const result = await handleMeta(req.params.type, req.params.id, userId);
    res.json(result);
  } catch (e) {
    console.error('Meta error:', e);
    res.status(500).json({ meta: null });
  }
});

app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    console.log('Stream request:', req.params.type, req.params.id);
    const result = await handleStream(req.params.type, req.params.id);
    res.json(result);
  } catch (e) {
    console.error('Stream error:', e);
    res.status(500).json({ streams: [] });
  }
});

app.use(express.static('public'));

const PORT = process.env.PORT || 7001;

if (require.main === module) {
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TV Randomizer Addon running on http://localhost:${PORT}`);
    console.log(`Settings page: http://localhost:${PORT}/settings`);
    console.log(`Install in Stremio: http://localhost:${PORT}/`);
  });
}

module.exports = app;
