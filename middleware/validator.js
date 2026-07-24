const { body, param, query, validationResult } = require('express-validator');
const { ErrorTypes } = require('./errorHandler');
const { MAX_COOLDOWN_DAYS } = require('../config');

const IMDB_ID_PATTERN = /^(tt\d+|tvmaze-\d+)$/;
const USER_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

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
 * Build a user-key validation chain for a query field
 * Accepts alphanumeric strings, hyphens, and underscores (UUID-like)
 */
function userKeyChain(field) {
  return query(field)
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .matches(USER_KEY_PATTERN)
    .withMessage('Invalid user ID format');
}

/**
 * Validate user ID (query params `user` and `uid`)
 */
const validateUserId = [userKeyChain('user'), userKeyChain('uid')];

/**
 * Validate IMDB ID
 * Format: tt followed by digits, or tvmaze- followed by digits
 */
const validateImdbId = [
  param('imdbId')
    .isString()
    .trim()
    .matches(IMDB_ID_PATTERN)
    .withMessage('Invalid IMDB ID format'),
];

/**
 * Validate IMDB ID in request body
 */
const validateImdbIdBody = [
  body('imdbId')
    .isString()
    .trim()
    .matches(IMDB_ID_PATTERN)
    .withMessage('Invalid IMDB ID format'),
];

/**
 * Validate search query.
 * No .escape() here — the query is sent to TVmaze, not rendered as HTML;
 * escaping would mangle queries like "Tom & Jerry".
 */
const validateSearchQuery = [
  query('q')
    .isString()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be between 2 and 100 characters'),
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
 * Validate user settings (watched-episode cooldown)
 */
const validateUserSettings = [
  body('cooldownDays')
    .isInt({ min: 0, max: MAX_COOLDOWN_DAYS })
    .withMessage(`cooldownDays must be an integer between 0 and ${MAX_COOLDOWN_DAYS}`),
];

module.exports = {
  handleValidationErrors,
  validateUserId,
  validateImdbId,
  validateImdbIdBody,
  validateSearchQuery,
  validateSeasonSettings,
  validateUserSettings,
};
