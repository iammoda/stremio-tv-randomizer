const rateLimit = require('express-rate-limit');

/**
 * Create a rate limiter with custom options
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
    keyGenerator: (req) => {
      // Use user ID if available, otherwise fall back to IP
      return req.query.user || req.query.uid || req.ip;
    },
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/api/health';
    },
  });
}

/**
 * Rate limiter for general API endpoints
 * 100 requests per minute per user
 */
const apiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many API requests, please try again later',
});

/**
 * Rate limiter for search endpoint
 * 30 requests per minute per user (more restrictive due to external API calls)
 */
const searchLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many search requests, please slow down',
});

/**
 * Rate limiter for Stremio addon endpoints
 * 200 requests per minute per user (addon requests are frequent)
 */
const stremioLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 200,
  message: 'Too many requests to addon, please try again later',
});

module.exports = {
  createLimiter,
  apiLimiter,
  searchLimiter,
  stremioLimiter,
};
