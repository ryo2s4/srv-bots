const config = require('./config');

function formatDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function isYesterday(dateString) {
  if (!dateString) return false;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return formatDate(yesterday) === dateString;
}

function calculateProgress(pages) {
  const percent = Math.min(100, Math.round((pages / config.QURAN_PAGES) * 100));
  return `${pages} صفحة من ${config.QURAN_PAGES} (${percent}%)`;
}

module.exports = { formatDate, isYesterday, calculateProgress };
