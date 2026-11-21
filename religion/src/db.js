const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bot.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id            TEXT PRIMARY KEY,
    total_pages        INTEGER NOT NULL DEFAULT 0,
    points             INTEGER NOT NULL DEFAULT 0,
    streak             INTEGER NOT NULL DEFAULT 0,
    last_read_date     TEXT,
    inventory          TEXT NOT NULL DEFAULT '[]',
    completed_sessions INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    guild_id TEXT PRIMARY KEY,
    data     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    guild_id TEXT PRIMARY KEY,
    data     TEXT NOT NULL
  );
`);

module.exports = db;
