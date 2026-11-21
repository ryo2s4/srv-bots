const recentInteractionIds = new Map();

function clampNumber(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
}

function hslToRgbInt(h, s, l) {
    const hh = (((Number(h) || 0) % 360) + 360) % 360;
    const ss = Math.min(1, Math.max(0, Number(s) || 0));
    const ll = Math.min(1, Math.max(0, Number(l) || 0));

    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = ll - c / 2;

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hh < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (hh < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (hh < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (hh < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (hh < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }

    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    return ((r & 255) << 16) + ((g & 255) << 8) + (b & 255);
}

function rememberInteractionId(id, ttlMs = 15 * 1000) {
    if (!id) return;
    recentInteractionIds.set(id, Date.now() + ttlMs);
}

function hasRecentInteractionId(id) {
    if (!id) return false;
    const exp = recentInteractionIds.get(id);
    if (!exp) return false;
    if (Date.now() > exp) {
        recentInteractionIds.delete(id);
        return false;
    }
    return true;
}

function cleanupRecentInteractionIds(max = 2000) {
    if (recentInteractionIds.size <= max) return;
    const now = Date.now();
    for (const [k, exp] of recentInteractionIds.entries()) {
        if (now > exp) recentInteractionIds.delete(k);
        if (recentInteractionIds.size <= max) break;
    }
}

function extractId(value) {
    if (!value) return null;
    const m = String(value).match(/\d{5,}/);
    return m ? m[0] : null;
}

function lunaPointsRewardForLevel(newLevel) {
    const lvl = Math.max(0, Math.floor(Number(newLevel) || 0));
    return 3 + Math.floor(lvl / 3) + Math.floor(Math.sqrt(lvl) * 1.75);
}

function pickOne(arr) {
    const a = Array.isArray(arr) ? arr : [];
    if (a.length === 0) return null;
    return a[Math.floor(Math.random() * a.length)];
}

function markOnce(map, key, ttlMs) {
    const now = Date.now();
    const existing = map.get(key);
    if (existing && existing > now) return false;
    map.set(key, now + ttlMs);
    return true;
}

function normalizeShortcutTrigger(guild, input) {
    const raw = String(input || '').trim();
    if (!raw) return '';

    const nameOnly = raw.match(/^:(\w+):$/);
    if (nameOnly && guild && guild.emojis && guild.emojis.cache) {
        const found = guild.emojis.cache.find((e) => e && e.name && String(e.name).toLowerCase() === String(nameOnly[1]).toLowerCase());
        if (found && found.id) return String(found.id);
    }

    const { emojiKeyFromString } = require('./../guildConfig');
    const key = emojiKeyFromString(raw);
    return String(key || raw).trim().toLowerCase();
}

function parseAllowTargets(input) {
    const raw = String(input || '').trim();
    if (!raw) return { allowUserIds: [], allowRoleIds: [] };

    const userIds = [];
    const roleIds = [];

    raw.replace(/<@!?(?<uid>\d{16,20})>|<@&(?<rid>\d{16,20})>/g, (_m, _a, _b, groups) => {
        if (groups && groups.uid) userIds.push(String(groups.uid));
        if (groups && groups.rid) roleIds.push(String(groups.rid));
        return '';
    });

    for (const tok of raw.split(/[\s,]+/g).map((s) => s.trim()).filter(Boolean)) {
        if (!/^\d{16,20}$/.test(tok)) continue;
        userIds.push(tok);
    }

    return {
        allowUserIds: [...new Set(userIds)].slice(0, 50),
        allowRoleIds: [...new Set(roleIds)].slice(0, 50)
    };
}

function canUseAutoReply(rule, message) {
    if (!rule || typeof rule !== 'object') return true;
    const users = Array.isArray(rule.allowUserIds) ? rule.allowUserIds.map(String) : [];
    const roles = Array.isArray(rule.allowRoleIds) ? rule.allowRoleIds.map(String) : [];
    const hasUsers = users.length > 0;
    const hasRoles = roles.length > 0;
    if (!hasUsers && !hasRoles) return true;

    const userOk = hasUsers ? users.includes(String(message.author.id)) : false;
    const roleOk = roles
        ? (message.member?.roles?.cache ? message.member.roles.cache.some((r) => roles.includes(String(r.id))) : false)
        : false;

    return userOk || roleOk;
}

module.exports = {
    clampNumber,
    hslToRgbInt,
    rememberInteractionId,
    hasRecentInteractionId,
    cleanupRecentInteractionIds,
    extractId,
    lunaPointsRewardForLevel,
    pickOne,
    markOnce,
    normalizeShortcutTrigger,
    parseAllowTargets,
    canUseAutoReply
};
