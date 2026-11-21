// XP curve — level cost grows quadratically, but the quadratic term is
// gentler than before and the per-level cost soft-caps so very high levels
// stay attainable instead of exploding forever.
const XP_SOFT_CAP = 30000;

function xpForNextLevel(level) {
    const l = Math.max(0, Math.floor(Number(level) || 0));
    const raw = 25 + (6 * l) + (6 * l * l);
    return Math.min(raw, XP_SOFT_CAP);
}

// Total XP earned to be at the START of `level` (sum of all previous level costs).
const totalXpCache = new Map();

function totalXpForLevel(level) {
    const l = Math.max(0, Math.floor(Number(level) || 0));
    if (totalXpCache.has(l)) return totalXpCache.get(l);
    let total = 0;
    for (let i = 0; i < l; i++) {
        total += xpForNextLevel(i);
    }
    totalXpCache.set(l, total);
    return total;
}

// Total XP a user has ever earned (level progress + XP inside current level).
function totalXpOfStats(stats) {
    const s = stats || {};
    const level = Math.max(0, Math.floor(Number(s.level) || 0));
    const xp = Math.max(0, Math.floor(Number(s.xp) || 0));
    return totalXpForLevel(level) + xp;
}

module.exports = {
    xpForNextLevel,
    totalXpForLevel,
    totalXpOfStats,
    XP_SOFT_CAP
};
