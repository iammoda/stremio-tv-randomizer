const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Fetch with a hard timeout via AbortController.
 * Prevents hung upstream APIs (Cinemeta/TVmaze) from stalling requests
 * until the platform (e.g., Vercel) kills them.
 *
 * @param {string} url - URL to fetch
 * @param {object} [options] - fetch options, plus optional `timeoutMs`
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchWithTimeout,
  DEFAULT_TIMEOUT_MS,
};
