/**
 * Decode HTML entities to their character equivalents
 */
function decodeHtmlEntities(value) {
  if (!value) return '';
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (match, code) => {
      const parsed = Number(code);
      if (!Number.isFinite(parsed)) return match;
      return String.fromCharCode(parsed);
    });
}

/**
 * Strip HTML tags from a string and decode entities
 */
function stripHtml(value) {
  if (!value) return '';
  const withSpaces = value.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ');
  const noTags = withSpaces.replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(noTags).replace(/\s+/g, ' ').trim();
}

/**
 * Normalize text for comparison (lowercase, single spaces, trimmed)
 */
function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = {
  decodeHtmlEntities,
  stripHtml,
  normalizeText,
};
