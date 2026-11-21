const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// One connection per db path, kept open for the process lifetime.
// Opening a fresh connection per call leaked fds (EMFILE risk) and re-ran DDL.
const connections = new Map();

function openSqlite(dbPath) {
    const cached = connections.get(dbPath);
    if (cached) return cached;

    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    connections.set(dbPath, db);
    return db;
}

function closeSqlite(dbPath) {
    const db = connections.get(dbPath);
    if (!db) return false;
    connections.delete(dbPath);
    db.close();
    return true;
}

module.exports = { openSqlite, closeSqlite };
