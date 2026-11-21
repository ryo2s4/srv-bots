// U11 — قوائم التشغيل + حفظ قائمة الانتظار (queue snapshots)
// مخزن SQLite عبر getDb() — الجداول ملكية هذا الملف.
//
// شكل المقطع المخزن:
//   { source: 'local'|'url', filePath?, url?, displayName, durationMs?, requestedBy? }

const { getDb } = require('../db');

const MAX_NAME_LEN = 60;
const MAX_TRACKS_PER_PLAYLIST = 200;

function ensureTables() {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS music_playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            name TEXT NOT NULL,
            tracks_json TEXT NOT NULL DEFAULT '[]',
            shared INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (guild_id, owner_id, name)
        );

        CREATE TABLE IF NOT EXISTS queue_snapshots (
            guild_id TEXT PRIMARY KEY,
            tracks_json TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL
        );
    `);
    return db;
}

// ---- تطبيع الأشكال ----

function normalizeTrack(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const displayName = String(raw.displayName || raw.filePath || raw.url || '').trim().slice(0, 300);
    if (!displayName) return null;

    const out = { displayName };

    const hasUrl = typeof raw.url === 'string' && raw.url.trim();
    const hasFile = typeof raw.filePath === 'string' && raw.filePath.trim();
    const source = raw.source === 'url' || raw.source === 'local'
        ? raw.source
        : (hasUrl ? 'url' : 'local');

    if (source === 'url') {
        if (!hasUrl) return null;
        out.source = 'url';
        out.url = String(raw.url).trim().slice(0, 2000);
    } else {
        if (!hasFile) return null;
        out.source = 'local';
        out.filePath = String(raw.filePath).trim();
    }

    const dur = Math.max(0, Math.floor(Number(raw.durationMs) || 0));
    if (dur) out.durationMs = dur;

    const req = raw.requestedBy == null ? null : String(raw.requestedBy).trim();
    if (req && /^\d+$/.test(req)) out.requestedBy = req;

    return out;
}

function normalizeTracks(list) {
    const out = [];
    for (const t of Array.isArray(list) ? list : []) {
        const n = normalizeTrack(t);
        if (n) out.push(n);
    }
    return out.slice(0, MAX_TRACKS_PER_PLAYLIST);
}

function tracksToJson(tracks) {
    return JSON.stringify(normalizeTracks(tracks));
}

function tracksFromJson(json) {
    let parsed;
    try {
        parsed = JSON.parse(String(json || '[]'));
    } catch {
        parsed = [];
    }
    if (!Array.isArray(parsed)) parsed = [];
    return normalizeTracks(parsed);
}

function normalizeName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LEN);
}

// ---- قوائم التشغيل ----

function savePlaylist(guildId, ownerId, name, tracks) {
    const gid = String(guildId);
    const uid = String(ownerId);
    const n = normalizeName(name);
    if (!gid || !uid || !n) return { ok: false, error: 'اسم القائمة مو صالح 3:' };

    const normalized = normalizeTracks(tracks);
    if (!normalized.length) return { ok: false, error: 'ما فيه مقاطع تحفظها بالقائمة 3:' };

    const db = ensureTables();
    const now = Date.now();
    db.prepare(`
        INSERT INTO music_playlists (guild_id, owner_id, name, tracks_json, shared, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT (guild_id, owner_id, name) DO UPDATE SET
            tracks_json = excluded.tracks_json,
            updated_at = excluded.updated_at
    `).run(gid, uid, n, JSON.stringify(normalized), now, now);

    const row = db.prepare('SELECT id, shared FROM music_playlists WHERE guild_id = ? AND owner_id = ? AND name = ?')
        .get(gid, uid, n);
    return {
        ok: true,
        id: row ? Number(row.id) : null,
        name: n,
        shared: !!(row && row.shared),
        count: normalized.length,
        tracks: normalized
    };
}

function getPlaylist(guildId, ownerId, name) {
    const gid = String(guildId);
    const uid = String(ownerId);
    const n = normalizeName(name);
    if (!gid || !uid || !n) return null;

    const db = ensureTables();
    const row = db.prepare('SELECT * FROM music_playlists WHERE guild_id = ? AND owner_id = ? AND name = ?')
        .get(gid, uid, n);
    if (!row) return null;

    return {
        id: Number(row.id),
        guildId: row.guild_id,
        ownerId: row.owner_id,
        name: row.name,
        shared: !!row.shared,
        tracks: tracksFromJson(row.tracks_json),
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0
    };
}

function deletePlaylist(guildId, ownerId, name) {
    const gid = String(guildId);
    const uid = String(ownerId);
    const n = normalizeName(name);
    if (!gid || !uid || !n) return false;

    const db = ensureTables();
    const info = db.prepare('DELETE FROM music_playlists WHERE guild_id = ? AND owner_id = ? AND name = ?')
        .run(gid, uid, n);
    return !!(info && info.changes > 0);
}

// يعرض قوائم العضو + القوائم المشتركة بالسيرفر
function listPlaylists(guildId, viewerId) {
    const gid = String(guildId);
    const uid = String(viewerId);
    if (!gid) return [];

    const db = ensureTables();
    const rows = db.prepare(`
        SELECT * FROM music_playlists
        WHERE guild_id = ? AND (owner_id = ? OR shared = 1)
        ORDER BY shared ASC, name COLLATE NOCASE ASC
        LIMIT 100
    `).all(gid, uid);

    return rows.map((r) => ({
        id: Number(r.id),
        guildId: r.guild_id,
        ownerId: r.owner_id,
        name: r.name,
        shared: !!r.shared,
        trackCount: tracksFromJson(r.tracks_json).length,
        createdAt: Number(r.created_at) || 0,
        updatedAt: Number(r.updated_at) || 0
    }));
}

function sharePlaylist(guildId, ownerId, name, shared = true) {
    const gid = String(guildId);
    const uid = String(ownerId);
    const n = normalizeName(name);
    if (!gid || !uid || !n) return { ok: false, error: 'الاسم مو صالح 3:' };

    const db = ensureTables();
    const info = db.prepare('UPDATE music_playlists SET shared = ?, updated_at = ? WHERE guild_id = ? AND owner_id = ? AND name = ?')
        .run(shared ? 1 : 0, Date.now(), gid, uid, n);
    if (!info || info.changes <= 0) return { ok: false, error: 'ما لقيت قائمة بهالاسم 3:' };
    return { ok: true, shared: !!shared };
}

// ---- حفظ/استرجاع قائمة الانتظار ----

function saveQueueSnapshot(guildId, tracks) {
    const gid = String(guildId);
    if (!gid) return false;
    try {
        const db = ensureTables();
        const normalized = normalizeTracks(tracks);
        if (!normalized.length) {
            db.prepare('DELETE FROM queue_snapshots WHERE guild_id = ?').run(gid);
            return true;
        }
        db.prepare(`
            INSERT INTO queue_snapshots (guild_id, tracks_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT (guild_id) DO UPDATE SET
                tracks_json = excluded.tracks_json,
                updated_at = excluded.updated_at
        `).run(gid, JSON.stringify(normalized), Date.now());
        return true;
    } catch {
        return false;
    }
}

function loadQueueSnapshot(guildId) {
    const gid = String(guildId);
    if (!gid) return [];
    try {
        const db = ensureTables();
        const row = db.prepare('SELECT tracks_json FROM queue_snapshots WHERE guild_id = ?').get(gid);
        return row ? tracksFromJson(row.tracks_json) : [];
    } catch {
        return [];
    }
}

function listQueueSnapshots() {
    try {
        const db = ensureTables();
        const rows = db.prepare('SELECT guild_id, tracks_json, updated_at FROM queue_snapshots ORDER BY updated_at DESC LIMIT 200').all();
        return rows.map((r) => ({
            guildId: String(r.guild_id),
            tracks: tracksFromJson(r.tracks_json),
            updatedAt: Number(r.updated_at) || 0
        }));
    } catch {
        return [];
    }
}

function deleteQueueSnapshot(guildId) {
    const gid = String(guildId);
    if (!gid) return false;
    try {
        const db = ensureTables();
        const info = db.prepare('DELETE FROM queue_snapshots WHERE guild_id = ?').run(gid);
        return !!(info && info.changes > 0);
    } catch {
        return false;
    }
}

/**
 * تُستدعى مرة وحدة بعد جاهزية البوت (client ready) — تحمّل قوائم الانتظار
 * المحفوظة داخل الجلسات بدون ما يبدأ تشغيل.
 *
 * @returns {number} عدد السيرفرات اللي رجعت لها قائمة انتظار
 */
function restoreQueues(client) {
    let restored = 0;
    try {
        const { getOrCreateVoiceSession } = require('./voiceManager'); // lazy: يمنع دورة require
        const snapshots = listQueueSnapshots();
        for (const snap of snapshots) {
            const tracks = snap.tracks.filter((t) => {
                if (t.source === 'url') return !!t.url;
                return !!t.filePath;
            });
            if (!tracks.length) continue;
            const session = getOrCreateVoiceSession(snap.guildId);
            if (Array.isArray(session.queue) && session.queue.length) continue; // فيه شغل حالي — لا نلخبط
            session.queue = tracks.map((t) => ({ ...t, requestedBy: t.requestedBy || null }));
            try {
                if (client && client.guilds && client.guilds.cache) {
                    session.guildRef = client.guilds.cache.get(snap.guildId) || session.guildRef || null;
                }
            } catch { /* ignore */ }
            restored += 1;
        }
    } catch {
        // ignore — الاسترجاع best-effort
    }
    return restored;
}

module.exports = {
    // قوائم التشغيل
    savePlaylist,
    getPlaylist,
    deletePlaylist,
    listPlaylists,
    sharePlaylist,
    // قائمة الانتظار
    saveQueueSnapshot,
    loadQueueSnapshot,
    listQueueSnapshots,
    deleteQueueSnapshot,
    restoreQueues,
    // أدوات خالصة (للاختبارات والاستخدام الداخلي)
    normalizeTrack,
    normalizeTracks,
    tracksToJson,
    tracksFromJson,
    normalizeName,
    MAX_TRACKS_PER_PLAYLIST
};
