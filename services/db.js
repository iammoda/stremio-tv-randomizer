const { MongoClient } = require('mongodb');
const { MONGODB_URI, MONGODB_DB, HISTORY_RECENCY_DAYS } = require('../config');

let mongoClient;
let mongoDb;
let mongoClientPromise;

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
  return mongoDb;
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
// WATCH HISTORY OPERATIONS
// ===================

/**
 * Record an episode as watched
 */
async function recordWatch(userId, episodeData) {
  if (!userId || !episodeData) return;
  const db = await getDb();
  
  const { showId, episodeId, season, episode, showName, episodeName, poster } = episodeData;
  
  await db.collection('watchHistory').updateOne(
    { userId, episodeId },
    {
      $set: {
        userId,
        showId,
        episodeId,
        season,
        episode,
        showName: showName || '',
        episodeName: episodeName || '',
        poster: poster || '',
        watchedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Get user's watch history
 */
async function getWatchHistory(userId, limit = 50) {
  if (!userId) return [];
  const db = await getDb();
  return db
    .collection('watchHistory')
    .find({ userId })
    .sort({ watchedAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Get recent watch history for a specific show
 */
async function getRecentHistoryForShow(userId, showId, days = HISTORY_RECENCY_DAYS) {
  if (!userId) return [];
  const db = await getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  return db
    .collection('watchHistory')
    .find({
      userId,
      showId,
      watchedAt: { $gte: cutoff },
    })
    .toArray();
}

/**
 * Get all recent watch history for a user
 */
async function getRecentHistory(userId, days = HISTORY_RECENCY_DAYS) {
  if (!userId) return [];
  const db = await getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  return db
    .collection('watchHistory')
    .find({
      userId,
      watchedAt: { $gte: cutoff },
    })
    .toArray();
}

/**
 * Delete a specific watch history entry
 */
async function deleteWatchEntry(userId, episodeId) {
  if (!userId) return;
  const db = await getDb();
  await db.collection('watchHistory').deleteOne({ userId, episodeId });
}

/**
 * Clear all watch history for a user
 */
async function clearWatchHistory(userId) {
  if (!userId) return;
  const db = await getDb();
  await db.collection('watchHistory').deleteMany({ userId });
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

module.exports = {
  getDb,
  getUserId,
  // Shows
  getUserShows,
  getShowCount,
  hasShow,
  insertShow,
  deleteShow,
  // Watch history
  recordWatch,
  getWatchHistory,
  getRecentHistoryForShow,
  getRecentHistory,
  deleteWatchEntry,
  clearWatchHistory,
  // Show settings
  getShowSettings,
  updateShowSettings,
  deleteShowSettings,
  getAllShowSettings,
};
