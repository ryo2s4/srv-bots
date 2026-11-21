// Central level-up service: ONE place for XP→level processing, Luna rewards,
// milestone bonuses, level rewards and rune drops (with pity + luck scaling).
// Used by messageCreate, /daily claims, /grantxp and the XP-transfer service
// so every level-up path grants the exact same rewards.

const { getUserStats, updateUserStats, addLunaPoints } = require('./levelsStore');
const { getUserInventory, updateUserInventory } = require('./shopStore');
const { xpForNextLevel } = require('./xpCurve');
const { lunaPointsRewardForLevel } = require('./utils/helpers');
const { generateRuneDrop, generateRuneForTier, fmtRuneLine, TIER_LIST, getEquippedRuneMultiplier } = require('./runes');
const { getActiveXpMultiplier, getActiveLunaMultiplier, getActiveLevelUpRewardMultiplier } = require('./boostMeta');
const { getRoleBoostMultiplier } = require('./economy/helpers');
const { getGuildConfig } = require('./guildConfig');

/**
 * Compute the full multiplier stack for a user (inventory boosts × role boosts
 * × equipped runes) — same composition as the messageCreate XP path, so every
 * XP grant source (messages, /daily, /grantxp, XP transfer) pays consistently.
 */
function computeUserMultipliers(guildId, userId, roleIds = []) {
    const inv = getUserInventory(guildId, userId);
    const config = getGuildConfig(guildId);
    const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
    const equippedIds = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
    const equippedRunes = allRunes.filter((r) => r && equippedIds.includes(r.id));
    const roleBoosts = Array.isArray(config.roleBoosts) ? config.roleBoosts : [];
    const roles = Array.isArray(roleIds) ? roleIds : [];

    return {
        xpMult: getActiveXpMultiplier(inv.activeBoosts)
            * getRoleBoostMultiplier(roles, roleBoosts, 'xp_boost')
            * getEquippedRuneMultiplier(equippedRunes, 'xp_boost'),
        lunaMult: getActiveLunaMultiplier(inv.activeBoosts)
            * getRoleBoostMultiplier(roles, roleBoosts, 'luna_boost')
            * getEquippedRuneMultiplier(equippedRunes, 'luna_boost'),
        levelUpRewardMult: getActiveLevelUpRewardMultiplier(inv.activeBoosts)
            * getRoleBoostMultiplier(roles, roleBoosts, 'levelup_reward_boost')
            * getEquippedRuneMultiplier(equippedRunes, 'levelup_reward_boost')
    };
}

// ---- Milestones: crossing these levels is celebrated + rewarded ----
const MILESTONES = [
    { level: 10, luna: 150, runeTier: 'rare', label: 'المستوى 10' },
    { level: 25, luna: 400, runeTier: 'epic', label: 'المستوى 25' },
    { level: 50, luna: 1000, runeTier: 'legendary', label: 'المستوى 50' },
    { level: 100, luna: 2500, runeTier: 'mythic', label: 'المستوى 100' },
    { level: 250, luna: 6000, runeTier: 'mythic', label: 'المستوى 250' },
    { level: 500, luna: 15000, runeTier: 'mythic', label: 'المستوى 500' }
];

function milestonesBetween(beforeLevel, afterLevel) {
    return MILESTONES.filter((m) => m.level > beforeLevel && m.level <= afterLevel);
}

function nextMilestone(level) {
    const lvl = Math.max(0, Math.floor(Number(level) || 0));
    return MILESTONES.find((m) => m.level > lvl) || null;
}

// ---- Rune drop odds ----
// Base chance grows with level (loyalty reward) and a pity counter guarantees
// a drop after RUNE_PITY_MAX level-ups with no luck at all.
const RUNE_PITY_MAX = 5;

function runeDropChance(level) {
    const lvl = Math.max(0, Math.floor(Number(level) || 0));
    return Math.min(0.45, 0.22 + lvl * 0.004);
}

// Higher levels skew tier weights toward rarer runes (used by generateRuneDrop).
function runeLuckForLevel(level) {
    const lvl = Math.max(0, Math.floor(Number(level) || 0));
    return 1 + Math.min(lvl, 250) * 0.004; // up to 2x luck at level 250
}

/**
 * Process XP gain + all resulting level-ups for a user.
 *
 * opts:
 *   lunaMult           — multiplier for Luna earned per level (boosts/runes)
 *   levelUpRewardMult  — multiplier for level-up rewards (boosts/runes)
 *   grantRunes         — grant rune drops/milestone runes (default true)
 *   grantLevelRewards  — grant configured guild level rewards (default true)
 *
 * Returns { before, after, levelsGained, lunaGained, rewardLines, runeLines,
 *           milestoneLines, runesDropped, gainedXp }
 */
function processXpGain(guildId, userId, xpAmount, opts = {}) {
    const gainedXp = Math.max(0, Math.floor(Number(xpAmount) || 0));
    const lunaMult = Math.max(0, Number(opts.lunaMult) || 1);
    const levelUpRewardMult = Math.max(0, Number(opts.levelUpRewardMult) || 1);
    const grantRunes = opts.grantRunes !== false;
    const grantLevelRewards = opts.grantLevelRewards !== false;

    const before = getUserStats(guildId, userId);
    if (gainedXp === 0) {
        return {
            before, after: before, levelsGained: 0, lunaGained: 0, gainedXp: 0,
            rewardLines: [], runeLines: [], milestoneLines: [], runesDropped: []
        };
    }

    let lunaGained = 0;

    const after = updateUserStats(guildId, userId, (s) => {
        const next = { ...s };
        next.xp = (typeof next.xp === 'number' ? next.xp : 0) + gainedXp;
        next.level = typeof next.level === 'number' ? next.level : 0;
        next.lunaPoints = typeof next.lunaPoints === 'number' ? next.lunaPoints : 0;

        while (next.xp >= xpForNextLevel(next.level)) {
            next.xp -= xpForNextLevel(next.level);
            next.level += 1;
            const baseReward = lunaPointsRewardForLevel(next.level);
            const reward = Math.max(1, Math.floor(baseReward * lunaMult * levelUpRewardMult));
            next.lunaPoints += reward;
            lunaGained += reward;
        }

        return next;
    });

    const levelsGained = Math.max(0, after.level - before.level);
    const rewardLines = [];
    const runeLines = [];
    const milestoneLines = [];
    const runesDropped = [];

    if (levelsGained <= 0) {
        return { before, after, levelsGained: 0, lunaGained, gainedXp, rewardLines, runeLines, milestoneLines, runesDropped };
    }

    const inv = getUserInventory(guildId, userId);

    // ---- 1. Configured guild level rewards (LP / permanent boosts) ----
    if (grantLevelRewards) {
        const { getGuildConfig } = require('./guildConfig');
        const config = getGuildConfig(guildId);
        const levelRewards = Array.isArray(config.levelRewards) ? config.levelRewards : [];
        const claimed = Array.isArray(inv.claimedLevelRewards) ? inv.claimedLevelRewards : [];
        const newRewards = levelRewards.filter((r) => r && r.level && r.level > before.level && r.level <= after.level && !claimed.includes(r.id));

        if (newRewards.length > 0) {
            let lpFromRewards = 0;
            updateUserInventory(guildId, userId, (cur) => {
                const next = { ...cur };
                const cl = Array.isArray(next.claimedLevelRewards) ? [...next.claimedLevelRewards] : [];
                const ab = Array.isArray(next.activeBoosts) ? [...next.activeBoosts] : [];

                for (const rw of newRewards) {
                    cl.push(rw.id);
                    if (rw.type === 'luna_points' && rw.value) {
                        const amount = Math.max(1, Math.floor(Number(rw.value) || 0));
                        lpFromRewards += amount;
                        rewardLines.push(`🌙 +${amount} Luna Points`);
                    } else if (String(rw.type).endsWith('_boost')) {
                        ab.push({ type: rw.type, multiplier: rw.multiplier || 1.25, acquiredAt: Date.now() });
                        const pct = Math.round(((rw.multiplier || 1.25) - 1) * 100);
                        rewardLines.push(`⚡ **${rw.label}** (+${pct}% دائم)`);
                    }
                }

                next.claimedLevelRewards = cl;
                next.activeBoosts = ab;
                return next;
            });

            if (lpFromRewards > 0) addLunaPoints(guildId, userId, lpFromRewards);
        }
    }

    // ---- 2. Milestone bonuses (every 10/25/50/100/250/500 levels) ----
    const crossed = milestonesBetween(before.level, after.level);
    for (const ms of crossed) {
        const msLuna = Math.max(1, Math.floor(ms.luna * lunaMult));
        addLunaPoints(guildId, userId, msLuna);
        lunaGained += msLuna;
        let line = `🏁 **${ms.label}** — مكافأة إنجاز: **+${msLuna}** Luna Points`;

        if (grantRunes && ms.runeTier) {
            const rune = generateRuneForTier(ms.runeTier);
            runesDropped.push(rune);
            updateUserInventory(guildId, userId, (cur) => {
                const next = { ...cur };
                const runes = Array.isArray(next.runes) ? [...next.runes] : [];
                runes.push(rune);
                next.runes = runes;
                return next;
            });
            line += `\n🎁 رونة مضمونة: ${fmtRuneLine(rune)}`;
        }
        milestoneLines.push(line);
    }

    // ---- 3. Rune drop rolls (one roll PER level-up: level-scaled chance + pity) ----
    if (grantRunes) {
        let pity = Math.max(0, Math.floor(Number(inv.runePity) || 0));
        const luck = runeLuckForLevel(after.level);
        const batch = [];

        for (let i = 0; i < levelsGained; i++) {
            const chance = runeDropChance(after.level);
            const guaranteed = pity + 1 >= RUNE_PITY_MAX;
            const dropped = guaranteed || Math.random() < chance;

            if (dropped) {
                const justDropped = generateRuneDrop(luck);
                for (const r of justDropped) batch.push(r);
                pity = 0;
                const why = guaranteed ? ' (مجاناً! ضمان الحظ السيء 🍀)' : '';
                runeLines.push(justDropped.map((r) => `🔮 ${fmtRuneLine(r)}`).join('\n') + why);
            } else {
                pity += 1;
            }
        }

        runesDropped.push(...batch);
        updateUserInventory(guildId, userId, (cur) => {
            const next = { ...cur };
            if (batch.length > 0) {
                const runes = Array.isArray(next.runes) ? [...next.runes] : [];
                for (const r of batch) runes.push(r);
                next.runes = runes;
            }
            next.runePity = pity;
            return next;
        });
    }

    return { before, after, levelsGained, lunaGained, gainedXp, rewardLines, runeLines, milestoneLines, runesDropped };
}

module.exports = {
    MILESTONES,
    RUNE_PITY_MAX,
    milestonesBetween,
    nextMilestone,
    runeDropChance,
    runeLuckForLevel,
    computeUserMultipliers,
    processXpGain
};
