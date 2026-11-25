const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'bot.sqlite');

let db;

function ensureDataDir() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function getUserMemory(_guildId, userId) {
    const db = getDb();
    const uid = String(userId);
    const row = db.prepare('SELECT profile_json, updated_at FROM user_memory_global WHERE user_id = ?')
        .get(uid);
    if (!row) return null;
    let profile;
    try {
        profile = JSON.parse(row.profile_json);
    } catch {
        profile = null;
    }
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) profile = {};
    return {
        profile,
        updatedAt: Number(row.updated_at) || 0
    };
}

function upsertUserMemory(_guildId, userId, profile, updatedAt = Date.now()) {
    const db = getDb();
    const uid = String(userId);
    const safeProfile = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
    db.prepare(`
        INSERT OR REPLACE INTO user_memory_global (user_id, profile_json, updated_at)
        VALUES (?, ?, ?)
    `).run(
        uid,
        JSON.stringify(safeProfile),
        Math.floor(Number(updatedAt) || Date.now())
    );
    return true;
}

function getDb() {
    if (db) return db;
    ensureDataDir();

    // Lazy require so the bot can show a clear error if dependency is missing
    // rather than crashing on startup without context.
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');

    db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Wait for concurrent writers (other shards/processes) instead of failing.
    db.pragma('busy_timeout = 5000');

    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_config (
            guild_id TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_memory_global (
            user_id TEXT PRIMARY KEY,
            profile_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_memory (
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            messages_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            reset_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, channel_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS user_stats (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 0,
            luna_points INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS shop_store (
            guild_id TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_tasks (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            day_key TEXT NOT NULL,
            progress_json TEXT NOT NULL,
            claimed_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id, day_key)
        );

        CREATE TABLE IF NOT EXISTS warnings (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            moderator_id TEXT NOT NULL,
            moderator_tag TEXT NOT NULL,
            reason TEXT NOT NULL,
            PRIMARY KEY (guild_id, user_id, created_at)
        );

        CREATE TABLE IF NOT EXISTS events_history (
            guild_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            type TEXT NOT NULL,
            reward INTEGER NOT NULL DEFAULT 0,
            winners_json TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            meta_json TEXT NOT NULL,
            PRIMARY KEY (guild_id, created_at)
        );

        CREATE TABLE IF NOT EXISTS profile_web_tokens (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
    `);

    // Best-effort migration from legacy per-guild user_memory -> user_memory_global
    try {
        const hasOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_memory'").get();
        if (hasOld) {
            const rows = db.prepare('SELECT user_id, profile_json, updated_at FROM user_memory').all();
            for (const r of rows) {
                const userId = String(r.user_id || '');
                if (!userId) continue;
                const updatedAt = Math.floor(Number(r.updated_at) || 0);
                const profileJson = String(r.profile_json || '{}');

                // If an entry already exists, keep the newest updatedAt and merge shallowly.
                const existing = db.prepare('SELECT profile_json, updated_at FROM user_memory_global WHERE user_id = ?').get(userId);
                if (!existing) {
                    db.prepare('INSERT OR REPLACE INTO user_memory_global (user_id, profile_json, updated_at) VALUES (?, ?, ?)')
                        .run(userId, profileJson, updatedAt || Date.now());
                } else {
                    let a = {};
                    let b = {};
                    try { a = JSON.parse(String(existing.profile_json || '{}')); } catch { a = {}; }
                    try { b = JSON.parse(profileJson); } catch { b = {}; }
                    if (!a || typeof a !== 'object' || Array.isArray(a)) a = {};
                    if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
                    const merged = { ...a, ...b };
                    const nextUpdatedAt = Math.max(Math.floor(Number(existing.updated_at) || 0), updatedAt || 0, Date.now());
                    db.prepare('UPDATE user_memory_global SET profile_json = ?, updated_at = ? WHERE user_id = ?')
                        .run(JSON.stringify(merged), nextUpdatedAt, userId);
                }
            }
        }
    } catch {
        // ignore
    }

    return db;
}

function getAiMemoryEntry(guildId, channelId, userId) {
    const db = getDb();
    const row = db.prepare('SELECT messages_json, updated_at, reset_at FROM ai_memory WHERE guild_id = ? AND channel_id = ? AND user_id = ?')
        .get(String(guildId), String(channelId), String(userId));
    if (!row) return null;
    let messages;
    try {
        messages = JSON.parse(row.messages_json);
    } catch {
        messages = null;
    }
    if (!Array.isArray(messages)) messages = [];
    return {
        messages,
        updatedAt: Number(row.updated_at) || 0,
        resetAt: Number(row.reset_at) || 0
    };
}

function setAiMemoryEntry(guildId, channelId, userId, entry) {
    const db = getDb();
    const messages = entry && Array.isArray(entry.messages) ? entry.messages : [];
    const updatedAt = entry && typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now();
    const resetAt = entry && typeof entry.resetAt === 'number' ? entry.resetAt : 0;

    db.prepare(`
        INSERT OR REPLACE INTO ai_memory (guild_id, channel_id, user_id, messages_json, updated_at, reset_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        String(guildId),
        String(channelId),
        String(userId),
        JSON.stringify(messages),
        updatedAt,
        resetAt
    );
}

function clearAiMemoryForGuild(guildId) {
    const db = getDb();
    db.prepare('DELETE FROM ai_memory WHERE guild_id = ?').run(String(guildId));
}

function getDailyTasksEntry(guildId, userId, dayKey) {
    const db = getDb();
    const row = db.prepare('SELECT progress_json, claimed_at, updated_at FROM daily_tasks WHERE guild_id = ? AND user_id = ? AND day_key = ?')
        .get(String(guildId), String(userId), String(dayKey));
    if (!row) {
        return { progress: {}, claimedAt: 0, updatedAt: 0 };
    }
    let progress;
    try {
        progress = JSON.parse(row.progress_json);
    } catch {
        progress = null;
    }
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) progress = {};
    return {
        progress,
        claimedAt: Number(row.claimed_at) || 0,
        updatedAt: Number(row.updated_at) || 0
    };
}

function setDailyTasksEntry(guildId, userId, dayKey, entry) {
    const db = getDb();
    const progress = entry && entry.progress && typeof entry.progress === 'object' && !Array.isArray(entry.progress) ? entry.progress : {};
    const claimedAt = entry && typeof entry.claimedAt === 'number' ? entry.claimedAt : 0;
    const updatedAt = entry && typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now();

    db.prepare(`
        INSERT OR REPLACE INTO daily_tasks (guild_id, user_id, day_key, progress_json, claimed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        String(guildId),
        String(userId),
        String(dayKey),
        JSON.stringify(progress),
        claimedAt,
        updatedAt
    );
}

function addWarning(guildId, userId, warning) {
    const db = getDb();
    const createdAt = warning && typeof warning.createdAt === 'number' ? warning.createdAt : Date.now();
    const moderatorId = warning && warning.moderatorId ? String(warning.moderatorId) : '';
    const moderatorTag = warning && warning.moderatorTag ? String(warning.moderatorTag) : '';
    const reason = warning && warning.reason ? String(warning.reason) : '';

    if (!moderatorId || !moderatorTag || !reason) return null;

    // المفتاح الأساسي (guild,user,created_at) — نزيح الميلي ثانية إذا صار تصادم بدل ما ينرمي خطأ
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO warnings (guild_id, user_id, created_at, moderator_id, moderator_tag, reason)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    let ts = Math.floor(createdAt);
    for (let i = 0; i < 50; i++) {
        const res = stmt.run(
            String(guildId),
            String(userId),
            ts + i,
            moderatorId,
            moderatorTag.slice(0, 80),
            reason.slice(0, 1000)
        );
        if (res.changes > 0) return ts + i;
    }

    return ts;
}

function listWarnings(guildId, userId, limit = 20) {
    const db = getDb();
    const rows = db.prepare(`
        SELECT created_at, moderator_id, moderator_tag, reason
        FROM warnings
        WHERE guild_id = ? AND user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(String(guildId), String(userId), Math.max(1, Math.min(50, Math.floor(Number(limit) || 20))));

    return rows.map((r) => ({
        createdAt: Number(r.created_at) || 0,
        moderatorId: String(r.moderator_id || ''),
        moderatorTag: String(r.moderator_tag || ''),
        reason: String(r.reason || '')
    }));
}

function clearWarnings(guildId, userId) {
    const db = getDb();
    const info = db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId));
    return info && typeof info.changes === 'number' ? info.changes : 0;
}

function addEventHistory(guildId, entry) {
    const db = getDb();
    const createdAt = entry && typeof entry.createdAt === 'number' ? Math.floor(entry.createdAt) : Date.now();
    const type = entry && entry.type ? String(entry.type) : '';
    const reward = Math.max(0, Math.floor(Number(entry && entry.reward) || 0));
    const winners = entry && Array.isArray(entry.winners) ? entry.winners.map(String).filter(Boolean).slice(0, 50) : [];
    const channelId = entry && entry.channelId ? String(entry.channelId) : null;
    const messageId = entry && entry.messageId ? String(entry.messageId) : null;
    const meta = entry && entry.meta && typeof entry.meta === 'object' && !Array.isArray(entry.meta) ? entry.meta : {};

    if (!type) return null;

    db.prepare(`
        INSERT OR REPLACE INTO events_history (guild_id, created_at, type, reward, winners_json, channel_id, message_id, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        String(guildId),
        createdAt,
        type.slice(0, 40),
        reward,
        JSON.stringify(winners),
        channelId,
        messageId,
        JSON.stringify(meta)
    );

    return createdAt;
}

function listEventHistory(guildId, limit = 10) {
    const db = getDb();
    const rows = db.prepare(`
        SELECT created_at, type, reward, winners_json, channel_id, message_id, meta_json
        FROM events_history
        WHERE guild_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(String(guildId), Math.max(1, Math.min(25, Math.floor(Number(limit) || 10))));

    return rows.map((r) => {
        let winners;
        let meta;
        try {
            winners = JSON.parse(r.winners_json);
        } catch {
            winners = [];
        }
        try {
            meta = JSON.parse(r.meta_json);
        } catch {
            meta = {};
        }
        if (!Array.isArray(winners)) winners = [];
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
        return {
            createdAt: Number(r.created_at) || 0,
            type: String(r.type || ''),
            reward: Math.max(0, Math.floor(Number(r.reward) || 0)),
            winners: winners.map(String).filter(Boolean),
            channelId: r.channel_id ? String(r.channel_id) : null,
            messageId: r.message_id ? String(r.message_id) : null,
            meta
        };
    });
}

// إحصائيات الفعاليات — تُبنى من events_history
function getEventStats(guildId, { sinceTs = 0, limit = 3000 } = {}) {
    const db = getDb();
    const rows = db.prepare(`
        SELECT created_at, type, reward, winners_json
        FROM events_history
        WHERE guild_id = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(String(guildId), Math.max(0, Math.floor(Number(sinceTs) || 0)), Math.max(1, Math.min(10000, Math.floor(Number(limit) || 3000))));

    const byUser = new Map();
    const byType = new Map();
    let totalEvents = 0;
    let totalReward = 0;
    let withWinners = 0;

    for (const r of rows) {
        totalEvents++;
        totalReward += Math.max(0, Math.floor(Number(r.reward) || 0));
        const type = String(r.type || 'unknown');
        byType.set(type, (byType.get(type) || 0) + 1);

        let winners = [];
        try {
            winners = JSON.parse(r.winners_json || '[]');
        } catch {
            winners = [];
        }
        if (!Array.isArray(winners)) winners = [];
        if (winners.length) withWinners++;
        for (const w of winners) {
            const key = String(w);
            const e = byUser.get(key) || { wins: 0, reward: 0 };
            e.wins++;
            e.reward += Math.max(0, Math.floor(Number(r.reward) || 0));
            byUser.set(key, e);
        }
    }

    return { totalEvents, totalReward, withWinners, byUser, byType };
}

// فوز عضو محدد: الإجمالي + اليوم + لعبته المفضلة
function getUserEventWins(guildId, userId) {
    const db = getDb();
    const now = Date.now();
    const dayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());

    const rows = db.prepare(`
        SELECT created_at, type, winners_json
        FROM events_history
        WHERE guild_id = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 3000
    `).all(String(guildId), dayStart - 14 * 86400000);

    let total = 0;
    let today = 0;
    let week = 0;
    const types = new Map();
    const uid = String(userId);

    for (const r of rows) {
        let winners = [];
        try {
            winners = JSON.parse(r.winners_json || '[]');
        } catch {
            winners = [];
        }
        if (!Array.isArray(winners) || !winners.map(String).includes(uid)) continue;
        const ts = Number(r.created_at) || 0;
        total++;
        if (ts >= dayStart) today++;
        if (ts >= now - 7 * 86400000) week++;
        const type = String(r.type || 'unknown');
        types.set(type, (types.get(type) || 0) + 1);
    }

    let favorite = null;
    let favoriteCount = 0;
    for (const [type, count] of types) {
        if (count > favoriteCount) {
            favorite = type;
            favoriteCount = count;
        }
    }

    return { total, today, week, favorite, favoriteCount };
}

function getOrCreateProfileWebToken(guildId, userId) {
    const db = getDb();
    const gid = String(guildId);
    const uid = String(userId);
    const row = db.prepare('SELECT token FROM profile_web_tokens WHERE guild_id = ? AND user_id = ?').get(gid, uid);
    if (row && row.token) return String(row.token);

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
        const token = crypto.randomBytes(24).toString('hex');
        try {
            db.prepare(`
                INSERT INTO profile_web_tokens (guild_id, user_id, token, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(gid, uid, token, now, now);
            return token;
        } catch (err) {
            if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
            throw err;
        }
    }
    throw new Error('Failed to generate profile web token');
}

function resolveProfileWebToken(token) {
    const db = getDb();
    const t = String(token || '').trim();
    if (!t) return null;
    const row = db.prepare('SELECT guild_id, user_id, created_at, updated_at FROM profile_web_tokens WHERE token = ?').get(t);
    if (!row) return null;
    return {
        guildId: String(row.guild_id),
        userId: String(row.user_id),
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0
    };
}

module.exports = {
    getDb,
    getAiMemoryEntry,
    setAiMemoryEntry,
    clearAiMemoryForGuild,
    getUserMemory,
    upsertUserMemory,
    getDailyTasksEntry,
    setDailyTasksEntry,
    addWarning,
    listWarnings,
    clearWarnings,
    addEventHistory,
    listEventHistory,
    getEventStats,
    getUserEventWins,
    getOrCreateProfileWebToken,
    resolveProfileWebToken,
    paths: { dataDir, dbFile }
};
