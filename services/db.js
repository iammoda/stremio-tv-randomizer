const { MongoClient } = require('mongodb');
const { MONGODB_URI, MONGODB_DB } = require('../config');

let mongoClient;
let mongoDb;
let mongoClientPromise;
let indexesPromise;

/**
 * Extract database name from MongoDB URI
 */
function getDbNameFromUri(uri) {
  try {
    const parsed = new URL(uri);
    if (!parsed.pathname || parsed.pathname === '/') return null;
    return parsed.pathname.replace('/', '') || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get MongoDB database connection (singleton)
 */
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
  await ensureIndexes();
  return mongoDb;
}

/**
 * Ensure required MongoDB indexes exist
 */
async function ensureIndexes() {
  if (!mongoDb) return;
  if (!indexesPromise) {
    indexesPromise = mongoDb
      .collection('showEpisodeStats')
      .createIndex({ showId: 1 }, { unique: true })
      .catch((error) => {
        indexesPromise = null;
        throw error;
      });
  }
  await indexesPromise;
}

/**
 * Extract user ID from request
 */
function getUserId(req) {
  const userId =
    (req.query.user || req.query.uid || req.headers['x-user-id'] || '').trim();
  return userId || null;
}

// ===================
// SHOWS OPERATIONS
// ===================

/**
 * Get all shows for a user
 */
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

/**
 * Get count of shows for a user
 */
async function getShowCount(userId) {
  if (!userId) return 0;
  const db = await getDb();
  return db.collection('shows').countDocuments({ userId });
}

/**
 * Check if user has a specific show
 */
async function hasShow(userId, showId) {
  if (!userId) return false;
  const db = await getDb();
  const existing = await db
    .collection('shows')
    .findOne({ userId, showId }, { projection: { _id: 1 } });
  return Boolean(existing);
}

/**
 * Insert a new show for a user
 */
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

/**
 * Delete a show for a user
 */
async function deleteShow(userId, showId) {
  if (!userId) return;
  const db = await getDb();
  await db.collection('shows').deleteOne({ userId, showId });
}

// ===================
// SHOW SETTINGS OPERATIONS
// ===================

/**
 * Get settings for a specific show
 */
async function getShowSettings(userId, showId) {
  if (!userId || !showId) return null;
  const db = await getDb();
  return db.collection('showSettings').findOne({ userId, showId });
}

/**
 * Get settings for multiple shows as a map keyed by showId
 */
async function getShowSettingsMap(userId, showIds) {
  if (!userId || !Array.isArray(showIds) || showIds.length === 0) {
    return new Map();
  }

  const db = await getDb();
  const rows = await db
    .collection('showSettings')
    .find({ userId, showId: { $in: showIds } })
    .project({ _id: 0, showId: 1, enabledSeasons: 1 })
    .toArray();

  return new Map(
    rows.map((row) => [
      row.showId,
      {
        showId: row.showId,
        enabledSeasons: Array.isArray(row.enabledSeasons)
          ? row.enabledSeasons
          : [],
      },
    ]),
  );
}

/**
 * Update settings for a specific show
 */
async function updateShowSettings(userId, showId, settings) {
  if (!userId || !showId) return;
  const db = await getDb();
  
  await db.collection('showSettings').updateOne(
    { userId, showId },
    {
      $set: {
        userId,
        showId,
        enabledSeasons: settings.enabledSeasons || [],
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Delete settings for a specific show
 */
async function deleteShowSettings(userId, showId) {
  if (!userId || !showId) return;
  const db = await getDb();
  await db.collection('showSettings').deleteOne({ userId, showId });
}

/**
 * Get settings for all shows a user has
 */
async function getAllShowSettings(userId) {
  if (!userId) return [];
  const db = await getDb();
  return db.collection('showSettings').find({ userId }).toArray();
}

/**
 * Get cached episode stats for a show
 */
async function getShowEpisodeStats(showId) {
  if (!showId) return null;
  const db = await getDb();
  return db.collection('showEpisodeStats').findOne(
    { showId },
    { projection: { _id: 0 } },
  );
}

/**
 * Get cached episode stats for multiple shows as a map keyed by showId
 */
async function getShowEpisodeStatsMap(showIds) {
  if (!Array.isArray(showIds) || showIds.length === 0) {
    return new Map();
  }

  const db = await getDb();
  const rows = await db
    .collection('showEpisodeStats')
    .find({ showId: { $in: showIds } })
    .project({ _id: 0 })
    .toArray();

  return new Map(rows.map((row) => [row.showId, row]));
}

/**
 * Upsert cached episode stats for a show
 */
async function upsertShowEpisodeStats(showId, stats) {
  if (!showId || !stats) return null;
  const db = await getDb();

  const payload = {
    showId,
    seasonCounts: stats.seasonCounts || {},
    availableSeasons: stats.availableSeasons || [],
    totalEpisodes: Number.isFinite(stats.totalEpisodes) ? stats.totalEpisodes : 0,
    updatedAt: stats.updatedAt || new Date(),
  };

  await db.collection('showEpisodeStats').updateOne(
    { showId },
    {
      $set: payload,
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  return payload;
}

module.exports = {
  getDb,
  getUserId,
  ensureIndexes,
  // Shows
  getUserShows,
  getShowCount,
  hasShow,
  insertShow,
  deleteShow,
  // Show settings
  getShowSettings,
  getShowSettingsMap,
  updateShowSettings,
  deleteShowSettings,
  getAllShowSettings,
  // Show episode stats
  getShowEpisodeStats,
  getShowEpisodeStatsMap,
  upsertShowEpisodeStats,
};
