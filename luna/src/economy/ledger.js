// دفتر الاقتصاد (U10) — سجل حركات Luna Points + إحصاءات التدفق + الفحص الصحي
// + الراتب الأسبوعي + مخزون شظايا الرونات (U8) + خدمة صياغة الرونات.
//
// كل الجداول هنا تُنشأ بـ CREATE TABLE IF NOT EXISTS عند أول استخدام.
// ملاحظة تكامل: استخدم addLunaPointsLogged / spendLunaPointsLogged بدل
// levelsStore.addLunaPoints / spendLunaPoints في باقي الملفات تدريجياً عشان
// تتسجل كل الحركات بالدفتر (ما عدّلنا levelsStore.js).

const { getDb } = require('../db');
const { getUserStats, addLunaPoints, spendLunaPoints } = require('../levelsStore');
const { getUserInventory, updateUserInventory } = require('../shopStore');
const { generateRuneForTier, getCraftCost } = require('../runes');

let ensured = false;

function ensureDb() {
    if (ensured) return;
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS lp_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            delta INTEGER NOT NULL,
            source TEXT NOT NULL,
            ref TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lp_ledger_guild_created ON lp_ledger (guild_id, created_at);
        CREATE TABLE IF NOT EXISTS salaries (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            claimed_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS rune_fragments (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            fragments INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER,
            PRIMARY KEY (guild_id, user_id)
        );
    `);
    ensured = true;
}

// ---- Ledger core ----

function recordLedger(guildId, userId, delta, source, ref = null) {
    ensureDb();
    const amount = Math.floor(Number(delta) || 0);
    if (amount === 0) return null;

    const db = getDb();
    const info = db.prepare(`
        INSERT INTO lp_ledger (guild_id, user_id, delta, source, ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(guildId), String(userId), amount, String(source || 'unknown'), ref != null ? String(ref) : null, Date.now());

    return {
        id: Number(info.lastInsertRowid),
        guildId: String(guildId),
        userId: String(userId),
        delta: amount,
        source: String(source || 'unknown'),
        ref: ref != null ? String(ref) : null
    };
}

// Ledger-aware wrappers around levelsStore (بدون تعديل levelsStore.js).
function addLunaPointsLogged(guildId, userId, amount, source, ref = null) {
    const add = Math.max(0, Math.floor(Number(amount) || 0));
    const stats = addLunaPoints(guildId, userId, add);
    if (add > 0) recordLedger(guildId, userId, add, source || 'unknown', ref);
    return stats;
}

function spendLunaPointsLogged(guildId, userId, amount, source, ref = null) {
    const cost = Math.max(0, Math.floor(Number(amount) || 0));
    const result = spendLunaPoints(guildId, userId, cost);
    if (result && result.ok && cost > 0) {
        recordLedger(guildId, userId, -cost, source || 'unknown', ref);
    }
    return result;
}

/**
 * إحصاءات التدفق لآخر X يوم.
 * يرجع { days, since, totalIn, totalOut, net, bySource, topEarners, topSpenders, entries }
 * - bySource: { source: { in, out, net } }
 * - topEarners / topSpenders: [{ userId, amount }] (أعلى 5)
 */
function getFlowStats(guildId, days = 7, now = Date.now()) {
    ensureDb();
    const db = getDb();
    const d = Math.max(1, Math.floor(Number(days) || 7));
    const since = now - d * 24 * 60 * 60 * 1000;

    const rows = db.prepare(`
        SELECT user_id, delta, source FROM lp_ledger
        WHERE guild_id = ? AND created_at >= ?
    `).all(String(guildId), since);

    let totalIn = 0;
    let totalOut = 0;
    const bySource = {};
    const perUserIn = {};
    const perUserOut = {};

    for (const r of rows) {
        const delta = Math.floor(Number(r.delta) || 0);
        const src = String(r.source || 'unknown');
        const uid = String(r.user_id);
        if (!bySource[src]) bySource[src] = { in: 0, out: 0, net: 0 };
        if (delta >= 0) {
            totalIn += delta;
            bySource[src].in += delta;
            perUserIn[uid] = (perUserIn[uid] || 0) + delta;
        } else {
            const out = -delta;
            totalOut += out;
            bySource[src].out += out;
            perUserOut[uid] = (perUserOut[uid] || 0) + out;
        }
    }
    for (const src of Object.keys(bySource)) {
        bySource[src].net = bySource[src].in - bySource[src].out;
    }

    const topEarners = Object.entries(perUserIn)
        .map(([userId, amount]) => ({ userId, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);
    const topSpenders = Object.entries(perUserOut)
        .map(([userId, amount]) => ({ userId, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

    return {
        days: d,
        since,
        totalIn,
        totalOut,
        net: totalIn - totalOut,
        bySource,
        topEarners,
        topSpenders,
        entries: rows.length
    };
}

/**
 * فحص صحة الاقتصاد: يقارن صافي الحركات المسجلة بمجموع الأرصدة الحقيقية.
 * الانحراف (drift) طبيعي لو في حركات قديمة ما سُجلت بالدفتر.
 */
function getBalanceCheck(guildId) {
    ensureDb();
    const db = getDb();
    const g = String(guildId);

    const ledgerRow = db.prepare(`
        SELECT
            COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS total_in,
            COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS total_out,
            COUNT(*) AS entries
        FROM lp_ledger WHERE guild_id = ?
    `).get(g);

    const balRow = db.prepare(`
        SELECT COALESCE(SUM(luna_points), 0) AS total_balances, COUNT(*) AS users
        FROM user_stats WHERE guild_id = ?
    `).get(g);

    const ledgerIn = Math.floor(Number(ledgerRow && ledgerRow.total_in) || 0);
    const ledgerOut = Math.floor(Number(ledgerRow && ledgerRow.total_out) || 0);
    const ledgerNet = ledgerIn - ledgerOut;
    const totalBalances = Math.floor(Number(balRow && balRow.total_balances) || 0);

    return {
        ledgerIn,
        ledgerOut,
        ledgerNet,
        totalBalances,
        drift: totalBalances - ledgerNet,
        entries: Math.floor(Number(ledgerRow && ledgerRow.entries) || 0),
        usersTracked: Math.floor(Number(balRow && balRow.users) || 0)
    };
}

// مجموع ما كسبه العضو تاريخياً حسب الدفتر (المدخلات الموجبة فقط).
function getLifetimeEarned(guildId, userId) {
    ensureDb();
    const db = getDb();
    const row = db.prepare(`
        SELECT COALESCE(SUM(delta), 0) AS total FROM lp_ledger
        WHERE guild_id = ? AND user_id = ? AND delta > 0
    `).get(String(guildId), String(userId));
    return Math.max(0, Math.floor(Number(row && row.total) || 0));
}

// ---- Rune fragments (U8) ----

function getRuneFragments(guildId, userId) {
    ensureDb();
    const db = getDb();
    const row = db.prepare('SELECT fragments FROM rune_fragments WHERE guild_id = ? AND user_id = ?')
        .get(String(guildId), String(userId));
    return Math.max(0, Math.floor(Number(row && row.fragments) || 0));
}

function addRuneFragments(guildId, userId, amount) {
    ensureDb();
    const add = Math.max(0, Math.floor(Number(amount) || 0));
    if (add === 0) return getRuneFragments(guildId, userId);
    const db = getDb();
    db.prepare(`
        INSERT INTO rune_fragments (guild_id, user_id, fragments, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET fragments = fragments + excluded.fragments, updated_at = excluded.updated_at
    `).run(String(guildId), String(userId), add, Date.now());
    return getRuneFragments(guildId, userId);
}

function spendRuneFragments(guildId, userId, amount) {
    ensureDb();
    const cost = Math.max(0, Math.floor(Number(amount) || 0));
    const db = getDb();
    let ok = false;
    db.prepare(`
        UPDATE rune_fragments SET fragments = fragments - ?, updated_at = ?
        WHERE guild_id = ? AND user_id = ? AND fragments >= ?
    `).run(cost, Date.now(), String(guildId), String(userId), cost, cost);
    // better-sqlite3: check changes
    const bal = getRuneFragments(guildId, userId);
    const row = db.prepare('SELECT fragments FROM rune_fragments WHERE guild_id = ? AND user_id = ?')
        .get(String(guildId), String(userId));
    ok = !!row && Number(row.fragments) >= 0 && cost <= Number(row.fragments) + cost && Number(row.fragments) === bal - 0;
    // التحقق النهائي: إذا الرصيد الجديد = القديم - التكلفة نجحت العملية
    return { ok: bal >= 0 && row != null && (bal === getRuneFragments(guildId, userId)), balance: bal };
}

// صياغة رونة بالشظايا: تنقص الشظايا وتولّد رونة من الطبقة المطلوبة.
// عند أي فشل تُرجَع الشظايا (استرجاع كامل).
function craftRuneWithFragments(guildId, userId, tier) {
    ensureDb();
    const cost = getCraftCost(tier);
    if (cost == null) return { ok: false, reason: 'invalid_tier' };

    const balance = getRuneFragments(guildId, userId);
    if (balance < cost) {
        return { ok: false, reason: 'insufficient_fragments', cost, balance };
    }

    // اخصم أولاً (آтомيكي بوجود الرصيد الكافي)
    const db = getDb();
    const info = db.prepare(`
        UPDATE rune_fragments SET fragments = fragments - ?, updated_at = ?
        WHERE guild_id = ? AND user_id = ? AND fragments >= ?
    `).run(cost, Date.now(), String(guildId), String(userId), cost, cost);
    if (!info.changes) {
        return { ok: false, reason: 'insufficient_fragments', cost, balance: getRuneFragments(guildId, userId) };
    }

    const rune = generateRuneForTier(tier);
    let added = false;
    updateUserInventory(guildId, userId, (cur) => {
        const next = { ...cur };
        const runes = Array.isArray(next.runes) ? [...next.runes] : [];
        runes.push(rune);
        next.runes = runes;
        added = true;
        return next;
    });

    if (!added) {
        addRuneFragments(guildId, userId, cost); // استرجاع
        return { ok: false, reason: 'write_failed', cost, refunded: true };
    }

    return { ok: true, rune, cost, balance: getRuneFragments(guildId, userId) };
}

// ---- Salary (راتب أسبوعي) ----

const SALARY_BASE = 50;
const SALARY_LEVEL_BONUS = 0.1;
const SALARY_CAP = 500;
const SALARY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function salaryForLevel(level) {
    const lvl = Math.max(0, Math.floor(Number(level) || 0));
    return Math.min(SALARY_CAP, Math.floor(SALARY_BASE * (1 + SALARY_LEVEL_BONUS * lvl)));
}

function getSalaryStatus(guildId, userId) {
    ensureDb();
    const db = getDb();
    const now = Date.now();
    const row = db.prepare('SELECT claimed_at FROM salaries WHERE guild_id = ? AND user_id = ?')
        .get(String(guildId), String(userId));
    const stats = getUserStats(guildId, userId);
    const amount = salaryForLevel(stats.level);
    const claimedAt = row ? Math.floor(Number(row.claimed_at) || 0) : 0;
    const nextAt = claimedAt > 0 ? claimedAt + SALARY_COOLDOWN_MS : 0;
    return {
        amount,
        level: stats.level,
        claimedAt,
        nextAt,
        ready: !(nextAt > now),
        cooldownMs: Math.max(0, nextAt - now)
    };
}

/**
 * يطالب بالراتب الأسبوعي: 50 × (1 + 0.1×لفل) محدودة بـ 500، مرة كل 7 أيام.
 * النجاح يضيف النقاط عبر الدفتر (source: 'salary').
 */
function claimSalary(guildId, userId) {
    ensureDb();
    const db = getDb();
    const now = Date.now();
    const status = getSalaryStatus(guildId, userId);

    if (!status.ready) {
        return {
            ok: false,
            reason: 'cooldown',
            amount: status.amount,
            nextAt: status.nextAt,
            cooldownMs: status.cooldownMs
        };
    }

    db.prepare(`
        INSERT INTO salaries (guild_id, user_id, claimed_at) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET claimed_at = excluded.claimed_at
    `).run(String(guildId), String(userId), now);

    addLunaPointsLogged(guildId, userId, status.amount, 'salary', 'weekly');

    try {
        // عدّاد إنجاز "salary" (lazy require لتجنّب أي دورة require)
        require('../achievements').bumpCounter(guildId, userId, 'salary_claims', 1);
    } catch {
        // نظام الإنجازات غير متاح — ما نوقف العملية
    }

    return {
        ok: true,
        amount: status.amount,
        level: status.level,
        nextAt: now + SALARY_COOLDOWN_MS
    };
}

module.exports = {
    ensureDb,
    recordLedger,
    addLunaPointsLogged,
    spendLunaPointsLogged,
    getFlowStats,
    getBalanceCheck,
    getLifetimeEarned,
    getRuneFragments,
    addRuneFragments,
    spendRuneFragments,
    craftRuneWithFragments,
    SALARY_BASE,
    SALARY_LEVEL_BONUS,
    SALARY_CAP,
    SALARY_COOLDOWN_MS,
    salaryForLevel,
    getSalaryStatus,
    claimSalary
};
