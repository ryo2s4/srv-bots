// مخزن المخالفات والاستئنافات — مصدر موحّد لكل العقوبات المسجلة.
// الملف: data/bot.sqlite (نفس قاعدة البيانات المشتركة عبر ../db).
const { getDb } = require('../db');

let schemaReady = false;

function idb() {
    const db = getDb();
    if (schemaReady) return db;
    db.exec(`
        CREATE TABLE IF NOT EXISTS infractions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            user_id TEXT,
            moderator_id TEXT,
            type TEXT,
            reason TEXT,
            duration_minutes INTEGER DEFAULT 0,
            created_at INTEGER,
            expires_at INTEGER,
            active INTEGER DEFAULT 1,
            case_ref INTEGER,
            appeal_id INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_infractions_guild_user ON infractions(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_infractions_guild_created ON infractions(guild_id, created_at);

        CREATE TABLE IF NOT EXISTS appeals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            user_id TEXT,
            infraction_id INTEGER,
            reason TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
            created_at INTEGER,
            resolved_at INTEGER,
            resolver_id TEXT,
            resolution_note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_appeals_guild_user ON appeals(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_appeals_infraction ON appeals(infraction_id);
    `);
    schemaReady = true;
    return db;
}

function rowToInfraction(r) {
    if (!r) return null;
    return {
        id: Number(r.id) || 0,
        guildId: String(r.guild_id || ''),
        userId: String(r.user_id || ''),
        moderatorId: String(r.moderator_id || ''),
        type: String(r.type || ''),
        reason: String(r.reason || ''),
        durationMinutes: Number(r.duration_minutes) || 0,
        createdAt: Number(r.created_at) || 0,
        expiresAt: Number(r.expires_at) || 0,
        active: Number(r.active) === 1,
        caseRef: r.case_ref !== null && r.case_ref !== undefined ? Number(r.case_ref) : null,
        appealId: r.appeal_id !== null && r.appeal_id !== undefined ? Number(r.appeal_id) : null
    };
}

function rowToAppeal(r) {
    if (!r) return null;
    return {
        id: Number(r.id) || 0,
        guildId: String(r.guild_id || ''),
        userId: String(r.user_id || ''),
        infractionId: Number(r.infraction_id) || 0,
        reason: String(r.reason || ''),
        status: String(r.status || 'pending'),
        createdAt: Number(r.created_at) || 0,
        resolvedAt: Number(r.resolved_at) || 0,
        resolverId: r.resolver_id ? String(r.resolver_id) : null,
        resolutionNote: r.resolution_note ? String(r.resolution_note) : null
    };
}

// ── المخالفات ──
function addInfraction({ guildId, userId, moderatorId = '', type = '', reason = '', durationMinutes = 0, createdAt = Date.now(), expiresAt = null, caseRef = null, active = 1 } = {}) {
    const db = idb();
    const ts = Math.floor(Number(createdAt) || Date.now());
    const dur = Math.max(0, Math.floor(Number(durationMinutes) || 0));
    const exp = Number(expiresAt) ? Math.floor(Number(expiresAt)) : (dur > 0 ? ts + dur * 60_000 : null);
    const res = db.prepare(`
        INSERT INTO infractions (guild_id, user_id, moderator_id, type, reason, duration_minutes, created_at, expires_at, active, case_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        String(guildId || ''),
        String(userId || ''),
        String(moderatorId || ''),
        String(type || ''),
        String(reason || ''),
        dur,
        ts,
        exp,
        active ? 1 : 0,
        caseRef !== null && caseRef !== undefined ? Math.floor(Number(caseRef)) : null
    );
    return res && res.lastInsertRowid ? Number(res.lastInsertRowid) : null;
}

function getInfraction(id) {
    const db = idb();
    const r = db.prepare('SELECT * FROM infractions WHERE id = ?').get(Math.floor(Number(id) || 0));
    return rowToInfraction(r);
}

// يلاقي العقوبة اللي يقصدها المستخدم بالـ case رقم (case_ref أولًا، بعدين id).
function findInfractionForCase(guildId, userId, caseId) {
    const db = idb();
    const n = Math.floor(Number(caseId) || 0);
    if (!n) return null;
    const byRef = db.prepare(`
        SELECT * FROM infractions WHERE guild_id = ? AND user_id = ? AND case_ref = ?
        ORDER BY id DESC LIMIT 1
    `).get(String(guildId || ''), String(userId || ''), n);
    if (byRef) return rowToInfraction(byRef);
    const byId = db.prepare(`
        SELECT * FROM infractions WHERE guild_id = ? AND user_id = ? AND id = ?
        LIMIT 1
    `).get(String(guildId || ''), String(userId || ''), n);
    return rowToInfraction(byId);
}

function listInfractions(guildId, userId, { includeInactive = true, limit = 50, offset = 0 } = {}) {
    const db = idb();
    const rows = db.prepare(`
        SELECT * FROM infractions
        WHERE guild_id = ? AND user_id = ? ${includeInactive ? '' : 'AND active = 1'}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(
        String(guildId || ''),
        String(userId || ''),
        Math.max(1, Math.min(500, Math.floor(Number(limit) || 50))),
        Math.max(0, Math.floor(Number(offset) || 0))
    );
    return rows.map(rowToInfraction);
}

function countInfractions(guildId, userId, { activeOnly = false } = {}) {
    const db = idb();
    const row = db.prepare(`
        SELECT COUNT(*) AS n FROM infractions
        WHERE guild_id = ? AND user_id = ? ${activeOnly ? 'AND active = 1' : ''}
    `).get(String(guildId || ''), String(userId || ''));
    return row ? Number(row.n) || 0 : 0;
}

function setInfractionActive(id, active = true) {
    const db = idb();
    const res = db.prepare('UPDATE infractions SET active = ? WHERE id = ?')
        .run(active ? 1 : 0, Math.floor(Number(id) || 0));
    return res && typeof res.changes === 'number' ? res.changes > 0 : false;
}

function linkAppeal(infractionId, appealId) {
    const db = idb();
    const res = db.prepare('UPDATE infractions SET appeal_id = ? WHERE id = ?')
        .run(Math.floor(Number(appealId) || 0), Math.floor(Number(infractionId) || 0));
    return res && typeof res.changes === 'number' ? res.changes > 0 : false;
}

// ── الاستئنافات ──

// ينشئ استئنافًا مربوطًا بمخالفة. يرفض التكرار (استئناف pending واحد لكل مخالفة).
// يرجع { ok, appeal?, error? } — error: 'no_infraction' | 'duplicate' | 'bad_input'
function createAppeal({ guildId, userId, infractionId, reason, createdAt = Date.now() } = {}) {
    const db = idb();
    const infId = Math.floor(Number(infractionId) || 0);
    const uid = String(userId || '');
    const gid = String(guildId || '');
    const text = String(reason || '').trim();
    if (!infId || !uid || !gid || !text) return { ok: false, error: 'bad_input' };

    const infraction = getInfraction(infId);
    if (!infraction || infraction.guildId !== gid) return { ok: false, error: 'no_infraction' };

    const pending = pendingAppealForInfraction(infId);
    if (pending) return { ok: false, error: 'duplicate', appeal: pending };

    const res = db.prepare(`
        INSERT INTO appeals (guild_id, user_id, infraction_id, reason, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(gid, uid, infId, text.slice(0, 1000), Math.floor(Number(createdAt) || Date.now()));

    const appealId = res && res.lastInsertRowid ? Number(res.lastInsertRowid) : null;
    if (appealId) linkAppeal(infId, appealId);
    return { ok: true, appeal: appealId ? getAppeal(appealId) : null };
}

function getAppeal(id) {
    const db = idb();
    const r = db.prepare('SELECT * FROM appeals WHERE id = ?').get(Math.floor(Number(id) || 0));
    return rowToAppeal(r);
}

function pendingAppealForInfraction(infractionId) {
    const db = idb();
    const r = db.prepare(`
        SELECT * FROM appeals WHERE infraction_id = ? AND status = 'pending'
        ORDER BY id DESC LIMIT 1
    `).get(Math.floor(Number(infractionId) || 0));
    return rowToAppeal(r);
}

function listAppeals({ guildId = null, userId = null, infractionId = null, status = null, limit = 50, offset = 0 } = {}) {
    const db = idb();
    const where = [];
    const values = [];
    if (guildId) { where.push('guild_id = ?'); values.push(String(guildId)); }
    if (userId) { where.push('user_id = ?'); values.push(String(userId)); }
    if (infractionId) { where.push('infraction_id = ?'); values.push(Math.floor(Number(infractionId) || 0)); }
    if (status) { where.push('status = ?'); values.push(String(status)); }
    const rows = db.prepare(`
        SELECT * FROM appeals
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(...values, Math.max(1, Math.min(500, Math.floor(Number(limit) || 50))), Math.max(0, Math.floor(Number(offset) || 0)));
    return rows.map(rowToAppeal);
}

// يغلق الاستئناف (accepted/rejected). القبول يلغي المخالفة تلقائيًا (active=0)
// إلا إذا deactivateInfraction = false.
function resolveAppeal(id, { status = 'accepted', resolverId = null, note = null, deactivateInfraction = true } = {}) {
    const db = idb();
    const appealId = Math.floor(Number(id) || 0);
    const st = String(status) === 'rejected' ? 'rejected' : 'accepted';
    const appeal = getAppeal(appealId);
    if (!appeal) return null;
    if (appeal.status !== 'pending') return appeal;

    db.prepare(`
        UPDATE appeals
        SET status = ?, resolved_at = ?, resolver_id = ?, resolution_note = ?
        WHERE id = ? AND status = 'pending'
    `).run(
        st,
        Date.now(),
        resolverId ? String(resolverId) : null,
        note ? String(note).slice(0, 500) : null,
        appealId
    );

    if (st === 'accepted' && deactivateInfraction !== false && appeal.infractionId) {
        setInfractionActive(appeal.infractionId, false);
    }

    return getAppeal(appealId);
}

// ── نسخ احتياطي / استعادة (تستخدمها commands/backup.js) ──
function exportForGuild(guildId) {
    const db = idb();
    const gid = String(guildId || '');
    return {
        infractions: db.prepare('SELECT * FROM infractions WHERE guild_id = ?').all(gid),
        appeals: db.prepare('SELECT * FROM appeals WHERE guild_id = ?').all(gid)
    };
}

// يعيد المخالفات والاستئنافات (INSERT OR REPLACE بنفس الـ ids) مع إعادة كتابة guild_id للسيرفر الهدف.
function importForGuild(guildId, data = {}) {
    const db = idb();
    const gid = String(guildId || '');
    const infRows = data && Array.isArray(data.infractions) ? data.infractions : [];
    const appRows = data && Array.isArray(data.appeals) ? data.appeals : [];

    const infStmt = db.prepare(`
        INSERT OR REPLACE INTO infractions
            (id, guild_id, user_id, moderator_id, type, reason, duration_minutes, created_at, expires_at, active, case_ref, appeal_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const appStmt = db.prepare(`
        INSERT OR REPLACE INTO appeals
            (id, guild_id, user_id, infraction_id, reason, status, created_at, resolved_at, resolver_id, resolution_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
        let infractions = 0;
        let appeals = 0;
        for (const r of infRows) {
            if (!r || !r.user_id) continue;
            infStmt.run(
                Number(r.id) || null,
                gid,
                String(r.user_id),
                r.moderator_id ? String(r.moderator_id) : '',
                r.type ? String(r.type) : '',
                r.reason ? String(r.reason) : '',
                Number(r.duration_minutes) || 0,
                Number(r.created_at) || Date.now(),
                Number(r.expires_at) || null,
                r.active === 0 || r.active === false ? 0 : 1,
                r.case_ref !== null && r.case_ref !== undefined ? Number(r.case_ref) : null,
                r.appeal_id !== null && r.appeal_id !== undefined ? Number(r.appeal_id) : null
            );
            infractions++;
        }
        for (const r of appRows) {
            if (!r || !r.user_id) continue;
            const st = ['pending', 'accepted', 'rejected'].includes(String(r.status)) ? String(r.status) : 'pending';
            appStmt.run(
                Number(r.id) || null,
                gid,
                String(r.user_id),
                Number(r.infraction_id) || null,
                r.reason ? String(r.reason) : '',
                st,
                Number(r.created_at) || Date.now(),
                Number(r.resolved_at) || null,
                r.resolver_id ? String(r.resolver_id) : null,
                r.resolution_note ? String(r.resolution_note) : null
            );
            appeals++;
        }
        return { infractions, appeals };
    });

    return tx();
}

module.exports = {
    addInfraction,
    getInfraction,
    findInfractionForCase,
    listInfractions,
    countInfractions,
    setInfractionActive,
    linkAppeal,
    createAppeal,
    getAppeal,
    pendingAppealForInfraction,
    listAppeals,
    resolveAppeal,
    exportForGuild,
    importForGuild
};
