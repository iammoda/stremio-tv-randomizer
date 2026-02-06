require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
const PORT = process.env.PORT || 7001;

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const TVMAZE_URL = 'https://api.tvmaze.com';

const MAX_SHOWS = 150;

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
  manifest,
};
