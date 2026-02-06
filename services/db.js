const { MongoClient } = require('mongodb');
const { MONGODB_URI, MONGODB_DB } = require('../config');

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
  // Show settings
  getShowSettings,
  updateShowSettings,
  deleteShowSettings,
  getAllShowSettings,
};
