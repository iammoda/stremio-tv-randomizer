const { MongoClient } = require('mongodb');
const {
  MONGODB_URI,
  MONGODB_DB,
  DEFAULT_COOLDOWN_DAYS,
  MAX_COOLDOWN_DAYS,
} = require('../config');

let mongoClient;
let mongoDb;
let mongoClientPromise;
let indexesPromise;

const MAX_USER_ID_LENGTH = 128;

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
 * Remove duplicate {userId, showId} rows created by the old
 * check-then-insert race, keeping the earliest insert.
 * Must run before the unique index can be created.
 */
async function dedupeShows(db) {
  const duplicates = await db
    .collection('shows')
    .aggregate([
      {
        $group: {
          _id: { userId: '$userId', showId: '$showId' },
          ids: { $push: '$_id' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  for (const dup of duplicates) {
    // ObjectIds sort by creation time; keep the oldest
    const sorted = [...dup.ids].sort((a, b) =>
      String(a) < String(b) ? -1 : 1,
    );
    const toDelete = sorted.slice(1);
    if (toDelete.length > 0) {
      await db.collection('shows').deleteMany({ _id: { $in: toDelete } });
    }
  }

  if (duplicates.length > 0) {
    console.log(`Deduplicated ${duplicates.length} show entr(y/ies)`);
  }
}

/**
 * Ensure required MongoDB indexes exist
 */
async function ensureIndexes() {
  if (!mongoDb) return;
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const db = mongoDb;
      await db
        .collection('showEpisodeStats')
        .createIndex({ showId: 1 }, { unique: true });

      await dedupeShows(db);
      await db
        .collection('shows')
        .createIndex({ userId: 1, showId: 1 }, { unique: true });

      await db
        .collection('showSettings')
        .createIndex({ userId: 1, showId: 1 }, { unique: true });

      await db
        .collection('watchedEpisodes')
        .createIndex({ userId: 1, episodeId: 1 }, { unique: true });
      await db
        .collection('watchedEpisodes')
        .createIndex({ userId: 1, watchedAt: -1 });
      // Auto-purge watch records past the maximum cooldown window
      await db
        .collection('watchedEpisodes')
        .createIndex(
          { watchedAt: 1 },
          { expireAfterSeconds: MAX_COOLDOWN_DAYS * 24 * 60 * 60 },
        );

      await db
        .collection('userSettings')
        .createIndex({ userId: 1 }, { unique: true });
    })().catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }
  await indexesPromise;
}

/**
 * Extract and sanitize the user ID from a request.
 * Only plain strings are accepted: Express's extended query parser can
 * produce objects/arrays (e.g. ?user[$gt]=x), which must never reach Mongo.
 */
function getUserId(req) {
  const candidates = [
    req.query && req.query.user,
    req.query && req.query.uid,
    req.headers && req.headers['x-user-id'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.length > MAX_USER_ID_LENGTH) continue;
    return trimmed;
  }

  return null;
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
 * Insert a new show for a user.
 * Returns { inserted: boolean, exists: boolean } — the unique index makes
 * concurrent duplicate adds safe (no more check-then-insert race).
 */
async function insertShow(userId, show) {
  if (!userId) return { inserted: false, exists: false };
  const db = await getDb();
  try {
    await db.collection('shows').insertOne({
      userId,
      showId: show.id,
      name: show.name,
      poster: show.poster,
      background: show.background,
      createdAt: new Date(),
    });
    return { inserted: true, exists: false };
  } catch (error) {
    if (error && error.code === 11000) {
      return { inserted: false, exists: true };
    }
    throw error;
  }
}

/**
 * Delete a show for a user
 */
async function deleteShow(userId, showId) {
  if (!userId) return;
  const db = await getDb();
  await db.collection('shows').deleteOne({ userId, showId });
}

/**
 * Delete all shows (and their settings) for a user
 */
async function deleteAllShows(userId) {
  if (!userId) return 0;
  const db = await getDb();
  const result = await db.collection('shows').deleteMany({ userId });
  await db.collection('showSettings').deleteMany({ userId });
  return result.deletedCount || 0;
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

// ===================
// USER SETTINGS OPERATIONS
// ===================

function normalizeCooldownDays(value, fallback = DEFAULT_COOLDOWN_DAYS) {
  const days = Number(value);
  if (!Number.isFinite(days)) return fallback;
  return Math.min(Math.max(Math.round(days), 0), MAX_COOLDOWN_DAYS);
}

/**
 * Get user-level settings (currently: watched-episode cooldown)
 */
async function getUserSettings(userId) {
  if (!userId) return { cooldownDays: DEFAULT_COOLDOWN_DAYS };
  const db = await getDb();
  const row = await db.collection('userSettings').findOne(
    { userId },
    { projection: { _id: 0, cooldownDays: 1 } },
  );
  if (!row || row.cooldownDays === undefined || row.cooldownDays === null) {
    return { cooldownDays: DEFAULT_COOLDOWN_DAYS };
  }
  return { cooldownDays: normalizeCooldownDays(row.cooldownDays) };
}

/**
 * Update user-level settings
 */
async function updateUserSettings(userId, settings = {}) {
  if (!userId) return null;
  const db = await getDb();
  const cooldownDays = normalizeCooldownDays(settings.cooldownDays);

  await db.collection('userSettings').updateOne(
    { userId },
    {
      $set: { userId, cooldownDays, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );

  return { cooldownDays };
}

// ===================
// WATCHED EPISODES OPERATIONS
// ===================

/**
 * Record that a user started watching an episode (upsert refreshes watchedAt)
 */
async function recordWatchedEpisode(userId, { showId, episodeId, season, episode }) {
  if (!userId || !showId || !episodeId) return;
  const db = await getDb();
  await db.collection('watchedEpisodes').updateOne(
    { userId, episodeId },
    {
      $set: {
        userId,
        episodeId,
        showId,
        season,
        episode,
        watchedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

/**
 * Get episodes the user watched since the given date
 */
async function getRecentlyWatchedEpisodes(userId, since) {
  if (!userId || !(since instanceof Date)) return [];
  const db = await getDb();
  return db
    .collection('watchedEpisodes')
    .find({ userId, watchedAt: { $gte: since } })
    .project({ _id: 0, showId: 1, episodeId: 1, season: 1, episode: 1 })
    .toArray();
}

// ===================
// SHOW EPISODE STATS OPERATIONS
// ===================

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
  deleteAllShows,
  // Show settings
  getShowSettings,
  getShowSettingsMap,
  updateShowSettings,
  deleteShowSettings,
  // User settings
  getUserSettings,
  updateUserSettings,
  // Watched episodes
  recordWatchedEpisode,
  getRecentlyWatchedEpisodes,
  // Show episode stats
  getShowEpisodeStats,
  getShowEpisodeStatsMap,
  upsertShowEpisodeStats,
};
