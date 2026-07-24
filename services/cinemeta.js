const { CINEMETA_URL } = require('../config');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');

// In-memory TTL cache for Cinemeta responses.
// The meta endpoint is the hottest path (every meta request and every random
// pick needs the full series meta), so even a short TTL cuts most upstream calls.
const META_CACHE_TTL_MS = 10 * 60 * 1000;
const META_CACHE_MAX_ENTRIES = 200;
const metaCache = new Map(); // key -> { value, expiresAt }

function getCachedMeta(key, now = Date.now()) {
  const entry = metaCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    metaCache.delete(key);
    return null;
  }
  // Refresh recency (Map preserves insertion order) for LRU-style eviction
  metaCache.delete(key);
  metaCache.set(key, entry);
  return entry.value;
}

function setCachedMeta(key, value, now = Date.now()) {
  if (metaCache.size >= META_CACHE_MAX_ENTRIES) {
    const oldestKey = metaCache.keys().next().value;
    metaCache.delete(oldestKey);
  }
  metaCache.set(key, { value, expiresAt: now + META_CACHE_TTL_MS });
}

/**
 * Fetch metadata from Cinemeta (cached, with timeout)
 */
async function fetchMeta(type, id) {
  const cacheKey = `${type}:${id}`;
  const cached = getCachedMeta(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      `${CINEMETA_URL}/meta/${type}/${id}.json`,
    );
    if (response.ok) {
      const meta = await response.json();
      if (meta && meta.meta) {
        setCachedMeta(cacheKey, meta);
      }
      return meta;
    }
  } catch (e) {
    console.error('Failed to fetch meta:', id, e.message || e);
  }
  return null;
}

module.exports = {
  fetchMeta,
};
