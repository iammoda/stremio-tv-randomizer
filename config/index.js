require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
const PORT = process.env.PORT || 7001;

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const TVMAZE_URL = 'https://api.tvmaze.com';

const MAX_SHOWS = 150;

// Watched-episode cooldown: episodes the user started watching are excluded
// from random picks for this many days (per-user configurable, 0 disables).
const DEFAULT_COOLDOWN_DAYS = 30;
const MAX_COOLDOWN_DAYS = 90; // must match the watchedEpisodes TTL index

const manifest = {
  id: 'org.tvrandomizer.addon',
  version: '1.1.0',
  name: 'TV Show Randomizer',
  description: 'Randomly play episodes from your favorite TV shows',
  // logo is injected per-request in the manifest route (needs an absolute URL)
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
  // 'subtitles' is used as a playback-start signal for watched tracking;
  // the handler always returns an empty list.
  resources: ['catalog', 'meta', 'stream', 'subtitles'],
  types: ['series'],
  catalogs: [
    {
      type: 'series',
      id: 'random-episode',
      name: 'Find Random Episode',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  idPrefixes: ['tt', 'random-episode-action', 'random-episode-show:'],
};

module.exports = {
  MONGODB_URI,
  MONGODB_DB,
  PORT,
  CINEMETA_URL,
  TVMAZE_URL,
  MAX_SHOWS,
  DEFAULT_COOLDOWN_DAYS,
  MAX_COOLDOWN_DAYS,
  manifest,
};
