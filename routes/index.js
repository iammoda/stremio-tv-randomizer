const express = require('express');
const pagesRouter = require('./pages');
const apiRouter = require('./api');
const stremioRouter = require('./stremio');

/**
 * Register all routes on the Express app
 */
function registerRoutes(app) {
  // API routes
  app.use('/api', apiRouter);

  // Stremio addon routes (manifest, catalog, meta, stream)
  app.use('/', stremioRouter);

  // Page routes (HTML pages)
  app.use('/', pagesRouter);
}

module.exports = { registerRoutes };
