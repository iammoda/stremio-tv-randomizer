const rateLimit = require('express-rate-limit');

/**
 * Create a rate limiter with custom options.
 *
 * Uses the default key generator (client IP, with proper IPv6 handling).
 * Keying on the `user` query param would let an attacker reset their bucket
 * by rotating the param; IP-based keys require `trust proxy` to be set
 * (done in addon.js) so req.ip is correct behind Vercel's proxy.
 */
function createLimiter(options) {
  return rateLimit({
    windowMs: options.windowMs || 60 * 1000, // Default: 1 minute
    max: options.max || 100,
    message: {
      error: options.message || 'Too many requests, please try again later',
      code: 'RATE_LIMITED',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/api/health';
    },
  });
}

/**
 * Rate limiter for general API endpoints
 * 100 requests per minute per IP
 */
const apiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many API requests, please try again later',
});

/**
 * Rate limiter for search endpoint
 * 30 requests per minute per IP (more restrictive due to external API calls)
 */
const searchLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many search requests, please slow down',
});

/**
 * Rate limiter for Stremio addon endpoints
 * 300 requests per minute per IP (addon requests are frequent, and playback
 * of any IMDB content now triggers a subtitles request)
 */
const stremioLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Too many requests to addon, please try again later',
});

module.exports = {
  createLimiter,
  apiLimiter,
  searchLimiter,
  stremioLimiter,
};
