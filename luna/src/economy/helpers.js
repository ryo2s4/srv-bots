const { getActiveXpMultiplier: getActiveXpMultiplierBoost, getActiveLunaMultiplier: getActiveLunaMultiplierBoost, getActiveLevelUpRewardMultiplier: getActiveLevelUpRewardMultiplierBoost } = require('../boostMeta');

function getWeekKey(ts = Date.now()) {
    // ISO week (Monday boundary) — matches nextWeeklyResetTs and shopService.weekKey
    const d = new Date(ts);
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function nextDailyResetTs(ts = Date.now()) {
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

function nextWeeklyResetTs(ts = Date.now()) {
    const d = new Date(ts);
    const dow = d.getUTCDay();
    const daysToNextMonday = (8 - dow) % 7 || 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToNextMonday, 0, 0, 0);
}

function rarityWeight(rarity) {
    if (rarity === 'mythic') return 0.35;
    if (rarity === 'legendary') return 1;
    if (rarity === 'rare') return 4;
    if (rarity === 'uncommon') return 8;
    return 12;
}

function shopKindAr(kind) {
    if (kind === 'role') return 'رتبة';
    if (kind === 'title') return 'لقب';
    if (kind === 'boost') return 'بوست';
    if (kind === 'service') return 'خدمة';
    if (kind === 'mystery') return 'صندوق';
    if (kind === 'social') return 'اجتماعي';
    return String(kind || 'عنصر');
}

function pickWeighted(items, count) {
    const pool = Array.isArray(items) ? items.filter(Boolean) : [];
    const out = [];
    const used = new Set();
    while (out.length < count && used.size < pool.length) {
        const choices = pool.filter((x) => x && x.id && !used.has(x.id));
        if (choices.length === 0) break;
        const total = choices.reduce((a, x) => a + rarityWeight(x.rarity), 0);
        let r = Math.random() * total;
        let picked = choices[0];
        for (const c of choices) {
            r -= rarityWeight(c.rarity);
            if (r <= 0) {
                picked = c;
                break;
            }
        }

        used.add(picked.id);
        out.push(picked);
    }
    return out;
}

function boostMultiplier(b) {
    if (!b || typeof b.type !== 'string') return 1;
    if (b.multiplier && b.multiplier > 1) return b.multiplier;
    if (b.type === 'xp_boost_25_1h' || b.type === 'luna_boost_25_1h') return 1.25;
    if (b.type === 'xp_boost_15_24h') return 1.15;
    if (b.type === 'levelup_reward_boost_50_1h') return 1.5;
    return 1;
}

function stackMult(inv, ...typePrefixes) {
    const boosts = inv && Array.isArray(inv.activeBoosts) ? inv.activeBoosts : [];
    const active = boosts.filter((b) => b && (!b.expiresAt || b.expiresAt > Date.now()));
    let mult = 1;
    for (const b of active) {
        if (typePrefixes.some((p) => b.type === p || b.type.startsWith(p))) {
            const m = boostMultiplier(b);
            if (m > 1) mult *= m;
        }
    }
    return mult;
}

function getActiveXpMultiplier(inv) {
    return getActiveXpMultiplierBoost(inv && Array.isArray(inv.activeBoosts) ? inv.activeBoosts : []);
}

function getActiveLunaMultiplier(inv) {
    return getActiveLunaMultiplierBoost(inv && Array.isArray(inv.activeBoosts) ? inv.activeBoosts : []);
}

function getActiveLevelUpRewardMultiplier(inv) {
    return getActiveLevelUpRewardMultiplierBoost(inv && Array.isArray(inv.activeBoosts) ? inv.activeBoosts : []);
}

function getRoleBoostMultiplier(memberRoles, roleBoosts, typePrefix) {
    if (!Array.isArray(memberRoles) || memberRoles.length === 0) return 1;
    if (!Array.isArray(roleBoosts) || roleBoosts.length === 0) return 1;
    let mult = 1;
    for (const rb of roleBoosts) {
        if (!rb || !rb.roleId || !rb.type || !rb.multiplier) continue;
        if (rb.type.startsWith(typePrefix) && memberRoles.includes(rb.roleId)) {
            mult *= rb.multiplier;
        }
    }
    return mult;
}

module.exports = {
    getWeekKey,
    nextDailyResetTs,
    nextWeeklyResetTs,
    rarityWeight,
    shopKindAr,
    pickWeighted,
    boostMultiplier,
    stackMult,
    getActiveXpMultiplier,
    getActiveLunaMultiplier,
    getActiveLevelUpRewardMultiplier,
    getRoleBoostMultiplier
};
