// مخزن التكتات — مصدر الحقيقة لحالة التكتات (بدل الاعتماد على topic القناة).
// الملف: data/bot.sqlite (نفس قاعدة البيانات المشتركة عبر ../db).
const { getDb } = require('../db');

let schemaReady = false;

function tdb() {
    const db = getDb();
    if (schemaReady) return db;
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            channel_id TEXT UNIQUE,
            opener_id TEXT,
            type TEXT,
            status TEXT DEFAULT 'open',
            claimed_by TEXT,
            claimed_at INTEGER,
            closed_at INTEGER,
            closed_by INTEGER,
            no_response_warned_at INTEGER,
            created_at INTEGER,
            meta_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id, status);
        CREATE INDEX IF NOT EXISTS idx_tickets_guild_created ON tickets(guild_id, created_at);
    `);
    schemaReady = true;
    return db;
}

function safeParse(json) {
    try {
        const parsed = JSON.parse(json || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
        // fall through
    }
    return {};
}

function rowToTicket(r) {
    if (!r) return null;
    return {
        id: Number(r.id) || 0,
        guildId: String(r.guild_id || ''),
        channelId: String(r.channel_id || ''),
        openerId: String(r.opener_id || ''),
        type: String(r.type || ''),
        status: String(r.status || 'open'),
        claimedBy: r.claimed_by ? String(r.claimed_by) : null,
        claimedAt: Number(r.claimed_at) || 0,
        closedAt: Number(r.closed_at) || 0,
        closedBy: r.closed_by ? String(r.closed_by) : null,
        noResponseWarnedAt: Number(r.no_response_warned_at) || 0,
        createdAt: Number(r.created_at) || 0,
        meta: safeParse(r.meta_json)
    };
}

function getTicket(id) {
    const db = tdb();
    const r = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Math.floor(Number(id) || 0));
    return rowToTicket(r);
}

function getByChannel(channelId) {
    const db = tdb();
    const r = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(String(channelId || ''));
    return rowToTicket(r);
}

function createTicket({ guildId, channelId, openerId = '', type = '', status = 'open', createdAt = Date.now(), meta = null } = {}) {
    const db = tdb();
    const cid = String(channelId || '');
    if (!cid) return null;

    const existing = getByChannel(cid);
    if (existing) return existing;

    const metaJson = meta && typeof meta === 'object' && !Array.isArray(meta) ? JSON.stringify(meta) : '{}';
    const res = db.prepare(`
        INSERT OR IGNORE INTO tickets (guild_id, channel_id, opener_id, type, status, created_at, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        guildId ? String(guildId) : null,
        cid,
        openerId ? String(openerId) : '',
        type ? String(type) : '',
        String(status || 'open'),
        Math.floor(Number(createdAt) || Date.now()),
        metaJson
    );
    if (res && res.changes > 0) return getTicket(res.lastInsertRowid);
    return getByChannel(cid);
}

// patch: حقول camelCase مختصرة — تُحدَّث فقط اللي موجودة بالـ patch.
// المسموح: guildId, openerId, type, status, claimedBy, claimedAt, closedAt,
// closedBy, noResponseWarnedAt, createdAt, meta
const PATCH_COLUMNS = {
    guildId: 'guild_id',
    openerId: 'opener_id',
    type: 'type',
    status: 'status',
    claimedBy: 'claimed_by',
    claimedAt: 'claimed_at',
    closedAt: 'closed_at',
    closedBy: 'closed_by',
    noResponseWarnedAt: 'no_response_warned_at',
    createdAt: 'created_at'
};

function updateTicket(channelOrId, patch = {}) {
    const db = tdb();
    let row = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(String(channelOrId || ''));
    if (!row) {
        row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Math.floor(Number(channelOrId) || 0));
    }
    if (!row) return null;

    const sets = [];
    const values = [];
    for (const [key, col] of Object.entries(PATCH_COLUMNS)) {
        if (!(key in patch)) continue;
        const v = patch[key];
        sets.push(`${col} = ?`);
        if (v === null || v === undefined) {
            values.push(null);
        } else if (typeof v === 'number') {
            values.push(Math.floor(v));
        } else {
            values.push(String(v));
        }
    }
    if ('meta' in patch) {
        const m = patch.meta;
        sets.push('meta_json = ?');
        values.push(m && typeof m === 'object' && !Array.isArray(m) ? JSON.stringify(m) : '{}');
    }
    if (!sets.length) return rowToTicket(row);

    values.push(row.id);
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return getTicket(row.id);
}

function listActive(guildId) {
    const db = tdb();
    const rows = db.prepare(`
        SELECT * FROM tickets
        WHERE guild_id = ? AND status = 'open'
        ORDER BY created_at DESC
    `).all(String(guildId || ''));
    return rows.map(rowToTicket);
}

// يحذف التكتات المغلقة/المحذوفة الأقدم من olderThanMs (بالمللي ثانية).
function pruneClosed(guildId, olderThanMs = 0) {
    const db = tdb();
    const cutoff = Date.now() - Math.max(0, Math.floor(Number(olderThanMs) || 0));
    const res = db.prepare(`
        DELETE FROM tickets
        WHERE guild_id = ?
          AND status != 'open'
          AND COALESCE(closed_at, created_at, 0) <= ?
    `).run(String(guildId || ''), cutoff);
    return res && typeof res.changes === 'number' ? res.changes : 0;
}

// حفظ meta كامل للقناة (upsert مفتاحه channel_id) — تستخدمه ticketsService.
function saveTicketMeta({ channelId, guildId = null } = {}, meta = {}) {
    const db = tdb();
    const cid = String(channelId || '');
    if (!cid) return null;

    const m = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
    const closed = m.closed === true;
    const deleted = m.deleted === true;
    const status = deleted ? 'deleted' : (closed ? 'closed' : 'open');

    const num = (v) => (Number(v) ? Math.floor(Number(v)) : null);
    const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));

    const fields = {
        guild_id: guildId ? String(guildId) : null,
        opener_id: str(m.ownerId) || str(m.openerId),
        type: str(m.typeId) || str(m.type),
        status,
        claimed_by: str(m.claimedBy),
        claimed_at: num(m.claimedAt),
        closed_at: closed ? (num(m.closedAt) || Date.now()) : null,
        closed_by: closed ? str(m.closedBy) : null,
        no_response_warned_at: num(m.noResponseWarnedAt),
        created_at: num(m.createdAt) || num(m.openedAt) || Date.now(),
        meta_json: JSON.stringify(m)
    };

    const cols = Object.keys(fields);
    const placeholders = cols.map(() => '?').join(', ');
    const updates = cols
        .filter((c) => c !== 'channel_id')
        .map((c) => `${c} = excluded.${c}`)
        .join(', ');

    db.prepare(`
        INSERT INTO tickets (channel_id, ${cols.join(', ')})
        VALUES (?, ${placeholders})
        ON CONFLICT(channel_id) DO UPDATE SET ${updates}
    `).run(cid, ...cols.map((c) => fields[c]));

    return getByChannel(cid);
}

// ── نسخ احتياطي / استعادة (تستخدمها commands/backup.js) ──
function exportForGuild(guildId) {
    const db = tdb();
    return db.prepare('SELECT * FROM tickets WHERE guild_id = ?').all(String(guildId || ''));
}

function importRows(rows, targetGuildId) {
    const db = tdb();
    const list = Array.isArray(rows) ? rows.filter((r) => r && r.channel_id) : [];
    if (!list.length) return 0;
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO tickets
            (id, guild_id, channel_id, opener_id, type, status, claimed_by, claimed_at, closed_at, closed_by, no_response_warned_at, created_at, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((items) => {
        let n = 0;
        for (const r of items) {
            stmt.run(
                Number(r.id) || null,
                targetGuildId ? String(targetGuildId) : (r.guild_id ? String(r.guild_id) : null),
                String(r.channel_id),
                r.opener_id ? String(r.opener_id) : '',
                r.type ? String(r.type) : '',
                String(r.status || 'open'),
                r.claimed_by ? String(r.claimed_by) : null,
                Number(r.claimed_at) || null,
                Number(r.closed_at) || null,
                r.closed_by !== null && r.closed_by !== undefined ? String(r.closed_by) : null,
                Number(r.no_response_warned_at) || null,
                Number(r.created_at) || Date.now(),
                r.meta_json ? String(r.meta_json) : '{}'
            );
            n++;
        }
        return n;
    });
    return tx(list);
}

function deleteByChannel(channelId) {
    const db = tdb();
    const res = db.prepare('DELETE FROM tickets WHERE channel_id = ?').run(String(channelId || ''));
    return res && typeof res.changes === 'number' ? res.changes : 0;
}

module.exports = {
    getTicket,
    getByChannel,
    createTicket,
    updateTicket,
    listActive,
    pruneClosed,
    saveTicketMeta,
    exportForGuild,
    importRows,
    deleteByChannel
};
