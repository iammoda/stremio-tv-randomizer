/**
 * Centralized error handling middleware
 * Provides consistent error responses across all endpoints
 */

/**
 * Custom application error class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common error types
 */
const ErrorTypes = {
  VALIDATION: (message) => new AppError(message, 400, 'VALIDATION_ERROR'),
  NOT_FOUND: (message) => new AppError(message, 404, 'NOT_FOUND'),
  UNAUTHORIZED: (message) => new AppError(message, 401, 'UNAUTHORIZED'),
  FORBIDDEN: (message) => new AppError(message, 403, 'FORBIDDEN'),
  RATE_LIMITED: (message) => new AppError(message, 429, 'RATE_LIMITED'),
  DATABASE: (message) => new AppError(message, 500, 'DATABASE_ERROR'),
  EXTERNAL_API: (message) => new AppError(message, 502, 'EXTERNAL_API_ERROR'),
};

/**
 * Async handler wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Error handler middleware
 */
function errorHandler(err, req, res, next) {
  // Log error details
  console.error('Error:', {
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
    userId: req.query.user || req.query.uid || 'unknown',
    timestamp: new Date().toISOString(),
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Determine status code
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.isOperational ? err.message : 'An unexpected error occurred';

  // Send error response
  res.status(statusCode).json({
    error: message,
    code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * 404 handler for unmatched routes
 */
function notFoundHandler(req, res, next) {
  next(ErrorTypes.NOT_FOUND(`Route not found: ${req.method} ${req.path}`));
}

module.exports = {
  AppError,
  ErrorTypes,
  asyncHandler,
  errorHandler,
  notFoundHandler,
};
