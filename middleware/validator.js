const { body, param, query, validationResult } = require('express-validator');
const { ErrorTypes } = require('./errorHandler');

/**
 * Handle validation errors
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((err) => err.msg).join(', ');
    return next(ErrorTypes.VALIDATION(messages));
  }
  next();
}

/**
 * Validate user ID
 * Accepts alphanumeric strings, hyphens, and underscores (UUID-like)
 */
const validateUserId = [
  query('user')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Invalid user ID format'),
  query('uid')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Invalid user ID format'),
];

/**
 * Validate IMDB ID
 * Format: tt followed by digits, or tvmaze-followed by digits
 */
const validateImdbId = [
  param('imdbId')
    .isString()
    .trim()
    .matches(/^(tt\d+|tvmaze-\d+)$/)
    .withMessage('Invalid IMDB ID format'),
];

/**
 * Validate IMDB ID in request body
 */
const validateImdbIdBody = [
  body('imdbId')
    .isString()
    .trim()
    .matches(/^(tt\d+|tvmaze-\d+)$/)
    .withMessage('Invalid IMDB ID format'),
];

/**
 * Validate search query
 */
const validateSearchQuery = [
  query('q')
    .isString()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be between 2 and 100 characters')
    .escape(), // Sanitize to prevent XSS
];

/**
 * Validate season settings
 */
const validateSeasonSettings = [
  body('enabledSeasons')
    .isArray()
    .withMessage('enabledSeasons must be an array'),
  body('enabledSeasons.*')
    .isInt({ min: 1 })
    .withMessage('Season numbers must be positive integers'),
];

/**
 * Validate episode ID
 * Format: tt1234567:1:5 (IMDB ID:season:episode)
 */
const validateEpisodeId = [
  param('episodeId')
    .isString()
    .trim()
    .matches(/^tt\d+:\d+:\d+$/)
    .withMessage('Invalid episode ID format'),
];

/**
 * Validate history entry
 */
const validateHistoryEntry = [
  body('showId')
    .isString()
    .trim()
    .matches(/^tt\d+$/)
    .withMessage('Invalid show ID format'),
  body('episodeId')
    .isString()
    .trim()
    .matches(/^tt\d+:\d+:\d+$/)
    .withMessage('Invalid episode ID format'),
  body('season')
    .isInt({ min: 0 })
    .withMessage('Season must be a non-negative integer'),
  body('episode')
    .isInt({ min: 0 })
    .withMessage('Episode must be a non-negative integer'),
  body('showName')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 }),
  body('episodeName')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 }),
];

module.exports = {
  handleValidationErrors,
  validateUserId,
  validateImdbId,
  validateImdbIdBody,
  validateSearchQuery,
  validateSeasonSettings,
  validateEpisodeId,
  validateHistoryEntry,
};
