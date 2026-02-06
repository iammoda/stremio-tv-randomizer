/**
 * TV Show Randomizer - Stremio Addon
 * 
 * Main entry point for the application.
 * This file sets up the Express server and registers all routes.
 */

const express = require('express');
const cors = require('cors');
const http = require('http');

const { PORT } = require('./config');
const { registerRoutes } = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static('public'));

// Register all routes
registerRoutes(app);

// Error handling (must be after routes)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server if run directly
if (require.main === module) {
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TV Randomizer Addon running on http://localhost:${PORT}`);
    console.log(`Settings page: http://localhost:${PORT}/myshows`);
    console.log(`Install in Stremio: http://localhost:${PORT}/`);
  });
}

module.exports = app;
