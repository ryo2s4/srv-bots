require('dotenv').config();

module.exports = {
  // Owner user ID — set OWNER_ID in .env; falls back to the legacy hardcoded ID.
  OWNER_ID: process.env.OWNER_ID || '1380557535391514725',

  QURAN_PAGES: 604,
  DEFAULT_START_MINUTES: 5,
  DEFAULT_DURATION_MINUTES: 30,
  REMINDER_BEFORE_MS: 5 * 60 * 1000,

  EMBED_COLOR: 0x06b6d4,

  QUIZ_REWARD_POINTS: 10,
  POINTS_PER_PAGE: 2,
};
