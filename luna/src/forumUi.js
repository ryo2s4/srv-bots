const path = require('path');
const { openSqlite } = require('./utils/dbFactory');

// NOTE: src/data/ — legacy location, kept for data continuity (do not move to <root>/data/).
const dbPath = path.join(__dirname, 'data', 'forum_ui.db');

const drafts = new Map();

let db = null;

function getDb() {
    if (db) return db;
    db = openSqlite(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS forum_posts (
            post_id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            data_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_forum_posts_guild ON forum_posts(guild_id);
        CREATE INDEX IF NOT EXISTS idx_forum_posts_message ON forum_posts(message_id);
    `);
    return db;
}

function generatePostId(userId) {
    return `fp_${Date.now()}_${String(userId)}`;
}

function normalizeHexColor(input) {
    const raw = String(input || '').trim();
    if (!raw) return '#E7D3B0';
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : '#E7D3B0';
}

function parseButtonStyle(styleRaw) {
    const s = String(styleRaw || '').trim().toLowerCase();
    if (s === 'primary' || s === 'blue' || s === 'ازرق' || s === 'أزرق') return 'Primary';
    if (s === 'secondary' || s === 'gray' || s === 'grey' || s === 'رمادي') return 'Secondary';
    if (s === 'success' || s === 'green' || s === 'اخضر' || s === 'أخضر') return 'Success';
    if (s === 'danger' || s === 'red' || s === 'احمر' || s === 'أحمر') return 'Danger';
    return 'Secondary';
}

function parseButtonOptions(textRaw) {
    const lines = String(textRaw || '').split('\n').map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
        let idx = line.indexOf('=>');
        let sepLen = 2;
        if (idx === -1) {
            idx = line.indexOf('|');
            sepLen = 1;
        }
        if (idx === -1) {
            idx = line.indexOf(':');
            sepLen = 1;
        }
        if (idx === -1) {
            idx = line.indexOf(' - ');
            sepLen = 3;
        }
        if (idx === -1) continue;

        const label = line.slice(0, idx).trim();
        const response = line.slice(idx + sepLen).trim();
        if (!label || !response) continue;
        out.push({ label: label.slice(0, 100), response: response.slice(0, 1900) });
        if (out.length >= 25) break;
    }
    return out;
}

function savePublishedPost({ postId, guildId, channelId, messageId, createdBy, data }) {
    const db = getDb();
    db.prepare(`
        INSERT OR REPLACE INTO forum_posts (post_id, guild_id, channel_id, message_id, created_by, created_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        String(postId),
        String(guildId),
        String(channelId),
        String(messageId),
        String(createdBy),
        Date.now(),
        JSON.stringify(data || {})
    );
}

function getPostById(postId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM forum_posts WHERE post_id = ?').get(String(postId));
    if (!row) return null;
    let data = {};
    try { data = JSON.parse(row.data_json || '{}'); } catch { data = {}; }
    return { ...row, data };
}

function createDraft({ guildId, userId }) {
    const postId = generatePostId(userId);
    const draft = {
        postId,
        guildId: String(guildId),
        ownerId: String(userId),
        createdAt: Date.now(),
        embed: {
            title: '📰 إعلان',
            description: 'اكتب المحتوى هنا...',
            color: '#E7D3B0'
        },
        buttons: []
    };
    drafts.set(postId, draft);
    return draft;
}

function getDraft(postId) {
    return drafts.get(String(postId)) || null;
}

function updateDraft(postId, patch) {
    const current = getDraft(postId);
    if (!current) return null;
    const next = { ...current, ...(patch || {}) };
    drafts.set(String(postId), next);
    return next;
}

function deleteDraft(postId) {
    drafts.delete(String(postId));
}

module.exports = {
    getDb,
    generatePostId,
    normalizeHexColor,
    parseButtonStyle,
    parseButtonOptions,
    savePublishedPost,
    getPostById,
    createDraft,
    getDraft,
    updateDraft,
    deleteDraft
};
