// خدمة التكتات — الحالة محفوظة بالـ DB (data/bot.sqlite عبر stores/ticketStore)
// والمصدر الحقيقي للحالة هو صف الـ tickets المربوط بـ channel.id.
// الـ topic يضل يُكتب للعرض/التوافق العكسي فقط (ولو تجاوز 1024 حرف ما يفشل حفظ الـ DB).
const ticketStore = require('./stores/ticketStore');

function normalizeTicketTypeId(name) {
    const raw = String(name || '').trim().toLowerCase();
    const cleaned = raw
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}\-_]/gu, '')
        .slice(0, 30);
    return cleaned || null;
}

// In-memory fallback for ticket meta: channel topics can silently fail to
// persist (>1024 chars, missing perms, Discord hiccup) — keep the last known
// meta per channel so claim/close/timer state doesn't desync within a session.
const metaMemory = new Map(); // channelId -> meta object

const TOPIC_PREFIX = 'luna_ticket:';

// حقول الحالة المشتقة من أعمدة الجدول — تُدمج فوق meta المحفوظ بالـ meta_json
// عشان التحديثات اللي تمر على الأعمدة مباشرة (مثل الحذف) تبان بالقراءة.
function ticketRowToMetaOverlay(t) {
    const overlay = {
        closed: t.status !== 'open',
        deleted: t.status === 'deleted'
    };
    if (t.openerId) overlay.ownerId = t.openerId;
    if (t.type) overlay.typeId = t.type;
    if (t.claimedBy) overlay.claimedBy = t.claimedBy;
    if (t.claimedAt) overlay.claimedAt = t.claimedAt;
    if (t.closedAt) overlay.closedAt = t.closedAt;
    if (t.closedBy) overlay.closedBy = t.closedBy;
    if (t.noResponseWarnedAt) overlay.noResponseWarnedAt = t.noResponseWarnedAt;
    if (t.createdAt) overlay.createdAt = t.createdAt;
    return overlay;
}

// قراءة meta للقناة: DB أولًا → topic (تذاكر قديمة + هجرة كسولة) → الذاكرة.
function getTicketMetaFromChannel(channel) {
    const channelId = channel && channel.id ? String(channel.id) : '';
    if (!channelId) return null;

    // 1) DB — المصدر الحقيقي
    try {
        const row = ticketStore.getByChannel(channelId);
        if (row) {
            const merged = { ...(row.meta || {}), ...ticketRowToMetaOverlay(row) };
            metaMemory.set(channelId, merged);
            return merged;
        }
    } catch (err) {
        console.warn(`tickets: DB read failed for channel ${channelId}:`, err && err.message ? err.message : err);
    }

    // 2) topic — تذاكر ما قبل الهجرة (نهاجرها للـ DB بأول قراءة)
    try {
        const topic = String(channel && channel.topic ? channel.topic : '');
        if (topic.startsWith(TOPIC_PREFIX)) {
            const json = topic.slice(TOPIC_PREFIX.length);
            const parsed = JSON.parse(json);
            if (parsed && typeof parsed === 'object') {
                try {
                    ticketStore.saveTicketMeta({
                        channelId,
                        guildId: channel && channel.guild ? channel.guild.id : null
                    }, parsed);
                } catch (err) {
                    console.warn(`tickets: lazy migration failed for channel ${channelId}:`, err && err.message ? err.message : err);
                }
                metaMemory.set(channelId, parsed);
                return parsed;
            }
        }
    } catch {
        // fall through to memory
    }

    // 3) الذاكرة — آخر fallback
    const mem = metaMemory.get(channelId) || null;
    return mem;
}

// Fields that are safe to drop when the serialized meta exceeds the 1024-char
// topic limit (display/history data, not operational state).
const OPTIONAL_META_FIELDS = ['staffRoleIds', 'openedBy', 'reopenedAt', 'reopenedBy', 'closedBy', 'closedAt', 'noResponseWarnedAt'];

// يحفظ meta التكت: upsert بالـ DB (الحالة الكاملة مهما كبرت) + يكتب الـ topic
// للعرض (مع تقليص الحقول الاختيارية). يرجع true إذا نجح كتابة الـ topic،
// وfalse إذا فشل/تجاوز الحد — بس الـ DB والذاكرة يضلوا محفوظين بأي حال.
async function setTicketMetaForChannel(channel, meta) {
    const channelId = channel && channel.id ? String(channel.id) : '';
    const payload = meta && typeof meta === 'object' ? { ...meta } : {};

    // 1) DB upsert — ما يتأثر بحد الـ topic أبدًا
    try {
        ticketStore.saveTicketMeta({
            channelId,
            guildId: channel && channel.guild ? channel.guild.id : null
        }, payload);
    } catch (err) {
        console.warn(`tickets: failed to persist meta to DB for channel ${channelId}:`, err && err.message ? err.message : err);
    }

    // 2) الذاكرة — دايمًا
    if (channelId) metaMemory.set(channelId, payload);

    // 3) topic (توافق عكسي/عرض) — مع تقليص الحقول الاختيارية
    try {
        let shrink = { ...payload };
        let nextTopic = `${TOPIC_PREFIX}${JSON.stringify(shrink)}`;

        for (const field of OPTIONAL_META_FIELDS) {
            if (nextTopic.length <= 1024) break;
            if (field in shrink) {
                delete shrink[field];
                nextTopic = `${TOPIC_PREFIX}${JSON.stringify(shrink)}`;
            }
        }
        if (nextTopic.length > 1024) {
            console.warn(`tickets: meta for channel ${channelId} exceeds 1024 chars — DB kept, topic skipped`);
            return false;
        }

        if (typeof channel.setTopic === 'function') {
            await channel.setTopic(nextTopic);
        }
        return true;
    } catch (err) {
        console.warn(`tickets: failed to persist meta for channel ${channelId}:`, err && err.message ? err.message : err);
        return false;
    }
}

function fmtMsShort(ms) {
    const n = Math.max(0, Math.floor(Number(ms) || 0));
    if (!n) return '0';
    const s = Math.floor(n / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
}

function fmtDurationPretty(ms) {
    const n = Math.max(0, Math.floor(Number(ms) || 0));
    const s = Math.floor(n / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m || !parts.length) parts.push(`${m}m`);
    return parts.join(' ');
}

function parseDurationLike(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s || s === '0' || s === 'off' || s === 'none') return 0;
    const m = s.match(/^\s*(\d+)\s*([smhd])\s*$/);
    if (!m) return null;
    const n = Math.max(0, Math.floor(Number(m[1]) || 0));
    const unit = m[2];
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    const ms = n * mult;
    if (ms > 30 * 24 * 60 * 60 * 1000) return null;
    return ms;
}

module.exports = {
    normalizeTicketTypeId,
    getTicketMetaFromChannel,
    setTicketMetaForChannel,
    fmtMsShort,
    fmtDurationPretty,
    parseDurationLike
};
