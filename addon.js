const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const DATA_FILE = path.join(__dirname, 'data', 'shows.json');

let userShows = [];

function loadShows() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      userShows = JSON.parse(data);
    }
  } catch (e) {
    console.log('Starting with empty show list');
  }
}

function saveShows() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(userShows, null, 2));
  } catch (e) {
    console.log('Could not save shows');
  }
}

async function fetchMeta(type, id) {
  try {
    const response = await fetch(`${CINEMETA_URL}/meta/${type}/${id}.json`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    console.error('Failed to fetch meta:', e);
  }
  return null;
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

async function addShow(imdbId) {
  let actualImdbId = imdbId;

  if (userShows.length >= MAX_SHOWS) {
    return { success: false, error: `Maximum of ${MAX_SHOWS} shows allowed` };
  }

  if (imdbId.startsWith('tvmaze-')) {
    const tvmazeId = imdbId.replace('tvmaze-', '');
    try {
      const response = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
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
    const exists = userShows.find((s) => s.id === actualImdbId);
    if (exists) {
      return { success: false, exists: true };
    }
    userShows.push({
      id: actualImdbId,
      name: meta.meta.name,
      poster: meta.meta.poster,
      background: meta.meta.background,
    });
    saveShows();
    return { success: true };
  }
  return { success: false, error: 'Failed to fetch show metadata' };
}

function removeShow(imdbId) {
  userShows = userShows.filter((s) => s.id !== imdbId);
  saveShows();
}

async function getShowStreams(imdbId) {
  const meta = await fetchMeta('series', imdbId);
  if (meta && meta.meta && meta.meta.videos) {
    return {
      streams: meta.meta.videos.map((video) => {
        const title =
          video.name ||
          video.title ||
          `S${video.season || video.number}E${video.episode}`;
        return {
          title: `${meta.meta.name} - ${title}`,
          url: `stremio://${video.id}`,
        };
      }),
    };
  }
  return { streams: [] };
}

const manifest = {
  id: 'org.tvrandomizer.addon',
  version: '1.0.0',
  name: 'TV Show Randomizer',
  description: 'Randomly play episodes from your favorite TV shows',
  logo: 'https://via.placeholder.com/256x256.png?text=Random+TV',
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

function handleCatalog(type, id, extra) {
  if (id === 'random-episode') {
    const items = [];

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
      metas: userShows.map((show) => ({
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

async function handleMeta(type, id) {
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

  const userShow = userShows.find((s) => s.id === id);
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
  res.redirect('/manifest.json');
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json({ metas: [] });
  }

  try {
    const response = await fetch(
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

app.get('/api/shows', (req, res) => {
  res.json({ shows: userShows, limit: MAX_SHOWS });
});

app.post('/api/shows', async (req, res) => {
  const { imdbId } = req.body;
  const result = await addShow(imdbId);
  res.json(result);
});

app.delete('/api/shows/:imdbId', (req, res) => {
  removeShow(req.params.imdbId);
  res.json({ success: true, shows: userShows });
});

app.get('/catalog/:type/:id.json', async (req, res) => {
  try {
    console.log('Catalog request:', req.params.type, req.params.id, req.query);
    const extra = {};
    if (req.query.search) extra.search = req.query.search;
    const result = handleCatalog(req.params.type, req.params.id, extra);
    res.json(result);
  } catch (e) {
    console.error('Catalog error:', e);
    res.status(500).json({ metas: [] });
  }
});

app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    console.log('Meta request:', req.params.type, req.params.id);
    const result = await handleMeta(req.params.type, req.params.id);
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

loadShows();

const PORT = process.env.PORT || 7001;
const server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TV Randomizer Addon running on http://localhost:${PORT}`);
  console.log(`Settings page: http://localhost:${PORT}/settings`);
  console.log(`Install in Stremio: http://localhost:${PORT}/`);
});
