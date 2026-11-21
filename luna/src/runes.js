const TIERS = {
    common: { label: 'شائع', emoji: '⚪', minMult: 1.03, maxMult: 1.08, weight: 50, dualChance: 0, bonusChance: 0 },
    uncommon: { label: 'غير شائع', emoji: '🟢', minMult: 1.08, maxMult: 1.15, weight: 25, dualChance: 0.1, bonusChance: 0.03 },
    rare: { label: 'نادر', emoji: '🔵', minMult: 1.15, maxMult: 1.25, weight: 15, dualChance: 0.2, bonusChance: 0.06 },
    epic: { label: 'ملحمي', emoji: '🟣', minMult: 1.25, maxMult: 1.40, weight: 7, dualChance: 0.3, bonusChance: 0.10 },
    legendary: { label: 'أسطوري', emoji: '🟠', minMult: 1.40, maxMult: 1.60, weight: 3, dualChance: 0.4, bonusChance: 0.15 },
    mythic: { label: 'خرافي', emoji: '🔴', minMult: 1.60, maxMult: 2.00, weight: 1, dualChance: 0.5, bonusChance: 0.20 }
};

const TYPES = ['xp_boost', 'luna_boost', 'levelup_reward_boost'];

const TIER_LIST = Object.keys(TIERS);

function randomTier(luck = 1) {
    // luck > 1 skews weights toward rarer tiers (rarity index squared scaling)
    const safeLuck = Math.max(0.1, Math.min(5, Number(luck) || 1));
    const weights = TIER_LIST.map((tier, idx) => TIERS[tier].weight * Math.pow(safeLuck, idx));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < TIER_LIST.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return TIER_LIST[i];
    }
    return 'common';
}

function randMult(tierInfo) {
    return tierInfo.minMult + Math.random() * (tierInfo.maxMult - tierInfo.minMult);
}

function generateRune(luck = 1) {
    const tier = randomTier(luck);
    const tierInfo = TIERS[tier] || TIERS.common;
    const isDual = Math.random() < tierInfo.dualChance;

    const typePool = [...TYPES];
    const firstType = typePool.splice(Math.floor(Math.random() * typePool.length), 1)[0];
    const boosts = [{ type: firstType, multiplier: randMult(tierInfo), acquiredAt: Date.now() }];

    if (isDual && typePool.length > 0) {
        const secondType = typePool[Math.floor(Math.random() * typePool.length)];
        boosts.push({ type: secondType, multiplier: randMult(tierInfo), acquiredAt: Date.now() });
    }

    return {
        id: `rune_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tier,
        boosts,
        stars: 0,
        acquiredAt: Date.now()
    };
}

function generateRuneDrop(luck = 1) {
    const runes = [];

    function rollExtra(tier, depth) {
        if (depth >= 3) return;
        const t = TIERS[tier];
        if (t && Math.random() < t.bonusChance) {
            const extra = generateRune(luck);
            runes.push(extra);
            rollExtra(extra.tier, depth + 1);
        }
    }

    const first = generateRune(luck);
    runes.push(first);
    rollExtra(first.tier, 0);

    return runes;
}

function getRuneBoosts(rune) {
    // Backward compat: old runes stored type/multiplier directly
    if (Array.isArray(rune.boosts) && rune.boosts.length > 0) {
        return rune.boosts.filter((b) => b && b.type && b.multiplier);
    }
    if (rune.type && rune.multiplier) {
        return [{ type: rune.type, multiplier: rune.multiplier }];
    }
    return [];
}

function getEquippedRuneMultiplier(equippedRunes, typePrefix) {
    let mult = 1;
    for (const r of equippedRunes) {
        if (!r) continue;
        const boosts = getRuneBoosts(r);
        for (const b of boosts) {
            if (b.multiplier <= 1) continue;
            if (typePrefix && b.type !== typePrefix && !b.type.startsWith(typePrefix)) continue;
            mult *= b.multiplier;
        }
    }
    return mult;
}

function getTotalRuneSummary(equippedRunes) {
    const totalXpMult = getEquippedRuneMultiplier(equippedRunes, 'xp_boost');
    const totalLunaMult = getEquippedRuneMultiplier(equippedRunes, 'luna_boost');
    const totalLevelupMult = getEquippedRuneMultiplier(equippedRunes, 'levelup_reward_boost');
    const pct = (m) => Math.round((m - 1) * 100);
    return {
        xp: { multiplier: totalXpMult, pct: pct(totalXpMult), active: totalXpMult > 1 },
        luna: { multiplier: totalLunaMult, pct: pct(totalLunaMult), active: totalLunaMult > 1 },
        levelup: { multiplier: totalLevelupMult, pct: pct(totalLevelupMult), active: totalLevelupMult > 1 }
    };
}

function fmtPct(m) {
    return `+${Math.round((Number(m) - 1) * 100)}%`;
}

function fmtRuneLine(rune) {
    const t = TIERS[rune.tier] || TIERS.common;
    const boosts = getRuneBoosts(rune);
    const boostStr = boosts.map((b) => {
        const name = { xp_boost: 'XP', luna_boost: 'Luna', levelup_reward_boost: 'Level-Up' }[b.type] || b.type;
        return `${name} ${fmtPct(b.multiplier)}`;
    }).join(' + ');
    return `${t.emoji} **${t.label}** (${boostStr})`;
}

// Sell/Buy/Upgrade pricing helpers

const SELL_PRICES = {
    common: 50,
    uncommon: 100,
    rare: 200,
    epic: 400,
    legendary: 800,
    mythic: 1500
};

const BUY_PRICES = {
    common: 100,
    uncommon: 250,
    rare: 500,
    epic: 1000,
    legendary: 2500,
    mythic: 5000
};

const STAR_CAPS = {
    common: 3,
    uncommon: 3,
    rare: 3,
    epic: 3,
    legendary: 5,
    mythic: 5
};

function getRuneStars(rune) {
    if (!rune) return 0;
    const n = Math.max(0, Math.floor(Number(rune.stars) || 0));
    return n;
}

function getRuneValue(rune) {
    if (!rune || !rune.tier) return 0;
    const base = SELL_PRICES[rune.tier] != null ? SELL_PRICES[rune.tier] : 0;
    const stars = getRuneStars(rune);
    const mult = 1 + stars * 0.3;
    return Math.max(0, Math.floor(base * mult));
}

function getRuneBuyPrice(tier) {
    if (!tier) return 0;
    return BUY_PRICES[tier] != null ? BUY_PRICES[tier] : 0;
}

function getUpgradeCost(rune) {
    if (!rune || !rune.tier) return null;
    const tierIdx = TIER_LIST.indexOf(rune.tier);
    if (tierIdx < 0) return null;
    const stars = getRuneStars(rune);
    const cap = STAR_CAPS[rune.tier] != null ? STAR_CAPS[rune.tier] : 0;
    if (stars >= cap) return null;
    return 200 + (tierIdx * 100) + (stars * 150);
}

function getUpgradeCap(tier) {
    return STAR_CAPS[tier] != null ? STAR_CAPS[tier] : 0;
}

function upgradeRune(rune) {
    if (!rune || !rune.tier) return { ok: false, reason: 'invalid_rune' };
    const cost = getUpgradeCost(rune);
    if (cost == null) return { ok: false, reason: 'max_stars' };
    const stars = getRuneStars(rune);
    const cap = getUpgradeCap(rune.tier);
    if (stars >= cap) return { ok: false, reason: 'max_stars' };

    const boosts = getRuneBoosts(rune);
    if (!boosts.length) return { ok: false, reason: 'no_boosts' };

    const now = Date.now();
    const newBoosts = boosts.map((b) => {
        const inc = 0.05 + Math.random() * 0.10;
        const prev = Number(b && b.multiplier) || 1;
        return {
            type: b.type,
            multiplier: Math.max(1, prev + inc),
            acquiredAt: b.acquiredAt || now
        };
    });

    return {
        ok: true,
        rune: {
            ...rune,
            boosts: newBoosts,
            stars: stars + 1
        },
        cost,
        newStars: stars + 1,
        cap
    };
}

function generateRuneForTier(tier, luck = 1) {
    const t = TIERS[tier];
    if (!t) return generateRune(luck);
    const safeTier = tier;
    const safeLuck = Math.max(0.1, Math.min(5, Number(luck) || 1));
    const isDual = Math.random() < Math.min(0.9, t.dualChance * safeLuck);

    const typePool = [...TYPES];
    const firstType = typePool.splice(Math.floor(Math.random() * typePool.length), 1)[0];
    const boosts = [{ type: firstType, multiplier: randMult(t), acquiredAt: Date.now() }];

    if (isDual && typePool.length > 0) {
        const secondType = typePool[Math.floor(Math.random() * typePool.length)];
        boosts.push({ type: secondType, multiplier: randMult(t), acquiredAt: Date.now() });
    }

    return {
        id: `rune_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tier: safeTier,
        boosts,
        stars: 0,
        acquiredAt: Date.now()
    };
}

// ---- Re-roll: re-generate the boost(s) of a rune, same tier & stars ----

const REROLL_PRICES = {
    common: 75,
    uncommon: 150,
    rare: 300,
    epic: 550,
    legendary: 1000,
    mythic: 1800
};

function getRerollPrice(tier) {
    return REROLL_PRICES[tier] != null ? REROLL_PRICES[tier] : null;
}

// Maximum number of times a single rune may be recycled.
const REROLL_CAP = 3;

function rerollRune(rune) {
    if (!rune || !rune.tier || !TIERS[rune.tier]) return { ok: false, reason: 'invalid_rune' };
    const price = getRerollPrice(rune.tier);
    if (price == null) return { ok: false, reason: 'invalid_rune' };

    // Hard cap: a single rune can only be recycled a limited number of times.
    const used = Number(rune.rerolls) || 0;
    if (used >= REROLL_CAP) {
        return { ok: false, reason: 'reroll_cap', used, cap: REROLL_CAP };
    }

    const t = TIERS[rune.tier];
    const isDual = Math.random() < t.dualChance;
    const typePool = [...TYPES];
    const now = Date.now();

    const firstType = typePool.splice(Math.floor(Math.random() * typePool.length), 1)[0];
    const boosts = [{ type: firstType, multiplier: randMult(t), acquiredAt: now }];

    if (isDual && typePool.length > 0) {
        const secondType = typePool[Math.floor(Math.random() * typePool.length)];
        boosts.push({ type: secondType, multiplier: randMult(t), acquiredAt: now });
    }

    return {
        ok: true,
        price,
        rune: {
            ...rune,
            boosts,
            rerolls: (Number(rune.rerolls) || 0) + 1
        }
    };
}

// ---- Fuse: consume 3 runes of the same tier -> 1 rune of the next tier ----
// Fusing 3 mythic (top tier) runes instead empowers one: +1 star, boosts kept.

const FUSE_COST = 250;

function fuseRunes(runes) {
    const list = Array.isArray(runes) ? runes.filter(Boolean) : [];
    if (list.length !== 3) return { ok: false, reason: 'need_three' };

    const tier = list[0].tier;
    if (!TIERS[tier]) return { ok: false, reason: 'invalid_rune' };
    if (!list.every((r) => r.tier === tier)) return { ok: false, reason: 'mixed_tiers' };

    const tierIdx = TIER_LIST.indexOf(tier);
    const isTopTier = tierIdx >= TIER_LIST.length - 1;

    if (isTopTier) {
        // Empower: keep the best rune of the three, +1 star, small boost bump
        const best = list.slice().sort((a, b) => getRuneValue(b) - getRuneValue(a))[0];
        const cap = getUpgradeCap(best.tier);
        const stars = getRuneStars(best);
        if (stars >= cap) return { ok: false, reason: 'max_stars' };
        const newStars = Math.min(cap, stars + 1);
        const boosts = getRuneBoosts(best).map((b) => ({
            type: b.type,
            multiplier: Math.max(1, (Number(b.multiplier) || 1) + 0.05 + Math.random() * 0.10),
            acquiredAt: b.acquiredAt || Date.now()
        }));
        return {
            ok: true,
            cost: FUSE_COST,
            mode: 'empower',
            rune: { ...best, boosts, stars: newStars }
        };
    }

    const nextTier = TIER_LIST[tierIdx + 1];
    const bonusLuck = 1.25; // fused runes roll slightly luckier
    return {
        ok: true,
        cost: FUSE_COST,
        mode: 'upgrade_tier',
        rune: generateRuneForTier(nextTier, bonusLuck),
        fromTier: tier,
        toTier: nextTier
    };
}

module.exports = {
    TIERS, TYPES, TIER_LIST,
    randomTier, generateRune, generateRuneDrop, generateRuneForTier,
    getEquippedRuneMultiplier, getTotalRuneSummary, getRuneBoosts,
    fmtPct, fmtRuneLine,
    SELL_PRICES, BUY_PRICES, STAR_CAPS, REROLL_PRICES, FUSE_COST, REROLL_CAP,
    getRuneStars, getRuneValue, getRuneBuyPrice, getUpgradeCost, getUpgradeCap, upgradeRune,
    getRerollPrice, rerollRune, fuseRunes
};
