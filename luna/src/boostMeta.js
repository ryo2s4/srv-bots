const boostMeta = {
    xp_boost_25_1h: { nameAr: '⚡ تعزيز خبرة +25% (ساعة)', durationMs: 60 * 60 * 1000 },
    xp_boost_15_24h: { nameAr: '⚡ تعزيز خبرة +15% (يوم)', durationMs: 24 * 60 * 60 * 1000 },
    luna_boost_25_1h: { nameAr: '💰 تعزيز نقاط لونا +25% (ساعة)', durationMs: 60 * 60 * 1000 },
    levelup_reward_boost_50_1h: { nameAr: '🏅 تعزيز مكافأة الترفيع +50% (ساعة)', durationMs: 60 * 60 * 1000 }
};

function getBoostMeta(type) {
    return boostMeta[type] || null;
}

function getBoostNameAr(type) {
    return (getBoostMeta(type) && getBoostMeta(type).nameAr) || type;
}

function formatDurationAr(ms) {
    const s = Math.max(0, Math.floor(Number(ms) || 0));
    if (!s) return 'مدة غير معروفة';
    const minutes = Math.floor(s / 60000);
    const hours = Math.floor(s / 3600000);
    const days = Math.floor(s / (24 * 3600000));

    if (days >= 1 && days * 24 * 60 === minutes) return days === 1 ? 'يوم كامل' : `${days} أيام`;
    if (hours >= 1 && hours * 60 === minutes) return hours === 1 ? 'ساعة' : `${hours} ساعات`;
    if (minutes >= 1) return minutes === 1 ? 'دقيقة' : `${minutes} دقائق`;
    return 'ثواني قليلة';
}

function formatRemainingAr(expiresAtMs) {
    const now = Date.now();
    const left = Math.max(0, Math.floor((Number(expiresAtMs) || 0) - now));
    if (left <= 0) return 'انتهى';

    const minutes = Math.ceil(left / 60000);
    if (minutes < 60) return minutes === 1 ? 'باقي دقيقة تقريبًا' : `باقي ${minutes} دقيقة تقريبًا`;

    const hours = Math.ceil(left / 3600000);
    if (hours < 24) return hours === 1 ? 'باقي ساعة تقريبًا' : `باقي ${hours} ساعات تقريبًا`;

    const days = Math.ceil(left / (24 * 3600000));
    return days === 1 ? 'باقي يوم تقريبًا' : `باقي ${days} أيام تقريبًا`;
}

function boostMultiplier(typeOrBoost) {
    // Accept a boost object (custom multiplier) or a type string (legacy)
    if (typeOrBoost && typeof typeOrBoost === 'object') {
        const custom = Number(typeOrBoost.multiplier);
        if (Number.isFinite(custom) && custom > 1) return custom;
        return boostMultiplier(typeOrBoost.type);
    }
    const type = typeOrBoost;
    if (typeof type !== 'string') return 1;
    if (type === 'xp_boost_25_1h' || type === 'luna_boost_25_1h') return 1.25;
    if (type === 'xp_boost_15_24h') return 1.15;
    if (type === 'levelup_reward_boost_50_1h') return 1.5;
    return 1;
}

function stackBoostMultiplier(activeBoosts, ...typePrefixes) {
    const boosts = Array.isArray(activeBoosts) ? activeBoosts : [];
    const now = Date.now();
    const active = boosts.filter((b) => b && (!b.expiresAt || b.expiresAt > now));
    let mult = 1;
    for (const b of active) {
        if (typePrefixes.some((p) => b.type === p || (typeof b.type === 'string' && b.type.startsWith(p)))) {
            const m = boostMultiplier(b);
            if (m > 1) mult *= m;
        }
    }
    return mult;
}

function getActiveXpMultiplier(activeBoosts) {
    return stackBoostMultiplier(activeBoosts, 'xp_boost');
}

function getActiveLunaMultiplier(activeBoosts) {
    return stackBoostMultiplier(activeBoosts, 'luna_boost');
}

function getActiveLevelUpRewardMultiplier(activeBoosts) {
    return stackBoostMultiplier(activeBoosts, 'levelup_reward_boost');
}

function getTotalBoostSummary(activeBoosts) {
    const mults = {
        xp: getActiveXpMultiplier(activeBoosts),
        luna: getActiveLunaMultiplier(activeBoosts),
        levelup: getActiveLevelUpRewardMultiplier(activeBoosts)
    };
    const pct = (m) => Math.round((m - 1) * 100);
    return {
        xp: { multiplier: mults.xp, pct: pct(mults.xp), active: mults.xp > 1 },
        luna: { multiplier: mults.luna, pct: pct(mults.luna), active: mults.luna > 1 },
        levelup: { multiplier: mults.levelup, pct: pct(mults.levelup), active: mults.levelup > 1 }
    };
}

module.exports = {
    getBoostMeta,
    getBoostNameAr,
    formatDurationAr,
    formatRemainingAr,
    boostMeta,
    boostMultiplier,
    stackBoostMultiplier,
    getActiveXpMultiplier,
    getActiveLunaMultiplier,
    getActiveLevelUpRewardMultiplier,
    getTotalBoostSummary
};
