const fs = require('fs');
const path = require('path');
const { getDb, paths: dbPaths } = require('./db');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'levels.json');

let migrated = false;

function migrateFromJsonIfNeeded() {
    if (migrated) return;

    const db = getDb();

    let hasAny = false;
    try {
        const row = db.prepare('SELECT 1 FROM user_stats LIMIT 1').get();
        hasAny = !!row;
    } catch {
        hasAny = false;
    }
    if (hasAny) {
        migrated = true;
        return;
    }

    if (!fs.existsSync(dataFile)) {
        migrated = true;
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    } catch (err) {
        console.error('[levelsStore] Failed to read/parse levels.json for migration, will retry later:', err);
        return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.guilds || typeof parsed.guilds !== 'object') {
        migrated = true;
        return;
    }

    const now = Date.now();
    const insert = db.prepare(`
        INSERT OR REPLACE INTO user_stats (guild_id, user_id, xp, level, luna_points, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
        for (const [guildId, guildObj] of Object.entries(parsed.guilds)) {
            const users = guildObj && typeof guildObj === 'object' ? guildObj.users : null;
            if (!users || typeof users !== 'object') continue;
            for (const [userId, stats] of Object.entries(users)) {
                const xp = Math.max(0, Math.floor(Number(stats && stats.xp) || 0));
                const level = Math.max(0, Math.floor(Number(stats && stats.level) || 0));
                const lunaPoints = Math.max(0, Math.floor(Number(stats && stats.lunaPoints) || 0));
                insert.run(String(guildId), String(userId), xp, level, lunaPoints, now);
            }
        }
    });

    try {
        tx();
        migrated = true;
    } catch (err) {
        // Leave migrated = false so a later call retries; the transaction rolled back.
        console.error('[levelsStore] JSON→SQLite migration failed, will retry later:', err);
    }
}

function getUserStats(guildId, userId) {
    migrateFromJsonIfNeeded();

    const db = getDb();
    const g = String(guildId);
    const u = String(userId);

    const row = db.prepare('SELECT xp, level, luna_points FROM user_stats WHERE guild_id = ? AND user_id = ?').get(g, u);
    if (!row) {
        const base = { xp: 0, level: 0, lunaPoints: 0 };
        db.prepare('INSERT INTO user_stats (guild_id, user_id, xp, level, luna_points, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(g, u, 0, 0, 0, Date.now());
        return base;
    }

    const xp = Math.max(0, Math.floor(Number(row.xp) || 0));
    const level = Math.max(0, Math.floor(Number(row.level) || 0));
    const lunaPoints = Math.max(0, Math.floor(Number(row.luna_points) || 0));
    return { xp, level, lunaPoints };
}

function updateUserStats(guildId, userId, updater) {
    migrateFromJsonIfNeeded();

    const db = getDb();
    const g = String(guildId);
    const u = String(userId);

    const current = getUserStats(g, u);
    const nextRaw = updater({ ...current }) || current;
    const next = {
        xp: Math.max(0, Math.floor(Number(nextRaw.xp) || 0)),
        level: Math.max(0, Math.floor(Number(nextRaw.level) || 0)),
        lunaPoints: Math.max(0, Math.floor(Number(nextRaw.lunaPoints) || 0))
    };

    db.prepare(`
        INSERT OR REPLACE INTO user_stats (guild_id, user_id, xp, level, luna_points, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(g, u, next.xp, next.level, next.lunaPoints, Date.now());

    return next;
}

function getGuildUsers(guildId) {
    migrateFromJsonIfNeeded();

    const db = getDb();
    const g = String(guildId);

    const rows = db.prepare('SELECT user_id, xp, level, luna_points FROM user_stats WHERE guild_id = ?').all(g);
    const out = {};
    for (const r of rows) {
        out[String(r.user_id)] = {
            xp: Math.max(0, Math.floor(Number(r.xp) || 0)),
            level: Math.max(0, Math.floor(Number(r.level) || 0)),
            lunaPoints: Math.max(0, Math.floor(Number(r.luna_points) || 0))
        };
    }
    return out;
}

function getLunaPoints(guildId, userId) {
    const s = getUserStats(guildId, userId);
    return typeof s.lunaPoints === 'number' && !Number.isNaN(s.lunaPoints) ? s.lunaPoints : 0;
}

function addLunaPoints(guildId, userId, amount) {
    const add = Math.max(0, Math.floor(Number(amount) || 0));
    return updateUserStats(guildId, userId, (s) => {
        const next = { ...s };
        next.lunaPoints = (typeof next.lunaPoints === 'number' ? next.lunaPoints : 0) + add;
        return next;
    });
}

function spendLunaPoints(guildId, userId, amount) {
    const cost = Math.max(0, Math.floor(Number(amount) || 0));
    let ok = false;
    const next = updateUserStats(guildId, userId, (s) => {
        const current = typeof s.lunaPoints === 'number' ? s.lunaPoints : 0;
        if (current < cost) {
            ok = false;
            return s;
        }
        ok = true;
        return { ...s, lunaPoints: current - cost };
    });
    return { ok, stats: next };
}

function transferLunaPoints(guildId, fromUserId, toUserId, amount, taxRate = 0) {
    const raw = Math.max(0, Math.floor(Number(amount) || 0));
    const rate = Math.max(0, Math.min(0.5, Number(taxRate) || 0));
    const tax = Math.floor(raw * rate);
    const net = raw - tax;

    const spend = spendLunaPoints(guildId, fromUserId, raw);
    if (!spend.ok) {
        return { ok: false, reason: 'insufficient_funds', tax, net };
    }
    addLunaPoints(guildId, toUserId, net);
    return { ok: true, tax, net };
}

module.exports = {
    getUserStats,
    updateUserStats,
    getGuildUsers,
    getLunaPoints,
    addLunaPoints,
    spendLunaPoints,
    transferLunaPoints,
    _paths: { dataFile, dbFile: dbPaths.dbFile }
};
