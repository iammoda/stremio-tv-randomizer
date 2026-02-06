const express = require('express');
const path = require('path');

const router = express.Router();

/**
 * Install page
 */
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/**
 * Settings/configuration page
 */
router.get('/myshows', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'myshows.html'));
});

/**
 * Configure redirect (from Stremio)
 */
router.get('/configure', (req, res) => {
  const params = new URLSearchParams(req.query).toString();
  res.redirect(params ? `/myshows?${params}` : '/myshows');
});

/**
 * Settings alias
 */
router.get('/settings', (req, res) => {
  res.redirect('/myshows');
});

module.exports = router;
