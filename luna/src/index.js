require('dotenv').config({ override: true });

// Load encryption library for Discord voice (must be loaded before @discordjs/voice)
require('libsodium-wrappers');

const { Client, Collection, GatewayIntentBits, Partials, PermissionsBitField, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ── Presence persistence ───────────────────────────────────────────────────
// The owner panel's "تغيير الحالة" is stored under data/ (runtime state, never
// in git) and restored on every boot so a restart no longer resets it.
const PRESENCE_FILE = path.join(__dirname, '..', 'data', 'presence.json');
const DEFAULT_PRESENCE = { status: 'online', type: 'PLAYING', text: 'مع الأوامر!' };

function loadPresence() {
    try {
        const p = JSON.parse(fs.readFileSync(PRESENCE_FILE, 'utf8'));
        if (p && typeof p.status === 'string' && typeof p.type === 'string' && typeof p.text === 'string') {
            return { status: p.status, type: p.type, text: p.text };
        }
    } catch {
        // first run or corrupt file — fall back to the default
    }
    return { ...DEFAULT_PRESENCE };
}

function savePresence(p) {
    try {
        fs.mkdirSync(path.dirname(PRESENCE_FILE), { recursive: true });
        const tmp = `${PRESENCE_FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
        fs.renameSync(tmp, PRESENCE_FILE);
    } catch (err) {
        console.error('presence save failed:', err && err.message ? err.message : err);
    }
}

function activityType(name) {
    const map = {
        PLAYING: ActivityType.Playing,
        WATCHING: ActivityType.Watching,
        LISTENING: ActivityType.Listening,
        COMPETING: ActivityType.Competing,
        STREAMING: ActivityType.Streaming
    };
    return map[String(name || '').toUpperCase()] || ActivityType.Playing;
}

let lootboxSchedulerStarted = false;
let rgbRoleSchedulerStarted = false;
let eventsSchedulerStarted = false;
let shopAnnounceSchedulerStarted = false;
let adminReportReminderStarted = false;
const { getMonitors, addMonitor, removeMonitor, removeMonitorBySource } = require('./monitorStore');
const { getBoostNameAr, formatDurationAr, formatRemainingAr, getActiveXpMultiplier: getActiveXpMultiplierBoost, getActiveLunaMultiplier: getActiveLunaMultiplierBoost, getActiveLevelUpRewardMultiplier: getActiveLevelUpRewardMultiplierBoost } = require('./boostMeta');
const { generateRuneDrop, TIERS, getEquippedRuneMultiplier, fmtRuneLine } = require('./runes');
const { processXpGain, nextMilestone } = require('./levelUpService');
const { xpForNextLevel } = require('./xpCurve');
const { getGuildConfig, updateGuildConfig, emojiKeyFromReaction, emojiKeyFromString, getAllGuildConfigs } = require('./guildConfig');
const { getUserStats, updateUserStats, getGuildUsers, getLunaPoints, addLunaPoints, spendLunaPoints, transferLunaPoints } = require('./levelsStore');
const { getGuildShop, updateGuildShop, getAllGuildShops, getUserInventory, updateUserInventory } = require('./shopStore');
const { createScheduler } = require('./scheduler');
const { THEME } = require('./utils/theme');
const UI = require('./utils/ui');
const { logError } = require('./utils/log');
const { replyEphemeral, deferUpdateSafe, sanitizeDiscordPayload } = require('./utils/respond');
const { isStaff } = require('./utils/permissions');
const { routeInteraction } = require('./handlers/router');
const { getTicketMetaFromChannel, setTicketMetaForChannel, fmtMsShort, fmtDurationPretty, parseDurationLike } = require('./ticketsService');
const { ensureAntiRaidVerifyRole, applyUnverifiedToRecentMembers, setAntiRaidRoleOverwrites } = require('./securityService');

// New modular imports
const {
    createMusicAPI,
    voiceSessions,
    getOrCreateVoiceSession,
    startPlaybackFromFile,
    stopGuildPlayback,
    pauseGuildPlayback,
    resumeGuildPlayback,
    skipGuildTrack,
    getPlayBrowseCache,
    putPlayBrowseCache
} = require('./music');
const { refreshMusicPanelMessage: refreshMusicPanelMessageUI, buildPanelRows, buildCategoryBrowseView } = require('./music/musicUI');
const { handleAIChat, getPendingAction, deletePendingAction, cleanupPendingActions } = require('./ai');
const { xoWinner, xoIsFull, xoRenderComponents } = require('./games');
const eventGames = require('./eventGames');
const { clampNumber, hslToRgbInt, rememberInteractionId, hasRecentInteractionId, cleanupRecentInteractionIds, extractId, lunaPointsRewardForLevel, pickOne, markOnce, normalizeShortcutTrigger, parseAllowTargets, canUseAutoReply } = require('./utils');
const { runShortcutCommand, buildShortcutCommandRows } = require('./utils/shortcutRunner');
const { getWeekKey, nextDailyResetTs, nextWeeklyResetTs, rarityWeight, shopKindAr, pickWeighted, boostMultiplier, stackMult, getActiveXpMultiplier, getActiveLunaMultiplier, getActiveLevelUpRewardMultiplier, getRoleBoostMultiplier } = require('./economy');

// Thin wrapper: musicUI's version takes (guildId, client)
async function refreshMusicPanelMessage(guildId) {
    return refreshMusicPanelMessageUI(guildId, client);
}

function fmtMmSsLocal(ms) {
    const totalSec = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Guards against accidental duplicate processing (reconnects, multiple shards/processes, etc.)
const processedSuggestionMessageIds = new Map(); // messageId -> expiresAt
const pendingSuggestionModerations = new Map(); // key -> { guildId, channelId, messageId, action, createdAt }

function cooldownRemainingMs(guildId, userId, key) {
    try {
        const shop = getGuildShop(guildId);
        const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
        const now = Date.now();
        const last = cd[key] || 0;
        const wait = shopCooldownMs[key] || 0;
        const rem = wait - (now - last);
        return rem > 0 ? rem : 0;
    } catch {
        return 0;
    }
}

const recentInteractionIds = new Map();
const ticketsTickLocks = new Map();
const eventsWinLocks = new Map();
const whispersRate = new Map();
const lootboxTickLocks = new Map();
const rgbRoleTickLocks = new Map();
const eventsTickLocks = new Map();

const xpCooldownMs = 60 * 1000;
const lastXpGain = new Map();
const voiceDailySessions = new Map();

const spamRate = new Map();
const spamLastLog = new Map();

const channelAutoReplyLastMsg = new Map();
// Serialises re-posting per channel so two near-simultaneous messages can't
// each delete-and-send and leave duplicate embeds behind.
const channelAutoReplyBusy = new Set();
// Dedupe guard for word-based auto-replies (gateway reconnects / double dispatch).
const processedAutoReplyMessageIds = new Map();
const processedWhisperMessageIds = new Map();
const repeatSpamMap = new Map();

// Periodic sweep of rate/lock/dedupe maps so none grows unbounded over the
// process lifetime. Values: timestamps (most), {t0,count} windows (spamRate),
// {createdAt} objects (pendingSuggestionModerations).
setInterval(() => {
    const now = Date.now();
    const sweepTs = (map, ttlMs) => {
        for (const [k, v] of map) {
            const ts = typeof v === 'number' ? v : (v && typeof v.t0 === 'number' ? v.t0 : 0);
            if (!ts || now - ts > ttlMs) map.delete(k);
        }
    };
    sweepTs(lastXpGain, 5 * 60 * 1000);
    sweepTs(whispersRate, 5 * 60 * 1000);
    sweepTs(spamRate, 5 * 60 * 1000);
    sweepTs(spamLastLog, 30 * 60 * 1000);
    sweepTs(repeatSpamMap, 10 * 60 * 1000);
    sweepTs(channelAutoReplyLastMsg, 24 * 60 * 60 * 1000);
    sweepTs(ticketsTickLocks, 5 * 60 * 1000);
    sweepTs(eventsWinLocks, 30 * 60 * 1000);
    sweepTs(lootboxTickLocks, 5 * 60 * 1000);
    sweepTs(rgbRoleTickLocks, 5 * 60 * 1000);
    sweepTs(eventsTickLocks, 5 * 60 * 1000);
    // suggestion dedupe map already stores expiry timestamps (markOnce)
    for (const [k, exp] of processedSuggestionMessageIds) {
        if (!exp || now > exp) processedSuggestionMessageIds.delete(k);
    }
    for (const [k, exp] of processedAutoReplyMessageIds) {
        if (!exp || now > exp) processedAutoReplyMessageIds.delete(k);
    }
    for (const [k, exp] of processedWhisperMessageIds) {
        if (!exp || now > exp) processedWhisperMessageIds.delete(k);
    }
    for (const [k, v] of pendingSuggestionModerations) {
        if (!v || !v.createdAt || now - v.createdAt > 30 * 60 * 1000) pendingSuggestionModerations.delete(k);
    }
}, 10 * 60 * 1000).unref();

const inviteCache = new Map();

const antiRaidJoinWindows = new Map();

const scheduler = createScheduler();

const shopCooldownMs = {
    buy: 5 * 1000,
    gift: 30 * 1000,
    bid: 10 * 1000,
    event_win: 10 * 60 * 1000
};

function dayKey(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function getDisplayedTitle(inv) {
    if (!inv) return '';
    const now = Date.now();
    const activeTitle = typeof inv.activeTitle === 'string' ? inv.activeTitle : '';
    if (!activeTitle) return '';
    const titles = Array.isArray(inv.titles) ? inv.titles : [];
    const found = titles.find((t) => t && t.title === activeTitle);
    if (found && typeof found.expiresAt === 'number' && found.expiresAt > 0 && found.expiresAt <= now) {
        return '';
    }
    return activeTitle;
}

function fmtRarity(r) {
    if (r === 'mythic') return 'خرافي 🔮';
    if (r === 'legendary') return 'أسطوري 🏆';
    if (r === 'rare') return 'نادر 💎';
    if (r === 'uncommon') return 'غير شائع 🌿';
    return 'شائع ⭐';
}

function normalizeRarity(r) {
    const s = String(r || '').toLowerCase().trim();
    if (s === 'uncommon' || s === 'uc') return 'uncommon';
    if (s === 'rare') return 'rare';
    if (s === 'legendary') return 'legendary';
    if (s === 'mythic') return 'mythic';
    return 'common';
}

function normalizeRotation(v) {
    const s = String(v || '').toLowerCase().trim();
    if (s === 'daily' || s === 'd') return 'daily';
    if (s === 'weekly' || s === 'w') return 'weekly';
    return 'both';
}

function itemInRotation(item, rotation) {
    const r = normalizeRotation(item && typeof item.rotation === 'string' ? item.rotation : 'both');
    if (r === 'both') return true;
    return r === rotation;
}

function allowMythicInRotation() {
    return Math.random() < 0.05;
}

function ensureRotations(guildId) {
    const shop = getGuildShop(guildId);
    const roleItems = Array.isArray(shop.roleItems) ? shop.roleItems : [];
    const titleItems = Array.isArray(shop.titleItems) ? shop.titleItems : [];
    const allCatalog = [
        ...roleItems.map((x) => ({ ...x, kind: 'role' })),
        ...titleItems.map((x) => ({ ...x, kind: 'title' }))
    ];

    const dailyCatalog = allCatalog.filter((x) => itemInRotation(x, 'daily'));
    const weeklyCatalog = allCatalog.filter((x) => itemInRotation(x, 'weekly'));

    const dailyCatalogKey = dailyCatalog.map((x) => x && x.id).filter(Boolean).sort().join('|');
    const weeklyCatalogKey = weeklyCatalog.map((x) => x && x.id).filter(Boolean).sort().join('|');

    const dk = dayKey();
    const wk = getWeekKey();

    const dailyRefs = (shop.daily && Array.isArray(shop.daily.items)) ? shop.daily.items : [];
    const weeklyRefs = (shop.weekly && Array.isArray(shop.weekly.items)) ? shop.weekly.items : [];

    const dailyResolvedCount = dailyRefs.map((r) => resolveCatalogItem(shop, r)).filter(Boolean).length;
    const weeklyResolvedCount = weeklyRefs.map((r) => resolveCatalogItem(shop, r)).filter(Boolean).length;

    const shouldRegenDaily =
        !shop.daily ||
        shop.daily.dayKey !== dk ||
        (shop.daily.dayKey === dk && (shop.daily.catalogKey || '') !== dailyCatalogKey) ||
        (shop.daily.dayKey === dk && dailyRefs.length === 0 && dailyCatalog.length > 0) ||
        (shop.daily.dayKey === dk && dailyRefs.length > 0 && dailyResolvedCount === 0 && dailyCatalog.length > 0);

    if (shouldRegenDaily) {
        updateGuildShop(guildId, (g) => {
            const next = { ...g };
            const yesterday = (next.daily && Array.isArray(next.daily.items)) ? next.daily.items : [];
            const yesterdayIds = new Set(yesterday.map((x) => x && x.id).filter(Boolean));

            const mythicOk = allowMythicInRotation();
            let dailyForPicks = mythicOk ? dailyCatalog : dailyCatalog.filter((x) => x && x.rarity !== 'mythic');
            if (!dailyForPicks.length && dailyCatalog.length) dailyForPicks = dailyCatalog;

            // Prefer a fresh set that does not overlap with yesterday (if possible)
            const poolFresh = dailyForPicks.filter((x) => x && x.id && !yesterdayIds.has(x.id));
            let picked = pickWeighted(poolFresh, 4);
            if (picked.length < 4) {
                const already = new Set(picked.map((x) => x.id));
                const poolAny = dailyForPicks.filter((x) => x && x.id && !already.has(x.id));
                picked = [...picked, ...pickWeighted(poolAny, 4 - picked.length)];
            }

            const items = picked.slice(0, 4).map((i) => ({ id: i.id, kind: i.kind }));
            next.daily = { dayKey: dk, catalogKey: dailyCatalogKey, items };

            const featuredPick = pickWeighted(dailyForPicks, 1)[0] || null;
            next.featured = { dayKey: dk, item: featuredPick ? { id: featuredPick.id, kind: featuredPick.kind } : null };

            const pct = 3 + Math.floor(Math.random() * 8);
            next.dailyDiscount = { dayKey: dk, percent: pct };
            return next;
        });
    }

    const shouldRegenWeekly =
        !shop.weekly ||
        shop.weekly.weekKey !== wk ||
        (shop.weekly.weekKey === wk && (shop.weekly.catalogKey || '') !== weeklyCatalogKey) ||
        (shop.weekly.weekKey === wk && weeklyRefs.length === 0 && weeklyCatalog.length > 0) ||
        (shop.weekly.weekKey === wk && weeklyRefs.length > 0 && weeklyResolvedCount === 0 && weeklyCatalog.length > 0);

    if (shouldRegenWeekly) {
        updateGuildShop(guildId, (g) => {
            const next = { ...g };
            const lastWeek = (next.weekly && Array.isArray(next.weekly.items)) ? next.weekly.items : [];
            const lastWeekIds = new Set(lastWeek.map((x) => x && x.id).filter(Boolean));

            const mythicOk = allowMythicInRotation();
            let weeklyForPicks = mythicOk ? weeklyCatalog : weeklyCatalog.filter((x) => x && x.rarity !== 'mythic');
            if (!weeklyForPicks.length && weeklyCatalog.length) weeklyForPicks = weeklyCatalog;

            const poolFresh = weeklyForPicks.filter((x) => x && x.id && !lastWeekIds.has(x.id));
            let picked = pickWeighted(poolFresh, 4);
            if (picked.length < 4) {
                const already = new Set(picked.map((x) => x.id));
                const poolAny = weeklyForPicks.filter((x) => x && x.id && !already.has(x.id));
                picked = [...picked, ...pickWeighted(poolAny, 4 - picked.length)];
            }

            const items = picked.slice(0, 4).map((i) => ({ id: i.id, kind: i.kind }));
            next.weekly = { weekKey: wk, catalogKey: weeklyCatalogKey, items };
            return next;
        });
    }
}

function resolveCatalogItem(shop, ref) {
    if (!ref || !ref.id) return null;
    const roleItems = Array.isArray(shop.roleItems) ? shop.roleItems : [];
    const titleItems = Array.isArray(shop.titleItems) ? shop.titleItems : [];
    const found = roleItems.find((x) => x && x.id === ref.id) || titleItems.find((x) => x && x.id === ref.id);
    if (!found) return null;
    const kind = found.roleId ? 'role' : 'title';
    return { ...found, kind };
}

function getStaticShopItems() {
    return [
        { id: 'mystery:box', kind: 'mystery', name: '🎁 صندوق مفاجأة لونا', price: 65, rarity: 'rare', mysteryType: 'box' },
        { id: 'boost:xp25_1h', kind: 'boost', name: '⚡ XP Boost +25% (ساعة)', price: 35, rarity: 'rare', boostType: 'xp_boost_25_1h', durationMs: 60 * 60 * 1000 },
        { id: 'boost:xp15_24h', kind: 'boost', name: '⚡ XP Boost +15% (يوم)', price: 120, rarity: 'rare', boostType: 'xp_boost_15_24h', durationMs: 24 * 60 * 60 * 1000 },
        { id: 'boost:luna25_1h', kind: 'boost', name: '💰 Luna Boost +25% (ساعة)', price: 60, rarity: 'rare', boostType: 'luna_boost_25_1h', durationMs: 60 * 60 * 1000 },
        { id: 'boost:levelup50_1h', kind: 'boost', name: '🏅 Boost مكافأة الترفيع +50% (ساعة)', price: 110, rarity: 'rare', boostType: 'levelup_reward_boost_50_1h', durationMs: 60 * 60 * 1000 },
        { id: 'service:rename_once', kind: 'service', name: '📝 بطاقة تغيير الاسم (مرة واحدة)', price: 75, rarity: 'rare', serviceType: 'rename_once' },
        { id: 'service:xp_transfer', kind: 'service', name: '🎯 خدمة نقل XP (مرة واحدة)', price: 180, rarity: 'rare', serviceType: 'xp_transfer' },
        { id: 'service:shield', kind: 'service', name: '🛡️ درع الحماية (يخفف خسارة إعادة التوازن) (مرة واحدة)', price: 90, rarity: 'rare', serviceType: 'shield' },
        { id: 'service:rebalance', kind: 'service', name: '🔄 إعادة توازن (خصم من الرصيد + تصفير XP) (مرة واحدة)', price: 140, rarity: 'rare', serviceType: 'rebalance' },
        { id: 'service:vip_title', kind: 'service', name: '👑 لقب VIP لمدة 24 ساعة (مرة واحدة)', price: 95, rarity: 'rare', serviceType: 'vip_title' },
        
    ];
}

function getActiveDiscount(guildId, userId) {
    ensureRotations(guildId);
    const shop = getGuildShop(guildId);
    const dk = dayKey();

    const base = shop.dailyDiscount && shop.dailyDiscount.dayKey === dk
        ? Math.max(0, Math.min(20, Math.floor(Number(shop.dailyDiscount.percent) || 0)))
        : 0;

    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const first = cd.firstBuyDayKey === dk ? 0 : 5;

    const percent = Math.min(20, base + first);
    return { percent, base, first };
}

function applyDiscount(cost, percent) {
    const c = Math.max(1, Math.floor(Number(cost) || 0));
    const p = Math.max(0, Math.min(20, Math.floor(Number(percent) || 0)));
    return Math.max(1, Math.floor(c * (100 - p) / 100));
}

function normalizeCouponCode(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .slice(0, 24);
}

function getPendingCoupon(guildId, userId, itemId) {
    const shop = getGuildShop(guildId);
    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const code = typeof cd.couponCode === 'string' ? cd.couponCode : '';
    const forItem = typeof cd.couponForItemId === 'string' ? cd.couponForItemId : '';
    const exp = Number(cd.couponExpiresAt) || 0;
    if (!code || !forItem || !exp) return { code: null, percent: 0 };
    if (Date.now() >= exp) return { code: null, percent: 0 };
    if (String(forItem) !== String(itemId || '')) return { code: null, percent: 0 };

    const c = shop.coupons && typeof shop.coupons === 'object' ? shop.coupons[code] : null;
    if (!c) return { code: null, percent: 0 };
    const maxUses = Math.max(0, Math.floor(Number(c.maxUses) || 0));
    const used = Math.max(0, Math.floor(Number(c.used) || 0));
    if (maxUses > 0 && used >= maxUses) return { code: null, percent: 0 };
    const percent = Math.max(0, Math.min(20, Math.floor(Number(c.percent) || 0)));
    return { code, percent };
}

function canUseCooldown(guildId, userId, key) {
    const shop = getGuildShop(guildId);
    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const now = Date.now();
    const last = cd[key] || 0;
    const wait = shopCooldownMs[key] || 0;
    if (now - last < wait) return false;
    updateGuildShop(guildId, (g) => {
        const next = { ...g };
        next.cooldowns = next.cooldowns || {};
        next.cooldowns[userId] = { ...(next.cooldowns[userId] || {}), [key]: now };
        return next;
    });
    return true;
}

function hasRequiredPermissions(interaction, required) {
    if (!required) return true;
    if (!interaction.member || !interaction.member.permissions) return false;
    try {
        return interaction.member.permissions.has(required);
    } catch {
        return false;
    }
}

async function safeDeleteMessage(message) {
    try {
        if (message && message.deletable) await message.delete();
        // ignore
    } catch {
        // ignore
    }
}

async function sendTempReply(interaction, content, ms = 6000) {
    return interaction.reply({ content, ephemeral: true }).then((msg) => {
        setTimeout(() => {
            safeDeleteMessage(msg);
        }, ms);
    });
}

const guildLogQueues = new Map();
const guildLogQueueTimers = new Map();

async function sendGuildLog(guild, payload, opts = {}) {
    try {
        if (!guild) return;
        const cfg = getGuildConfig(guild.id);

        if (cfg && cfg.logs && typeof cfg.logs === 'object' && cfg.logs.enabled === false) return;
        const category = opts && typeof opts.category === 'string' ? opts.category : null;
        if (category && cfg && cfg.logs && typeof cfg.logs === 'object' && cfg.logs.categories && typeof cfg.logs.categories === 'object') {
            if (cfg.logs.categories[category] === false) return;
        }

        const chId = cfg && typeof cfg.logsChannelId === 'string' ? cfg.logsChannelId : null;
        if (!chId) return;

        const excludeId = cfg && typeof cfg.logsExcludeChannelId === 'string' ? cfg.logsExcludeChannelId : null;
        let sourceChannelId = opts && typeof opts.sourceChannelId === 'string' ? opts.sourceChannelId : null;
        if (!sourceChannelId) {
            const embeds = payload && Array.isArray(payload.embeds) ? payload.embeds : [];
            const desc = embeds[0] && embeds[0].data && typeof embeds[0].data.description === 'string' ? embeds[0].data.description : '';
            const m = desc.match(/<#(\d{5,})>/);
            if (m) sourceChannelId = m[1];
        }
        if (excludeId && sourceChannelId && String(excludeId) === String(sourceChannelId)) return;

        const ch = await guild.channels.fetch(chId).catch(() => null);
        if (!ch || !ch.isTextBased || !ch.isTextBased()) return;

        const hasFiles = payload && payload.files && Array.isArray(payload.files) && payload.files.length > 0;
        const embeds = payload && Array.isArray(payload.embeds) ? payload.embeds : [];
        const content = payload && typeof payload.content === 'string' ? payload.content : null;

        const canBatch = !hasFiles && !content && embeds.length > 0;
        if (!canBatch) {
            await ch.send(payload);
            return;
        }

        const key = `${guild.id}:${ch.id}`;
        const q = guildLogQueues.get(key) || [];
        q.push(...embeds);
        guildLogQueues.set(key, q);

        if (!guildLogQueueTimers.has(key)) {
            const t = setTimeout(async () => {
                guildLogQueueTimers.delete(key);
                const queued = guildLogQueues.get(key) || [];
                guildLogQueues.delete(key);
                if (!queued.length) return;
                const chunks = [];
                let cur = [];
                for (const e of queued) {
                    cur.push(e);
                    if (cur.length >= 10) {
                        chunks.push(cur);
                        cur = [];
                    }
                }
                if (cur.length) chunks.push(cur);
                for (const chunk of chunks) {
                    try {
                        await ch.send({ embeds: chunk });
                    } catch {
                        // ignore
                    }
                }
            }, 2500);
            guildLogQueueTimers.set(key, t);
        }
    } catch {
        // ignore
    }
}

async function tryGetAuditExecutorTag(guild, auditType, targetId) {
    try {
        const { AuditLogEvent, PermissionsBitField } = require('discord.js');
        if (!guild) return null;
        const me = guild.members && guild.members.me ? guild.members.me : null;
        const can = me && me.permissions && me.permissions.has ? me.permissions.has(PermissionsBitField.Flags.ViewAuditLog) : false;
        if (!can) return null;

        const logs = await guild.fetchAuditLogs({ limit: 6, type: auditType }).catch(() => null);
        const entry = logs && logs.entries
            ? [...logs.entries.values()].find((e) => String(e.target?.id || '') === String(targetId || ''))
            : null;
        if (entry && entry.executor) return `${entry.executor}`;
        return null;
    } catch {
        return null;
    }
}

async function runTicketsTick(client) {
    const now = Date.now();
    for (const [, guild] of client.guilds.cache) {
        try {
            const lk = ticketsTickLocks.get(guild.id) || 0;
            if (lk && now < lk) continue;
            ticketsTickLocks.set(guild.id, now + 30_000);

            const cfg = getGuildConfig(guild.id);
            const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
            const activeIds = Array.isArray(tcfg.activeChannelIds) ? tcfg.activeChannelIds.map(String).filter(Boolean) : [];
            if (!activeIds.length) continue;

            const warnMs = Math.max(0, Math.floor(Number(tcfg.noResponseWarnMs) || 0));
            const closeNoRespMs = Math.max(0, Math.floor(Number(tcfg.noResponseCloseMs) || 0));
            const closeInactMs = Math.max(0, Math.floor(Number(tcfg.inactivityCloseMs) || 0));

            const keep = [];

            for (const chId of activeIds) {
                let ch;
                try {
                    ch = await guild.channels.fetch(chId).catch(() => null);
                } catch {
                    ch = null;
                }
                if (!ch || !ch.isTextBased()) continue;

                const meta = getTicketMetaFromChannel(ch);
                if (!meta || meta.closed) {
                    continue;
                }

                keep.push(String(ch.id));

                const createdAt = Number(meta.createdAt) || 0;
                const lastUserMsgAt = Number(meta.lastUserMsgAt) || createdAt;
                const lastStaffMsgAt = Number(meta.lastStaffMsgAt) || 0;
                const lastAnyMsgAt = Math.max(createdAt, lastUserMsgAt, lastStaffMsgAt);

                const shouldWarn = warnMs > 0 && now - lastUserMsgAt >= warnMs && now - lastStaffMsgAt >= warnMs;
                const shouldCloseNoResp = closeNoRespMs > 0 && now - lastUserMsgAt >= closeNoRespMs && now - lastStaffMsgAt >= closeNoRespMs;
                const shouldCloseInact = closeInactMs > 0 && now - lastAnyMsgAt >= closeInactMs;

                const warnKey = 'noResponseWarnedAt';
                const closeKey = 'autoClosedAt';

                if (shouldWarn && !meta[warnKey]) {
                    meta[warnKey] = now;
                    await setTicketMetaForChannel(ch, meta);
                    try {
                        const ownerId = String(meta.ownerId || '');
                        await ch.send({
                            content: `${ownerId ? `<@${ownerId}> ` : ''}⏰ تنبيه: التكت ما صار فيه رد لفترة… إذا ما صار تفاعل ممكن ينقفل تلقائيًا.`,
                            allowedMentions: ownerId ? { users: [ownerId] } : undefined
                        });
                    } catch {
                    }
                }

                if ((shouldCloseNoResp || shouldCloseInact) && !meta[closeKey]) {
                    meta.closed = true;
                    meta.closedAt = now;
                    meta.closedBy = 'automod';
                    meta[closeKey] = now;

                    const openedAt = Number(meta.openedAt) || Number(meta.createdAt) || 0;
                    const openDuration = openedAt ? Math.max(0, now - openedAt) : 0;

                    const ownerId = String(meta.ownerId || '');
                    const staffRoleIds = Array.isArray(meta.staffRoleIds) ? meta.staffRoleIds.map(String).filter(Boolean) : [];
                    // Fire-and-forget permission edits in parallel
                    (async () => {
                        try {
                            const permOps = [];
                            if (ownerId) permOps.push(ch.permissionOverwrites.edit(ownerId, { SendMessages: false }));
                            for (const rid of staffRoleIds) {
                                permOps.push(ch.permissionOverwrites.edit(rid, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true, AttachFiles: true }));
                            }
                            await Promise.all(permOps);
                        } catch {}
                    })();

                    await setTicketMetaForChannel(ch, meta);

                    try {
                        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setColor('#E7D3B0')
                            .setTitle('🔒 تم إغلاق التكت تلقائيًا')
                            .setDescription(`اختار الإجراء من الأزرار تحت 👇${openDuration ? `\n\nمدة بقاء التكت مفتوح: **${fmtDurationPretty(openDuration)}**` : ''}`)
                            .setTimestamp();

                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('ticket:reopen').setLabel('فتح').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId('ticket:delete').setLabel('حذف').setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId('ticket:archive').setLabel('أرشفة').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId('ticket:set_archive').setLabel('تحديد مكان الارشفة').setStyle(ButtonStyle.Primary)
                        );

                        await ch.send({ embeds: [embed], components: [row] });
                    } catch {
                    }

                    try {
                        const { EmbedBuilder } = require('discord.js');
                        const logEmbed = new EmbedBuilder()
                            .setColor('#E7D3B0')
                            .setTitle('🎫 تكت: إغلاق تلقائي')
                            .setDescription(`تم إغلاق التكت تلقائيًا: <#${ch.id}>`)
                            .addFields(
                                { name: 'السبب', value: shouldCloseNoResp ? 'عدم رد' : 'عدم نشاط', inline: false },
                                ...(openDuration ? [{ name: 'مدة بقاء التكت مفتوح', value: fmtDurationPretty(openDuration), inline: false }] : []),
                                { name: 'الإعدادات', value: `warn=${fmtMsShort(warnMs)} closeNoResp=${fmtMsShort(closeNoRespMs)} closeInact=${fmtMsShort(closeInactMs)}`, inline: false }
                            )
                            .setTimestamp();
                        await sendGuildLog(guild, { embeds: [logEmbed] }, { category: 'tickets' });
                    } catch {
                    }
                }
            }


            if (keep.length !== activeIds.length) {
                updateGuildConfig(guild.id, (c) => ({
                    ...c,
                    tickets: {
                        ...(c.tickets && typeof c.tickets === 'object' ? c.tickets : {}),
                        activeChannelIds: keep
                    }
                }));
            }
        } catch {
        } finally {
            ticketsTickLocks.delete(guild.id);
        }
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ── RGB watchdog ───────────────────────────────────────────────────────────
// Independent from the scheduler inside clientReady: if that interval ever
// goes quiet, this timer notices the stale lastOkAt and forces a fresh tick.
let rgbTickCount = 0;
setInterval(() => {
    try {
        if (!client.isReady()) return;
        const now = Date.now();
        for (const [gid, cfg] of Object.entries(getAllGuildConfigs())) {
            const r = cfg && cfg.rgbRole;
            if (!r || !r.roleId || !r.intervalMs) continue;
            const iv = Math.max(2000, Number(r.intervalMs) || 0);
            const last = Number(r.lastOkAt) || 0;
            // Longer than the 5-minute failure backoff, so we don't fight it.
            if (last && (now - last) > Math.max(6 * 60_000, iv * 3)) {
                updateGuildConfig(gid, (c) => ({
                    ...c,
                    rgbRole: { ...(c.rgbRole && typeof c.rgbRole === 'object' ? c.rgbRole : {}), nextAt: now }
                }));
                console.log(`rgbRole watchdog: forcing tick for ${gid} (last ok ${Math.round((now - last) / 1000)}s ago)`);
            }
        }
    } catch (err) {
        console.error('rgbRole watchdog error:', err && err.message ? err.message : err);
    }
}, 30_000);

// Auto-leave: when Luna is alone in a voice channel, leave + stop after a grace period
const aloneLeaveTimers = new Map(); // guildId -> timeout

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const guild = (newState && newState.guild) || (oldState && oldState.guild);
        if (!guild) return;

        const botMember = guild.members.me;
        if (!botMember || !botMember.voice || !botMember.voice.channelId) {
            const t = aloneLeaveTimers.get(guild.id);
            if (t) { clearTimeout(t); aloneLeaveTimers.delete(guild.id); }
            return;
        }

        const channel = guild.channels.cache.get(botMember.voice.channelId);
        if (!channel) return;

        const humans = channel.members.filter((m) => m.user && !m.user.bot);
        const hasHumans = humans.size > 0;

        if (hasHumans) {
            const t = aloneLeaveTimers.get(guild.id);
            if (t) {
                clearTimeout(t);
                aloneLeaveTimers.delete(guild.id);
            }
            return;
        }

        // Alone — schedule leave (only once)
        if (!aloneLeaveTimers.has(guild.id)) {
            const timer = setTimeout(async () => {
                aloneLeaveTimers.delete(guild.id);
                try {
                    const me = guild.members.me;
                    const ch = me && me.voice && me.voice.channelId ? guild.channels.cache.get(me.voice.channelId) : null;
                    if (!ch) return;
                    const stillAlone = ch.members.filter((m) => m.user && !m.user.bot).size === 0;
                    if (!stillAlone) return;

                    await client.music.stop(guild.id);
                    const session = client.music.__getSession(guild.id);
                    try {
                        if (session.connection) session.connection.destroy();
                    } catch { /* ignore */ }
                    session.connection = null;
                    client.music.clearMusicPanel(guild.id);
                } catch {
                    // ignore
                }
            }, 5 * 60 * 1000); // 5 minute grace period
            aloneLeaveTimers.set(guild.id, timer);
        }
    } catch {
        // ignore
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const member = newState && newState.member ? newState.member : (oldState ? oldState.member : null);
        const guild = member && member.guild ? member.guild : null;
        if (!guild) return;
        if (!member || !member.user || member.user.bot) return;

        const oldCh = oldState ? oldState.channelId : null;
        const newCh = newState ? newState.channelId : null;

        const key = `${guild.id}:${member.id}`;
        const now = Date.now();

        const flush = async (channelId, startedAt) => {
            if (!channelId || !startedAt) return;
            const secs = Math.floor((now - startedAt) / 1000);
            if (!secs || secs <= 0) return;

            const cfg = getGuildConfig(guild.id);
            const vcId = cfg && cfg.dailyTasks && typeof cfg.dailyTasks === 'object' && typeof cfg.dailyTasks.voiceChannelId === 'string'
                ? cfg.dailyTasks.voiceChannelId
                : null;
            if (vcId && String(vcId) !== String(channelId)) return;

            const dailyCmd = client.commands.get('daily');
            if (!dailyCmd || typeof dailyCmd.dayKeyUtc !== 'function') return;

            const { getDailyTasksEntry, setDailyTasksEntry } = require('./db');
            const dk = dailyCmd.dayKeyUtc();
            const entry = getDailyTasksEntry(guild.id, member.id, dk);
            const progress = entry && entry.progress && typeof entry.progress === 'object' ? entry.progress : {};
            const next = { ...progress };
            next.voice_20m = Math.max(0, Math.floor(Number(next.voice_20m) || 0)) + secs;
            setDailyTasksEntry(guild.id, member.id, dk, {
                progress: next,
                claimedAt: entry && entry.claimedAt ? entry.claimedAt : 0,
                updatedAt: Date.now()
            });
        };

        if (!oldCh && newCh) {
            voiceDailySessions.set(key, { channelId: newCh, startedAt: now });
            return;
        }

        if (oldCh && !newCh) {
            const sess = voiceDailySessions.get(key);
            if (sess && sess.startedAt && sess.channelId) {
                await flush(sess.channelId, sess.startedAt);
            }
            voiceDailySessions.delete(key);
            return;
        }

        if (oldCh && newCh && String(oldCh) !== String(newCh)) {
            const sess = voiceDailySessions.get(key);
            if (sess && sess.startedAt && sess.channelId) {
                await flush(sess.channelId, sess.startedAt);
            }
            voiceDailySessions.set(key, { channelId: newCh, startedAt: now });
        }
    } catch {
        // ignore
    }
});

client.on('guildMemberAdd', async (member) => {
    try {
        if (!member || !member.guild || !member.user) return;
        if (member.user.bot) return;
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const created = member.user.createdTimestamp ? Math.floor(member.user.createdTimestamp / 1000) : null;
        const joined = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('➕ دخول عضو')
            .setDescription(`العضو: ${member.user}`)
            .setTimestamp();

        if (created) embed.addFields({ name: 'تاريخ إنشاء الحساب', value: `<t:${created}:R>`, inline: true });
        if (joined) embed.addFields({ name: 'دخل السيرفر', value: `<t:${joined}:R>`, inline: true });

        // Invite tracking log (optional, configured under /automod)
        try {
            const cfg = getGuildConfig(member.guild.id);
            const joinInviteLogChannelId = cfg && cfg.automod && typeof cfg.automod === 'object'
                ? (typeof cfg.automod.joinInviteLogChannelId === 'string' ? cfg.automod.joinInviteLogChannelId : null)
                : null;

            if (joinInviteLogChannelId) {
                const me = member.guild.members.me;
                let inviteInfoText = 'غير متاح';

                if (me && me.permissions && me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    const prev = inviteCache.get(String(member.guild.id)) || new Map();
                    const nowInvites = await member.guild.invites.fetch().catch(() => null);
                    const nowMap = new Map();
                    if (nowInvites) {
                        for (const inv of nowInvites.values()) {
                            if (!inv || !inv.code) continue;
                            nowMap.set(String(inv.code), {
                                uses: typeof inv.uses === 'number' ? inv.uses : 0,
                                inviterId: inv.inviter && inv.inviter.id ? String(inv.inviter.id) : null
                            });
                        }
                    }

                    let used = null;
                    for (const [code, info] of nowMap.entries()) {
                        const before = prev.get(code);
                        const beforeUses = before && typeof before.uses === 'number' ? before.uses : 0;
                        const afterUses = info && typeof info.uses === 'number' ? info.uses : 0;
                        if (afterUses > beforeUses) {
                            used = { code, ...info, beforeUses, afterUses };
                            break;
                        }
                    }

                    inviteCache.set(String(member.guild.id), nowMap);

                    if (used) {
                        const inviterTxt = used.inviterId ? `<@${used.inviterId}>` : 'غير معروف';
                        inviteInfoText = `الكود: **${used.code}**\nالمسؤول: ${inviterTxt}\nالاستخدامات: **${used.afterUses}**`;
                    } else {
                        inviteInfoText = 'ما قدرت أحدد الانفايت.';
                    }
                } else {
                    inviteInfoText = 'البوت يحتاج صلاحية Manage Server عشان يتتبع الانفايت.';
                }

                const logCh =
                    member.guild.channels.cache.get(String(joinInviteLogChannelId)) ||
                    (await member.guild.channels.fetch(String(joinInviteLogChannelId)).catch(() => null));

                if (logCh && logCh.isTextBased && logCh.isTextBased()) {
                    const invEmbed = new EmbedBuilder()
                        .setColor('#E7D3B0')
                        .setTitle('📥 دخول عضو + انفايت')
                        .setDescription(`العضو: ${member.user}`)
                        .addFields({ name: 'الانفايت', value: inviteInfoText.slice(0, 1024), inline: false })
                        .setTimestamp();
                    await logCh.send({ embeds: [invEmbed] }).catch(() => null);
                }
            }
        } catch {
            // ignore
        }

        await sendGuildLog(member.guild, { embeds: [embed] }, { category: 'guild' });

        // === Anti-Raid / Verification (only during protection) ===
        try {
            const cfg = getGuildConfig(member.guild.id);
            const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : null;
            if (!ar || ar.enabled !== true) return;

            const now = Date.now();
            const windowMs = Math.max(10_000, Math.floor(Number(ar.joinWindowMs) || 60_000));
            const threshold = Math.max(2, Math.floor(Number(ar.joinThreshold) || 6));
            const lockdownMs = Math.max(60_000, Math.floor(Number(ar.lockdownMs) || (20 * 60_000)));
            const lockdownUntil = Math.max(0, Math.floor(Number(ar.lockdownUntil) || 0));

            // Track joins per guild
            const key = String(member.guild.id);
            const list = antiRaidJoinWindows.get(key) || [];
            const next = list.filter((t) => typeof t === 'number' && now - t <= windowMs);
            next.push(now);
            antiRaidJoinWindows.set(key, next);

            let newlyTriggered = false;
            if ((!lockdownUntil || now >= lockdownUntil) && next.length >= threshold) {
                newlyTriggered = true;
                updateGuildConfig(member.guild.id, (c) => ({
                    ...c,
                    antiRaid: {
                        ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                        lockdownUntil: now + lockdownMs
                    }
                }));
            }

            const ar2 = getGuildConfig(member.guild.id).antiRaid;
            const activeUntil = Math.max(0, Math.floor(Number(ar2 && ar2.lockdownUntil) || 0));
            const lockdownActive = activeUntil && now < activeUntil;
            if (!lockdownActive) return;

            if (!ar2 || ar2.verifyEnabled !== true) return;

            // Ensure Unverified role exists
            const role = await ensureAntiRaidVerifyRole(member.guild, ar2 && ar2.verifyRoleId ? ar2.verifyRoleId : null);
            if (!role) return;

            // Persist role id if newly created
            if (!ar2.verifyRoleId || String(ar2.verifyRoleId) !== String(role.id)) {
                updateGuildConfig(member.guild.id, (c) => ({
                    ...c,
                    antiRaid: {
                        ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                        verifyRoleId: role.id
                    }
                }));
            }

            // Apply channel overwrites once when triggered
            if (newlyTriggered) {
                await setAntiRaidRoleOverwrites(member.guild, role.id, true);
                try {
                    const retroMin = Math.max(0, Math.floor(Number(ar2 && ar2.retroMinutes) || 0));
                    if (retroMin > 0) {
                        await applyUnverifiedToRecentMembers(member.guild, role, retroMin * 60_000);
                    }
                } catch {
                }
                try {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#E7D3B0')
                        .setTitle('🛡️ Anti-Raid: Lockdown Enabled')
                        .setDescription(
                            `Triggered by join rate: **${next.length} joins** in **${Math.floor(windowMs / 1000)}s**\n` +
                            `Lockdown ends: <t:${Math.floor(activeUntil / 1000)}:R>`
                        )
                        .setTimestamp();
                    await sendGuildLog(member.guild, { embeds: [logEmbed] }, { category: 'moderation' });
                } catch {
                }
            }

            // Assign role to the new member
            try {
                const me = member.guild.members.me || (await member.guild.members.fetchMe().catch(() => null));
                if (me && me.roles && me.roles.highest && me.roles.highest.comparePositionTo(role) > 0) {
                    await member.roles.add(role.id, 'Anti-raid lockdown verification');
                }
            } catch {
                // ignore
            }

            // Send verify message (prefer configured verify channel, otherwise system channel, otherwise current log channel if any)
            let targetChId = ar2 && ar2.verifyChannelId ? String(ar2.verifyChannelId) : '';
            if (!targetChId && member.guild.systemChannelId) targetChId = String(member.guild.systemChannelId);
            let targetCh = null;
            if (targetChId) {
                targetCh = member.guild.channels.cache.get(targetChId) || (await member.guild.channels.fetch(targetChId).catch(() => null));
            }
            if (!targetCh || !targetCh.isTextBased || !targetCh.isTextBased()) {
                targetCh = null;
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`verify:${member.guild.id}`).setLabel('✅ Verify').setStyle(ButtonStyle.Success)
            );

            const vEmbed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('✅ Verification Required')
                .setDescription(`Hi ${member.user}! We are in protection mode right now.\nPlease press **Verify** to unlock chat.`)
                .setTimestamp();

            if (targetCh) {
                await targetCh.send({ content: `${member.user}`, embeds: [vEmbed], components: [row] }).catch(() => null);
            } else {
                await member.send({ embeds: [vEmbed], components: [row] }).catch(() => null);
            }
        } catch {
            // ignore
        }
    } catch {
        // ignore
    }
});

// Welcome messages for new members — configured through /welcome.
client.on('guildMemberAdd', async (member) => {
    try {
        console.log('member join event:', member && member.guild ? member.guild.id : 'no-guild', member && member.user ? member.user.tag : 'no-user');
        if (!member || !member.guild || !member.user) return;
        const { getGuildConfig } = require('./guildConfig');
        const { buildWelcomePayload } = require('./welcome');

        const cfg = getGuildConfig(member.guild.id);
        const w = cfg && cfg.welcome;
        if (!w || w.enabled !== true || typeof w.channelId !== 'string' || !w.channelId) return;

        const ch = member.guild.channels.cache.get(w.channelId)
            || await member.guild.channels.fetch(w.channelId).catch(() => null);
        if (!ch || typeof ch.send !== 'function') return;

        const payload = buildWelcomePayload(w, {
            member,
            guild: member.guild,
            count: member.guild.memberCount
        });
        await ch.send(payload);
    } catch (err) {
        console.error('welcome: failed to send:', err && err.message ? err.message : err);
    }
});

// Leave messages — configured from the same /welcome panel.
client.on('guildMemberRemove', async (member) => {
    try {
        console.log('member leave event:', member && member.guild ? member.guild.id : 'no-guild', member && member.user ? member.user.tag : 'no-user');
        if (!member || !member.guild || !member.user) return;
        const { getGuildConfig } = require('./guildConfig');
        const { buildWelcomePayload } = require('./welcome');

        const cfg = getGuildConfig(member.guild.id);
        const w = cfg && cfg.welcome;
        if (!w || w.leaveEnabled !== true) return;

        const channelId = w.leaveChannelId || w.channelId;
        if (!channelId) return;
        const ch = member.guild.channels.cache.get(String(channelId))
            || await member.guild.channels.fetch(String(channelId)).catch(() => null);
        if (!ch || typeof ch.send !== 'function') return;

        const payload = buildWelcomePayload(w, {
            member,
            guild: member.guild,
            count: member.guild.memberCount
        }, 'leave');
        await ch.send(payload);
    } catch (err) {
        console.error('welcome: leave message failed:', err && err.message ? err.message : err);
    }
});

client.on('guildMemberRemove', async (member) => {
    try {
        if (!member || !member.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');

        const targetUser = member.user ? member.user : { id: member.id };
        const executorTag = await tryGetAuditExecutorTag(member.guild, AuditLogEvent.MemberKick, member.id);
        const isKick = !!executorTag;

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle(isKick ? '🦶 Kick' : '➖ خروج عضو')
            .setDescription(`العضو: ${targetUser ? `${targetUser}` : `<@${member.id}>`}` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();

        await sendGuildLog(member.guild, { embeds: [embed] }, { category: isKick ? 'moderation' : 'guild' });
    } catch {
        // ignore
    }
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled promise rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

client.on('error', (err) => {
    console.error('Discord client error:', err);
});

client.on('guildMemberAdd', async (member) => {
    try {
        if (!member || !member.guild || !member.user || member.user.bot) return;
        const inv = getUserInventory(member.guild.id, member.user.id);
        const title = inv && typeof inv.activeTitle === 'string' ? inv.activeTitle.trim() : '';
        if (!title) return;

        const botMember = member.guild.members.me;
        if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)) return;
        if (botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) return;

        const original = member.user.username;
        const nextNickRaw = `${original} | ${title}`;
        const nextNick = nextNickRaw
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 32);

        if (!/@everyone|@here/i.test(nextNick)) {
            await member.setNickname(nextNick, 'Active title');
        }
    } catch {
        // ignore
    }
});

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'))
    .filter(file => !['pause.js', 'resume.js', 'stop.js', 'volume.js', 'loop.js', 'play.js', 'queue.js', 'skip.js', 'nowplaying.js', 'shopadmin.js', 'rgbrole.js', 'roleboosts.js', 'nomsg.js', 'noimages.js'].includes(file));

const commandsData = [];
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    // Skip shortcutsHandler.js as it's not a command
    if (file === 'shortcutsHandler.js') continue;
    const command = require(filePath);
    if (command && command.disabled) continue;
    client.commands.set(command.data.name, command);
    commandsData.push(command.data.toJSON());
}

client.music = createMusicAPI(client);

async function finalizeAuction(guildId) {
    try {
        const shop = getGuildShop(guildId);
        const a = shop.auction;
        if (!a || !a.active) return;

        // Snapshot and close the auction atomically so it can't be processed twice.
        updateGuildShop(guildId, (g) => {
            const next = { ...g };
            next.auction = {
                ...(next.auction || {}),
                active: false,
                highestBid: 0,
                highestBidderId: null,
                settled: true
            };
            return next;
        });

        if (!a.highestBidderId || !a.legendaryRoleId || a.highestBid <= 0) return;

        const bid = Math.max(0, Math.floor(Number(a.highestBid) || 0));
        const winnerId = String(a.highestBidderId);

        // Refund helper — every failure path must return the locked bid.
        const refund = (reason) => {
            try {
                addLunaPoints(guildId, winnerId, bid);
                console.warn(`Auction ${guildId}: refunded ${bid} LP to ${winnerId} (${reason})`);
            } catch (e) {
                console.error('Auction refund failed:', e);
            }
        };

        let guild;
        try {
            guild = await client.guilds.fetch(guildId);
        } catch {
            return refund('guild fetch failed');
        }

        let member;
        try {
            member = await guild.members.fetch(winnerId);
        } catch {
            return refund('winner not in guild');
        }

        const role = guild.roles.cache.get(a.legendaryRoleId);
        if (!role) return refund('role deleted');

        const botMember = guild.members.me;
        if (botMember && botMember.roles.highest.comparePositionTo(role) <= 0) {
            return refund('role hierarchy');
        }

        try {
            await member.roles.add(role.id);
        } catch {
            return refund('role grant failed');
        }
    } catch (err) {
        console.error('Error finalizing auction:', err);
    }
}

// When the client is ready
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    // Restore the owner-configured presence instead of the hardcoded default.
    try {
        const saved = loadPresence();
        client.user.setPresence({
            status: saved.status,
            activities: [{ name: saved.text, type: activityType(saved.type) }]
        });
        console.log(`Presence restored: ${saved.status} / ${saved.type} ${saved.text}`);
    } catch (err) {
        console.error('presence restore failed:', err && err.message ? err.message : err);
        client.user.setActivity(DEFAULT_PRESENCE.text, { type: ActivityType.Playing });
    }

    // Register slash commands automatically
    try {
        const { REST, Routes } = require('discord.js');
        const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
        
        if (DISCORD_TOKEN && CLIENT_ID) {
            const rest = new REST({ version: '10', timeout: 30_000 }).setToken(DISCORD_TOKEN);

            // Always refresh the global set, then push instantly to every guild
            // the bot actually sits in (guild commands override globals).
            // A stale GUILD_ID in .env used to make every registration fail
            // with 50001 Missing Access and left users with no commands.
            // Guild-scoped only. Registering the same command globally as well
            // makes it show up twice in Discord's / picker.
            console.log('Registering slash commands (guilds)...');
            let guilds = [];
            try {
                guilds = await rest.get(Routes.userGuilds());
            } catch (err) {
                console.error('Could not list bot guilds:', err.message);
            }
            for (const g of guilds) {
                try {
                    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, String(g.id)), { body: commandsData });
                } catch (err) {
                    console.error(`Failed guild command registration for ${g.name} (${g.id}):`, err.message);
                }
            }
            console.log(`Successfully registered slash commands (${guilds.length} guilds).`);
        }
    } catch (error) {
        console.error('Failed to register slash commands:', error.message);
    }

    // Start temp role checker for punishLog
    const plCmd = client.commands.get('punishlog');
    if (plCmd && plCmd.startTempRoleChecker) {
        plCmd.startTempRoleChecker(client);
    }

    // Cache invites for join tracking (best-effort)
    try {
        for (const [, g] of client.guilds.cache) {
            try {
                const me = g.members.me;
                if (!me || !me.permissions || !me.permissions.has(PermissionsBitField.Flags.ManageGuild)) continue;
                const invites = await g.invites.fetch().catch(() => null);
                const m = new Map();
                if (invites) {
                    for (const inv of invites.values()) {
                        if (!inv || !inv.code) continue;
                        m.set(String(inv.code), {
                            uses: typeof inv.uses === 'number' ? inv.uses : 0,
                            inviterId: inv.inviter && inv.inviter.id ? String(inv.inviter.id) : null
                        });
                    }
                }
                inviteCache.set(String(g.id), m);
            } catch {
                // ignore
            }
        }
    } catch {
        // ignore
    }

    // Anti-raid tick: auto-disable lockdown when time expires
    try {
        scheduler.addJob('antiRaidTick', 60_000, async () => {
            const now = Date.now();
            for (const [, guild] of client.guilds.cache) {
                try {
                    const cfg = getGuildConfig(guild.id);
                    const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : null;
                    if (!ar || ar.enabled === false) continue;
                    const until = Math.max(0, Math.floor(Number(ar.lockdownUntil) || 0));
                    if (!until || now < until) continue;

                    const roleId = ar.verifyRoleId ? String(ar.verifyRoleId) : '';
                    if (roleId) {
                        await setAntiRaidRoleOverwrites(guild, roleId, false);
                    }

                    updateGuildConfig(guild.id, (c) => ({
                        ...c,
                        antiRaid: {
                            ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                            lockdownUntil: 0
                        }
                    }));
                } catch {
                    // ignore
                }
            }
        });
    } catch {
        // ignore
    }

    // Daily backup tick
    let backupSchedulerStarted = false;
    if (!backupSchedulerStarted) {
        backupSchedulerStarted = true;
        scheduler.addJob('dailyBackup', 60 * 60 * 1000, async () => {
            const { runDailyBackup } = require('./commands/backup');
            if (typeof runDailyBackup !== 'function') return;
            const allConfigs = getAllGuildConfigs();
            for (const [guildId, cfg] of Object.entries(allConfigs)) {
                if (!cfg.backup?.dailyEnabled) continue;
                try {
                    await runDailyBackup(guildId);
                } catch (err) {
                    console.error(`Daily backup failed for guild ${guildId}:`, err);
                }
            }
        });
    }

    // Admin report daily reminder
    if (!adminReportReminderStarted) {
        adminReportReminderStarted = true;
        scheduler.addJob('adminReportReminder', 60 * 60 * 1000, async () => {
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const now = new Date();
            const currentHour = now.getUTCHours();
            const arCmd = client.commands.get('adminreport');
            if (!arCmd) return;
            
            const allConfigs = getAllGuildConfigs();
            for (const [guildId, cfg] of Object.entries(allConfigs)) {
                const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
                if (!ar.enabled || ar.reminderHour < 0 || ar.reminderHour !== currentHour) continue;
                if (!ar.formChannelId) continue;
                
                try {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild) continue;
                    
                    const channel = guild.channels.cache.get(ar.formChannelId);
                    if (!channel || !channel.isTextBased()) continue;
                    
                    const missing = arCmd.getMissingAdmins(guild);
                    if (missing.length === 0) continue;
                    
                    const embed = new EmbedBuilder()
                        .setColor('#E7D3B0')
                        .setTitle('⏰ تذكير: قدم تقريرك اليومي!')
                        .setDescription(
                            `${missing.length} أدمن ما قدموا تقريرهم بعد:\n\n` +
                            missing.slice(0, 10).map(m => `<@${m.id}>`).join('\n') +
                            (missing.length > 10 ? `\n... و${missing.length - 10} أكثر` : '') +
                            '\n\nاضغط الزر تحت عشان تقدم تقريرك.'
                        )
                        .setTimestamp();
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`adminreport:submit:reminder`)
                            .setLabel('قدم تقريرك')
                            .setStyle(ButtonStyle.Success)
                    );
                    
                    await channel.send({ embeds: [embed], components: [row] });
                } catch (err) {
                    console.error(`Admin report reminder failed for guild ${guildId}:`, err);
                }
            }
        });
    }

    setInterval(async () => {
        try {
            const all = getAllGuildShops();
            for (const { guildId, shop } of all) {
                const a = shop.auction;
                if (!a || !a.active) continue;
                if (!a.endsAt || Date.now() < a.endsAt) continue;

                await finalizeAuction(guildId);
            }
        } catch (err) {
            console.error('Error in auction check interval:', err);
        }
    }, 30 * 1000);

    // RGB role: an enabled config must resume right after a restart, even if
    // its saved nextAt was left far in the future by an old failed tick.
    try {
        const bootNow = Date.now();
        for (const [gid, cfg] of Object.entries(getAllGuildConfigs())) {
            const rr = cfg && cfg.rgbRole;
            if (!rr || !rr.roleId || !rr.intervalMs) continue;
            const iv = Math.max(2000, Number(rr.intervalMs) || 0);
            const next = Number(rr.nextAt) || 0;
            if (!next || next > bootNow + iv * 2) {
                updateGuildConfig(gid, (c) => ({
                    ...c,
                    rgbRole: { ...(c.rgbRole && typeof c.rgbRole === 'object' ? c.rgbRole : {}), nextAt: bootNow, failCount: 0 }
                }));
            }
        }
    } catch (err) {
        console.error('rgbRole startup repair failed:', err && err.message ? err.message : err);
    }

    if (!rgbRoleSchedulerStarted) {
        rgbRoleSchedulerStarted = true;
        setInterval(async () => {
            const now = Date.now();
            rgbTickCount += 1;
            if (rgbTickCount % 30 === 0) console.log(`rgbRole alive: ${rgbTickCount} ticks`);
            for (const [, guild] of client.guilds.cache) {
                try {
                    const lk = rgbRoleTickLocks.get(guild.id) || 0;
                    if (lk && now < lk) continue;
                    rgbRoleTickLocks.set(guild.id, now + 5000);

                    const cfg = getGuildConfig(guild.id);
                    const r = cfg.rgbRole && typeof cfg.rgbRole === 'object' ? cfg.rgbRole : null;
                    if (!r || !r.roleId || !r.intervalMs) continue;

                    const failCount = Math.max(0, Math.floor(Number(r.failCount) || 0));

                    const intervalMs = Math.max(2000, Math.floor(Number(r.intervalMs) || 0));
                    const nextAt = Number(r.nextAt) || 0;
                    const lastOkAt = Number(r.lastOkAt) || 0;
                    // Watchdog: if we haven't recoloured for too long, ignore a
                    // stuck nextAt and tick now. This is what keeps RGB alive
                    // after a restart or a temporary Discord hiccup.
                    const stale = lastOkAt > 0 && (now - lastOkAt) > Math.max(30_000, intervalMs * 3);
                    if (nextAt && now < nextAt && !stale) continue;

                    const roleId = String(r.roleId);
                    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
                    if (!role) {
                        const nextFail = failCount + 1;
                        // Never disable the feature on transient failures.
                        // Back off, remember the failure count, and keep retrying.
                        const backoff = Math.min(5 * 60_000, Math.max(intervalMs, 2000) * Math.max(1, nextFail));
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            rgbRole: {
                                ...(c.rgbRole && typeof c.rgbRole === 'object' ? c.rgbRole : {}),
                                roleId,
                                intervalMs,
                                nextAt: now + backoff,
                                failCount: nextFail
                            }
                        }));
                        console.warn(`rgbRole ${guild.id}: ${role ? 'edit failed' : 'role missing'} (${nextFail}) — retry in ${Math.round(backoff / 1000)}s`);
                        continue;
                    }

                    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
                    const canEdit = me
                        && me.permissions.has(PermissionsBitField.Flags.ManageRoles)
                        && me.roles.highest.comparePositionTo(role) > 0;
                    if (!canEdit) {
                        // Permissions or hierarchy are wrong. Back off instead of
                        // spinning every two seconds, but never switch RGB off.
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            rgbRole: {
                                ...(c.rgbRole && typeof c.rgbRole === 'object' ? c.rgbRole : {}),
                                roleId,
                                intervalMs,
                                nextAt: now + Math.max(intervalMs, 30_000)
                            }
                        }));
                        continue;
                    }

                    const hue = typeof r.hue === 'number' ? r.hue : 0;
                    const color = hslToRgbInt(hue, 1, 0.5);

                    try {
                        await role.edit({ colors: { primaryColor: color } });
                    } catch {
                        const nextFail = failCount + 1;
                        // Never disable the feature on transient failures.
                        // Back off, remember the failure count, and keep retrying.
                        const backoff = Math.min(5 * 60_000, Math.max(intervalMs, 2000) * Math.max(1, nextFail));
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            rgbRole: {
                                ...(c.rgbRole && typeof c.rgbRole === 'object' ? c.rgbRole : {}),
                                roleId,
                                intervalMs,
                                nextAt: now + backoff,
                                failCount: nextFail
                            }
                        }));
                        console.warn(`rgbRole ${guild.id}: ${role ? 'edit failed' : 'role missing'} (${nextFail}) — retry in ${Math.round(backoff / 1000)}s`);
                        continue;
                    }

                    updateGuildConfig(guild.id, (c) => ({
                        ...c,
                        rgbRole: {
                            ...(c.rgbRole && typeof c.rgbRole === 'object' ? c.rgbRole : {}),
                            roleId,
                            intervalMs,
                            nextAt: now + intervalMs,
                            hue: (hue + 15) % 360,
                            failCount: 0,
                            lastOkAt: now
                        }
                    }));
                } catch (err) {
                    console.error('rgbRole tick error:', err);
                } finally {
                    rgbRoleTickLocks.delete(guild.id);
                }
            }
        }, 2000);
    }

    if (!lootboxSchedulerStarted) {
        lootboxSchedulerStarted = true;
        setInterval(async () => {
            const now = Date.now();
            for (const [, guild] of client.guilds.cache) {
                try {
                    const lk = lootboxTickLocks.get(guild.id) || 0;
                    if (lk && now < lk) continue;
                    lootboxTickLocks.set(guild.id, now + 15000);

                    const cfg = getGuildConfig(guild.id);
                    const evCfg = cfg.events && typeof cfg.events === 'object' ? cfg.events : null;
                    if (evCfg && evCfg.enabled) continue;
                    const l = cfg.lootboxes && typeof cfg.lootboxes === 'object' ? cfg.lootboxes : null;
                    if (!l || !l.channelId || !l.intervalMs || !l.durationMs) continue;

                    const activeUntil = Number(l.activeUntil) || 0;
                    const activeMessageId = typeof l.activeMessageId === 'string' ? l.activeMessageId : null;
                    const nextAt = Number(l.nextAt) || 0;

                    if (activeMessageId && activeUntil > 0 && now >= activeUntil) {
                        let ch;
                        try {
                            ch = await guild.channels.fetch(l.channelId);
                        } catch {
                            ch = null;
                        }
                        if (ch && ch.isTextBased()) {
                            try {
                                const msg = await ch.messages.fetch(activeMessageId);
                                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                                const embed = new EmbedBuilder()
                                    .setColor('#E7D3B0')
                                    .setTitle('ضاع الصندوق !!')
                                    .setDescription('كان فيه لوت بوكس هنا… بس ضاع مني P:\n\n*استنى اللي بعده… يمكن يكون نصيبك!*')
                                    .setTimestamp();
                                const row = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId('lootbox:expired').setLabel('انتهى').setStyle(ButtonStyle.Secondary).setDisabled(true)
                                );
                                await msg.edit({ embeds: [embed], components: [row] });
                            } catch {
                                // ignore
                            }
                        }

                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            lootboxes: {
                                ...(c.lootboxes && typeof c.lootboxes === 'object' ? c.lootboxes : {}),
                                activeMessageId: null,
                                activeUntil: 0,
                                openedBy: null
                            }
                        }));
                        continue;
                    }

                    if (activeMessageId && activeUntil > now) continue;
                    if (nextAt && now < nextAt) continue;

                    let ch;
                    try {
                        ch = await guild.channels.fetch(l.channelId);
                    } catch {
                        ch = null;
                    }
                    if (!ch || !ch.isTextBased()) {
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            lootboxes: {
                                ...(c.lootboxes && typeof c.lootboxes === 'object' ? c.lootboxes : {}),
                                nextAt: now + Math.min(10 * 60 * 1000, Math.max(30 * 1000, Number(l.intervalMs) || 30 * 1000))
                            }
                        }));
                        continue;
                    }

                    const until = now + Math.max(5000, Math.floor(Number(l.durationMs) || 0));
                    const untilSec = Math.floor(until / 1000);
                    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setColor('#E7D3B0')
                        .setTitle('🎁✨ لوت بوكس ظهر فجأة!')
                        .setDescription(
                            'يا ترا ايش في جواه ؟ 🌙\n' +
                            `ينتهي بعد: <t:${untilSec}:R>`
                        )
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('lootbox:open').setLabel('استكشف الصندوق 🎁').setStyle(ButtonStyle.Success)
                    );

                    let sent;
                    try {
                        sent = await ch.send({ embeds: [embed], components: [row] });
                    } catch {
                        sent = null;
                    }
                    if (!sent) {
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            lootboxes: {
                                ...(c.lootboxes && typeof c.lootboxes === 'object' ? c.lootboxes : {}),
                                nextAt: now + Math.min(10 * 60 * 1000, Math.max(30 * 1000, Number(l.intervalMs) || 30 * 1000))
                            }
                        }));
                        continue;
                    }

                    updateGuildConfig(guild.id, (c) => ({
                        ...c,
                        lootboxes: {
                            ...(c.lootboxes && typeof c.lootboxes === 'object' ? c.lootboxes : {}),
                            nextAt: now + Math.max(10 * 1000, Math.floor(Number(l.intervalMs) || 0)),
                            activeMessageId: sent.id,
                            activeUntil: until,
                            openedBy: null
                        }
                    }));
                } catch (err) {
                    console.error('lootboxes tick error:', err);
                } finally {
                    lootboxTickLocks.delete(guild.id);
                }
            }
        }, 5000);
    }

    if (!eventsSchedulerStarted) {
        eventsSchedulerStarted = true;
        setInterval(async () => {
            const now = Date.now();
            for (const [, guild] of client.guilds.cache) {
                try {
                    const lk = eventsTickLocks.get(guild.id) || 0;
                    if (lk && now < lk) continue;
                    eventsTickLocks.set(guild.id, now + 15000);

                    const cfg = getGuildConfig(guild.id);
                    const e = cfg.events && typeof cfg.events === 'object' ? cfg.events : null;
                    if (!e || !e.enabled || !e.channelId || !e.intervalMs || !e.durationMs) continue;

                    const active = e.active && typeof e.active === 'object' ? e.active : null;
                    if (active && active.until && now < Number(active.until)) continue;
                    if (active && active.until && now >= Number(active.until)) {
                        try {
                            const { addEventHistory } = require('./db');
                            const winners = Array.isArray(active.winners)
                                ? active.winners.map(String).filter(Boolean)
                                : (active.winnerId ? [String(active.winnerId)] : []);
                            addEventHistory(guild.id, {
                                createdAt: now,
                                type: String(active.type || 'unknown'),
                                reward: Math.max(0, Math.floor(Number(active.reward) || 0)),
                                winners,
                                channelId: active.channelId ? String(active.channelId) : null,
                                messageId: active.messageId ? String(active.messageId) : null,
                                meta: {
                                    endedBy: 'timeout',
                                    until: Number(active.until) || 0
                                }
                            });
                        } catch {
                        }
                        // Edit the event embed to show it expired
                        try {
                            const { EmbedBuilder, ActionRowBuilder } = require('discord.js');
                            const eventCh = await guild.channels.fetch(active.channelId);
                            if (eventCh && eventCh.isTextBased() && active.messageId) {
                                const eventMsg = await eventCh.messages.fetch(active.messageId);
                                if (eventMsg) {
                                    const expiredEmbed = new EmbedBuilder()
                                        .setColor('#808080')
                                        .setTitle('⌛ الفعالية انتهت')
                                        .setDescription('انتهت الفعالية للأسف، حظ أوفر المره الجاية 🌙')
                                        .setTimestamp();
                                    const disabledRow = new ActionRowBuilder();
                                    if (eventMsg.components && eventMsg.components[0]) {
                                        for (const btn of eventMsg.components[0].components) {
                                            disabledRow.addComponents(
                                                btn.data ? { ...btn.data, disabled: true } : btn
                                            );
                                        }
                                    }
                                    await eventMsg.edit({ embeds: [expiredEmbed], components: disabledRow.components.length ? [disabledRow] : [] });
                                }
                            }
                        } catch {
                            // ignore edit errors
                        }
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            events: {
                                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                                active: null
                            }
                        }));
                    }

                    const nextAt = Number(e.nextAt) || 0;
                    if (nextAt && now < nextAt) continue;

                    let ch;
                    try {
                        ch = await guild.channels.fetch(e.channelId);
                    } catch {
                        ch = null;
                    }
                    if (!ch || !ch.isTextBased()) {
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            events: {
                                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                                nextAt: now + Math.min(10 * 60 * 1000, Math.max(30 * 1000, Number(e.intervalMs) || 30 * 1000))
                            }
                        }));
                        continue;
                    }

                    const typesEnabled = e.typesEnabled && typeof e.typesEnabled === 'object' ? e.typesEnabled : {};
                    const types = eventGames.enabledTypes(typesEnabled);
                    // "شغّل لعبة محددة" من اللوحة — يتجاوز التفعيل لأن الأدمن طلبها صراحة
                    const forcedType = typeof e.forceType === 'string' && eventGames.GAMES[e.forceType] ? e.forceType : null;
                    if (!types.length && !forcedType) {
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            events: {
                                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                                nextAt: now + Math.max(30 * 1000, Math.floor(Number(e.intervalMs) || 0))
                            }
                        }));
                        continue;
                    }

                    const pick = forcedType || types[Math.floor(Math.random() * types.length)];
                    if (e.forceType) {
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            events: {
                                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                                forceType: null
                            }
                        }));
                    }

                    const rewardMin = Math.max(0, Math.floor(Number(e.rewardMin) || 0));
                    const rewardMax = Math.max(rewardMin, Math.floor(Number(e.rewardMax) || rewardMin));
                    const baseReward = rewardMin === rewardMax
                        ? rewardMin
                        : (rewardMin + Math.floor(Math.random() * (rewardMax - rewardMin + 1)));

                    // ألعاب أصعب = مكافأة أكبر 🧠
                    const rewardMult = eventGames.rewardMultiplierFor(pick);
                    const reward = Math.max(1, Math.round(baseReward * rewardMult));

                    // الألعاب الذكية تحتاج وقت تفكير — فيه حد أدنى لكل نوع
                    const minDuration = eventGames.minDurationMsFor(pick);
                    const until = now + Math.max(minDuration, Math.floor(Number(e.durationMs) || 0));

                    const built = eventGames.buildEvent(pick, { reward, until });
                    if (!built) {
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            events: {
                                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                                nextAt: now + Math.max(30 * 1000, Math.floor(Number(e.intervalMs) || 0))
                            }
                        }));
                        continue;
                    }

                    const embed = built.embed;
                    const rows = built.components;
                    const meta = built.meta;
                    meta.channelId = ch.id;

                    let sent;
                    try {
                        sent = await ch.send({ embeds: [embed], components: rows });
                    } catch {
                        sent = null;
                    }

                    if (!sent) {
                        updateGuildConfig(guild.id, (c) => ({
                            ...c,
                            events: {
                                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                                nextAt: now + Math.min(10 * 60 * 1000, Math.max(30 * 1000, Number(e.intervalMs) || 30 * 1000))
                            }
                        }));
                        continue;
                    }

                    meta.messageId = sent.id;
                    updateGuildConfig(guild.id, (c) => ({
                        ...c,
                        events: {
                            ...(c.events && typeof c.events === 'object' ? c.events : {}),
                            nextAt: now + Math.max(10 * 1000, Math.floor(Number(e.intervalMs) || 0)),
                            active: meta
                        }
                    }));
                } catch (err) {
                    console.error('events tick error:', err);
                } finally {
                    eventsTickLocks.delete(guild.id);
                }
            }
        }, 5000);
    }

    // إعلانات تغيّر عروض المتجر 🛒 (كل دقيقة — تنرسل عند تبدّل اللفة اليومية/الأسبوعية)
    if (!shopAnnounceSchedulerStarted) {
        shopAnnounceSchedulerStarted = true;
        const { runShopAnnounceTick } = require('./shopService');
        setInterval(async () => {
            try {
                await runShopAnnounceTick(client);
            } catch {
            }
        }, 60_000);
    }

    setInterval(async () => {
        try {
            await runTicketsTick(client);
        } catch {
        }
    }, 20_000);
});

// Command handler
client.on('interactionCreate', async interaction => {
    const startTs = Date.now();
    let autoDeferTimer = null;
    try {
        try {
            if (interaction && !interaction.__lunaSanitized) {
                const wrapMethod = (name) => {
                    const fn = interaction[name];
                    if (typeof fn !== 'function') return;
                    interaction[name] = async (arg, ...rest) => {
                        try {
                            if (typeof arg === 'string') {
                                const p = sanitizeDiscordPayload({ content: arg });
                                return await fn.call(interaction, p.content, ...rest);
                            }
                            if (arg && typeof arg === 'object') {
                                return await fn.call(interaction, sanitizeDiscordPayload(arg), ...rest);
                            }
                            return await fn.call(interaction, arg, ...rest);
                        } catch (e) {
                            throw e;
                        }
                    };
                };

                wrapMethod('reply');
                wrapMethod('followUp');
                wrapMethod('editReply');
                wrapMethod('deferReply');
                interaction.__lunaSanitized = true;
            }
        } catch {
            // ignore
        }

        cleanupRecentInteractionIds();
        if (interaction && interaction.id && hasRecentInteractionId(interaction.id)) {
            return;
        }
        rememberInteractionId(interaction && interaction.id ? interaction.id : null);

        // Auto-defer for slow handlers to avoid DiscordAPIError[10062] Unknown interaction.
        // Discord requires an acknowledgement within ~3 seconds.
        try {
            autoDeferTimer = setTimeout(async () => {
                try {
                    if (!interaction || interaction.deferred || interaction.replied) return;
                    if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    } else if (interaction.isButton && interaction.isButton()) {
                        await interaction.deferUpdate();
                    }
                } catch {
                    // ignore
                }
            }, 2500);
        } catch {
            // ignore
        }

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                try {
                    return interaction.reply({ content: 'آسف بس الأمر هذا مو محمّل عندي… جرّب إعادة تشغيل البوت 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }
            if (command.disabled) {
                return interaction.reply({ content: 'هذا الأمر متعطل حاليًا ✨ استخدم `/help` عشان تشوف الأوامر المتاحة.', flags: MessageFlags.Ephemeral });
            }
            try {
                await command.execute(interaction);
            } catch (err) {
                console.error(`Command /${interaction.commandName} failed:`, err);
                try {
                    if (interaction.deferred || interaction.replied) {
                        return interaction.followUp({ content: 'آسف صار خطأ وأنا أنفّذ الأمر 3:', flags: MessageFlags.Ephemeral });
                    }
                    return interaction.reply({ content: 'آسف صار خطأ وأنا أنفّذ الأمر 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            try {
                if (interaction.guild) {
                    const adminCmds = new Set(['timeout', 'ban', 'kick', 'mute', 'unmute']);
                    if (adminCmds.has(String(interaction.commandName || '').toLowerCase())) {
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setColor('#E7D3B0')
                            .setTitle('🛡️ أمر إداري')
                            .setDescription(`الأمر: **/${interaction.commandName}**\nبواسطة: ${interaction.user}${interaction.channelId ? `\nالروم: <#${interaction.channelId}>` : ''}`)
                            .setTimestamp();
                        await sendGuildLog(interaction.guild, { embeds: [embed] }, { sourceChannelId: interaction.channelId || null });
                    }
                }
            } catch {
                // ignore
            }
            return;
        }

        try {
            const handled = await routeInteraction({ client, interaction });
            if (handled) return;
        } catch {
            // ignore
        }

        // === OWNER PANEL HANDLERS ===
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('owner:')) {
            const {
                EmbedBuilder,
                ActionRowBuilder,
                ButtonBuilder,
                ButtonStyle,
                StringSelectMenuBuilder,
                ModalBuilder,
                TextInputBuilder,
                TextInputStyle,
                PermissionsBitField,
                ChannelType,
                AttachmentBuilder,
                MessageFlags
                , ActivityType
                } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const parts = interaction.customId.split(':');
            const action = parts[1];

            // Bot Info
            if (action === 'botinfo') {
                const guilds = client.guilds.cache;
                const totalMembers = guilds.reduce((acc, g) => acc + (g.memberCount || 0), 0);
                const uptime = process.uptime();
                const days = Math.floor(uptime / 86400);
                const hours = Math.floor((uptime % 86400) / 3600);
                const mins = Math.floor((uptime % 3600) / 60);

                const embed = new EmbedBuilder()
                    .setColor(0x2c2c54)
                    .setTitle('📊 تقرير حالة البوت')
                    .setDescription('فيما يلي المعلومات التقنية والتشغيلية للنظام:')
                    .addFields(
                        { name: 'عدد السيرفرات', value: `${guilds.size}`, inline: true },
                        { name: 'إجمالي الأعضاء', value: `${totalMembers}`, inline: true },
                        { name: 'وقت التشغيل', value: `${days} يوم، ${hours} ساعة، ${mins} دقيقة`, inline: true },
                        { name: 'الذاكرة المستخدمة', value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true },
                        { name: 'نسخة Node.js', value: process.version, inline: true },
                        { name: 'المنصة', value: process.platform, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'نظام الإدارة المتقدم' });

                try {
                    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            // Guilds Management
            if (action === 'guilds') {
                const guilds = [...client.guilds.cache.values()]
                    .map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount || 0 }))
                    .sort((a, b) => b.memberCount - a.memberCount);

                if (!guilds.length) {
                    try {
                        return interaction.reply({ content: 'البوت غير مسجل في أي سيرفر حالياً.', flags: MessageFlags.Ephemeral });
                    } catch {
                        return;
                    }
                }

                const options = guilds.slice(0, 25).map((g) => ({
                    label: (g.name || g.id).slice(0, 100),
                    description: `الأعضاء: ${g.memberCount}`.slice(0, 100),
                    value: g.id
                }));

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('owner:guildselect')
                        .setPlaceholder('اختر السيرفر المطلوب')
                        .addOptions(options)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('owner:guildsinfo')
                        .setLabel('تصدير معلومات السيرفرات')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📄')
                );

                const note = guilds.length > 25 ? `\n\nملاحظة: يتم عرض أول 25 سيرفر من أصل ${guilds.length}.` : '';

                try {
                    return interaction.reply({
                        content: `**🏰 إدارة السيرفرات**\nاختر السيرفر الذي ترغب في إدارته:${note}`,
                        components: [row, row2],
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    return;
                }
            }

            // Export Guilds Info
            if (action === 'guildsinfo') {
                try {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    }
                } catch {
                    // ignore
                }

                const guilds = [...client.guilds.cache.values()]
                    .map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount || 0 }))
                    .sort((a, b) => b.memberCount - a.memberCount);

                if (!guilds.length) {
                    try {
                        return interaction.editReply({ content: 'البوت غير مسجل في أي سيرفر حالياً.' });
                    } catch {
                        return;
                    }
                }

                const lines = [];
                lines.push(`إجمالي السيرفرات: ${guilds.length}`);
                lines.push('');

                for (const item of guilds) {
                    const g = client.guilds.cache.get(item.id);
                    if (!g) continue;

                    let ownerTxt = 'غير معروف';
                    try {
                        const owner = await g.fetchOwner();
                        ownerTxt = owner && owner.user ? `${owner.user.tag} (${owner.user.id})` : ownerTxt;
                    } catch {
                        // ignore
                    }

                    let inviteTxt = 'لا يوجد';
                    try {
                        const me = g.members.me || (await g.members.fetchMe().catch(() => null));
                        if (me) {
                            const channels = [...g.channels.cache.values()];
                            const candidate = channels.find((ch) => {
                                if (!ch || !ch.isTextBased || !ch.isTextBased()) return false;
                                if (!ch.viewable) return false;
                                if (ch.type === ChannelType.GuildForum) return false;
                                if (typeof ch.createInvite !== 'function') return false;
                                const perms = ch.permissionsFor(me);
                                if (!perms) return false;
                                return perms.has(PermissionsBitField.Flags.CreateInstantInvite);
                            });

                            if (candidate) {
                                const inv = await candidate.createInvite({ maxAge: 0, maxUses: 0, unique: true }).catch(() => null);
                                if (inv && inv.url) inviteTxt = inv.url;
                            }
                        }
                    } catch {
                        // ignore
                    }

                    lines.push(`- الاسم: ${g.name}`);
                    lines.push(`  المعرف: ${g.id}`);
                    lines.push(`  الأعضاء: ${g.memberCount || item.memberCount || 0}`);
                    lines.push(`  المالك: ${ownerTxt}`);
                    lines.push(`  الدعوة: ${inviteTxt}`);
                    lines.push('');
                }

                const text = lines.join('\n').slice(0, 190000);
                const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'guilds_report.txt' });

                try {
                    return interaction.editReply({ content: 'تم إعداد التقرير بنجاح.', files: [file] });
                } catch {
                    try {
                        return interaction.editReply({ content: 'تم إعداد التقرير ولكن تعذر إرسال الملف.' });
                    } catch {
                        return;
                    }
                }
            }

            // Grant Role
            if (action === 'grantrole') {
                const guilds = [...client.guilds.cache.values()].slice(0, 25);
                const options = guilds.map((g) => ({
                    label: g.name.slice(0, 100),
                    description: `ID: ${g.id}`,
                    value: g.id
                }));

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('owner:roleselectguild')
                        .setPlaceholder('اختر السيرفر')
                        .addOptions(options)
                );

                try {
                    return interaction.reply({
                        content: '**👑 منح رتبة**\nاختر السيرفر الذي ترغب في منح الرتبة فيه:',
                        components: [row],
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    return;
                }
            }

            // Remove Role
            if (action === 'removerole') {
                const guilds = [...client.guilds.cache.values()].slice(0, 25);
                const options = guilds.map((g) => ({
                    label: g.name.slice(0, 100),
                    description: `ID: ${g.id}`,
                    value: g.id
                }));

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('owner:rmroleselectguild')
                        .setPlaceholder('اختر السيرفر')
                        .addOptions(options)
                );

                try {
                    return interaction.reply({
                        content: '**🗑️ سحب رتبة**\nاختر السيرفر الذي ترغب في سحب الرتبة منه:',
                        components: [row],
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    return;
                }
            }

            // Execute Code (Eval)
            if (action === 'eval') {
                const modal = new ModalBuilder()
                    .setCustomId('owner:evalmodal')
                    .setTitle('تنفيذ كود JavaScript');

                const codeInput = new TextInputBuilder()
                    .setCustomId('code')
                    .setLabel('الكود')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(codeInput));

                try {
                    return interaction.showModal(modal);
                } catch {
                    return;
                }
            }

            // Refresh Data
            if (action === 'refresh') {
                try {
                    // Force reload guild configs
                    let reloaded = 0;
                    for (const [guildId] of client.guilds.cache) {
                        try {
                            getGuildConfig(guildId);
                            reloaded++;
                        } catch {}
                    }

                    return interaction.reply({
                        content: `تم تحديث البيانات بنجاح.\nعدد السيرفرات المعالجة: ${reloaded}`,
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    return;
                }
            }

            // Broadcast Message - Step 1: Show server dropdown
            if (action === 'broadcast') {
                const guilds = [...client.guilds.cache.values()]
                    .map(g => ({ label: g.name.slice(0, 100), description: `${g.memberCount} عضو`, value: g.id }))
                    .sort((a, b) => a.label.localeCompare(b.label));

                if (!guilds.length) {
                    return interaction.reply({ content: 'البوت غير مسجل في أي سيرفر حالياً.', flags: MessageFlags.Ephemeral });
                }

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('owner:broadcast:guild')
                        .setPlaceholder('اختر السيرفر')
                        .addOptions(guilds.slice(0, 25))
                );

                return interaction.reply({
                    content: '📣 اختر السيرفر اللي تريد إرسال الرسالة فيه:',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Change Presence
            if (action === 'presence') {
                const modal = new ModalBuilder()
                    .setCustomId('owner:presencemodal')
                    .setTitle('تغيير حالة البوت');

                const statusInput = new TextInputBuilder()
                    .setCustomId('status')
                    .setLabel('الحالة (online, idle, dnd)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('online أو idle أو dnd')
                    .setValue('online')
                    .setRequired(true);

                const typeInput = new TextInputBuilder()
                    .setCustomId('type')
                    .setLabel('نوع النشاط (PLAYING, WATCHING)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('WATCHING')
                    .setValue('WATCHING')
                    .setRequired(true);

                const textInput = new TextInputBuilder()
                    .setCustomId('text')
                    .setLabel('نص النشاط')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('مثلاً: with Luna')
                    .setValue('with Luna')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(statusInput));
                modal.addComponents(new ActionRowBuilder().addComponents(typeInput));
                modal.addComponents(new ActionRowBuilder().addComponents(textInput));

                try {
                    return interaction.showModal(modal);
                } catch {
                    return;
                }
            }

            // Set/Remove Owner
            if (action === 'setowner') {
                const modal = new ModalBuilder()
                    .setCustomId('owner:setownermodal')
                    .setTitle('تعيين أو حذف معرف المالك');

                const idInput = new TextInputBuilder()
                    .setCustomId('ownerid')
                    .setLabel('معرف المالك الجديد (اتركه فارغاً للحذف)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('1380557535391514725');

                modal.addComponents(new ActionRowBuilder().addComponents(idInput));

                try {
                    return interaction.showModal(modal);
                } catch {
                    return;
                }
            }

            // Export CSV
            if (action === 'exportcsv') {
                try {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    }
                } catch {}

                const guilds = [...client.guilds.cache.values()].sort((a,b)=> (b.memberCount||0)-(a.memberCount||0));
                const rows = ['id,name,memberCount,owner,invite'];
                for (const g of guilds) {
                    let ownerTxt = '';
                    try {
                        const owner = await g.fetchOwner();
                        ownerTxt = owner && owner.user ? `${owner.user.tag.replace(/"/g,'""')} (${owner.user.id})` : '';
                    } catch {}
                    let inviteTxt = '';
                    try {
                        const me = g.members.me || (await g.members.fetchMe().catch(()=>null));
                        if (me) {
                            const channels = [...g.channels.cache.values()];
                            const candidate = channels.find((ch)=> ch && ch.isTextBased && ch.isTextBased() && ch.viewable && typeof ch.createInvite==='function');
                            if (candidate) {
                                const inv = await candidate.createInvite({ maxAge:0, maxUses:0, unique:true }).catch(()=>null);
                                if (inv && inv.url) inviteTxt = inv.url;
                            }
                        }
                    } catch {}

                    const safeName = (g.name||'').replace(/"/g,'""');
                    rows.push(`"${g.id}","${safeName}","${g.memberCount||0}","${ownerTxt}","${inviteTxt}"`);
                }

                const csv = rows.join('\n').slice(0, 190000);
                const file = new AttachmentBuilder(Buffer.from(csv,'utf8'), { name: 'guilds_report.csv' });
                try {
                    return interaction.editReply({ content: 'تم إعداد ملف CSV.', files: [file] });
                } catch {
                    try { return interaction.editReply({ content: 'تعذّر إرسال الملف.' }); } catch {}
                }
            }

            // Monitor - Show monitor management panel
            if (action === 'monitor') {
                const monitors = getMonitors();

                const ownerCmd = client.commands.get('owner');
                const buildEmbed = ownerCmd && typeof ownerCmd.buildMonitorPanelEmbed === 'function' ? ownerCmd.buildMonitorPanelEmbed : null;

                const embed = buildEmbed ? buildEmbed(monitors) : new EmbedBuilder().setTitle('🔍 مراقبة الرسائل').setColor(0x2c2c54);

                const rows = [];

                if (monitors.length > 0) {
                    // Show monitors as select menu
                    const options = monitors.slice(0, 25).map((m, i) => ({
                        label: `مصدر: ${m.sourceChannelId}`.slice(0, 100),
                        description: `هدف: ${m.targetChannelId}`.slice(0, 100),
                        value: String(i)
                    }));

                    const selectRow = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('owner:monitorselect')
                            .setPlaceholder('اختر مراقبة لحذفها')
                            .addOptions(options)
                    );
                    rows.push(selectRow);
                }

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('owner:monitoradd')
                        .setLabel('➕ إضافة مراقبة')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('➕'),
                    new ButtonBuilder()
                        .setCustomId('owner:monitorrefresh')
                        .setLabel('🔄 تحديث')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔄')
                );
                rows.push(actionRow);

                try {
                    return interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            // Monitor - Add (show modal)
            if (action === 'monitoradd') {
                const modal = new ModalBuilder()
                    .setCustomId('owner:monitor:modal')
                    .setTitle('➕ إضافة مراقبة رسائل');

                const sourceChannelInput = new TextInputBuilder()
                    .setCustomId('sourceChannelId')
                    .setLabel('🔹 آيدي قناة المصدر')
                    .setPlaceholder('ضع آيدي القناة اللي تبغى تراقبها (رقم)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const targetChannelInput = new TextInputBuilder()
                    .setCustomId('targetChannelId')
                    .setLabel('🔹 آيدي قناة الهدف')
                    .setPlaceholder('ضع آيدي القناة اللي تبغى ترسل لها الرسائل المراقَبة')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const sourceGuildInput = new TextInputBuilder()
                    .setCustomId('sourceGuildId')
                    .setLabel('🔹 آيدي سيرفر المصدر (اختياري)')
                    .setPlaceholder('إذا كانت القناة المصدر بسيرفر ثاني، اكتب آيدي السيرفر')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);

                const row1 = new ActionRowBuilder().addComponents(sourceChannelInput);
                const row2 = new ActionRowBuilder().addComponents(targetChannelInput);
                const row3 = new ActionRowBuilder().addComponents(sourceGuildInput);

                modal.addComponents(row1, row2, row3);

                try {
                    return interaction.showModal(modal);
                } catch {
                    return;
                }
            }

            // Monitor - Refresh
            if (action === 'monitorrefresh') {
                const monitors = getMonitors();
                const ownerCmd = client.commands.get('owner');
                const buildEmbed = ownerCmd && typeof ownerCmd.buildMonitorPanelEmbed === 'function' ? ownerCmd.buildMonitorPanelEmbed : null;
                const embed = buildEmbed ? buildEmbed(monitors) : new EmbedBuilder().setTitle('🔍 مراقبة الرسائل').setColor(0x2c2c54);

                const rows = [];
                if (monitors.length > 0) {
                    const options = monitors.slice(0, 25).map((m, i) => ({
                        label: `مصدر: ${m.sourceChannelId}`.slice(0, 100),
                        description: `هدف: ${m.targetChannelId}`.slice(0, 100),
                        value: String(i)
                    }));
                    const selectRow = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('owner:monitorselect')
                            .setPlaceholder('اختر مراقبة لحذفها')
                            .addOptions(options)
                    );
                    rows.push(selectRow);
                }

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('owner:monitoradd')
                        .setLabel('➕ إضافة مراقبة')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('➕'),
                    new ButtonBuilder()
                        .setCustomId('owner:monitorrefresh')
                        .setLabel('🔄 تحديث')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔄')
                );
                rows.push(actionRow);

                try {
                    return interaction.update({ embeds: [embed], components: rows });
                } catch {
                    return;
                }
            }

            // Restart Bot
            if (action === 'restart') {
                try {
                    await interaction.reply({ content: 'جارٍ إعادة تشغيل البوت... (سيتم إيقاف العملية بعد إغلاق الجلسة)', flags: MessageFlags.Ephemeral });
                } catch {}
                try {
                    await client.destroy();
                } catch {}
                setTimeout(()=>process.exit(0), 1000);
                return;
            }
        }

        // Broadcast: Select server dropdown
        if (interaction.isStringSelectMenu() && interaction.customId === 'owner:broadcast:guild') {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try { return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const guildId = interaction.values?.[0];
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                return interaction.update({ content: 'السيرفر غير موجود.', components: [] });
            }

            const channels = [...guild.channels.cache.values()]
                .filter(ch => ch.isTextBased() && ch.viewable)
                .map(ch => ({ label: ch.name.slice(0, 100), description: `روم نصي`, value: ch.id }))
                .sort((a, b) => a.label.localeCompare(b.label));

            if (!channels.length) {
                return interaction.update({ content: 'لا توجد رومات نصية في هذا السيرفر.', components: [] });
            }

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`owner:broadcast:channel:${guildId}`)
                    .setPlaceholder('اختر الروم')
                    .addOptions(channels.slice(0, 25))
            );

            return interaction.update({
                content: `📣 السيرفر: **${guild.name}**\nاختر الروم`,
                components: [row],
                flags: MessageFlags.Ephemeral
            });
        }

        // Broadcast: Select channel → show message modal
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('owner:broadcast:channel:')) {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try { return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const channelParts = interaction.customId.split(':');
            const guildId = channelParts[3];
            const channelId = interaction.values?.[0];

            if (!channelId) {
                return interaction.update({ content: 'لم يتم اختيار روم.', components: [] });
            }

            const channel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
            const channelName = channel ? `#${channel.name}` : channelId;

            const modal = new ModalBuilder()
                .setCustomId(`owner:broadcastmodal:${guildId}:${channelId}`)
                .setTitle(`📣 بث رسالة → ${channelName}`);

            const msgInput = new TextInputBuilder()
                .setCustomId('message')
                .setLabel('نص الرسالة')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder('اكتب رسالتك هنا...');

            modal.addComponents(new ActionRowBuilder().addComponents(msgInput));

            return interaction.showModal(modal);
        }

        // Owner: Guild Select (for leave)
        if (interaction.isStringSelectMenu() && interaction.customId === 'owner:guildselect') {
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const guildId = interaction.values?.[0];
            if (!guildId) {
                try {
                    return interaction.update({ content: 'تعذر تحديد السيرفر المحدد.', components: [] });
                } catch {
                    return;
                }
            }

            const g = client.guilds.cache.get(guildId);
            const label = g ? `${g.name} (${g.id})` : guildId;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`owner:leave:${guildId}`).setLabel('مغادرة السيرفر').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('owner:cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
            );

            try {
                return interaction.update({
                    content: `**تأكيد المغادرة**\nهل أنت متأكد من رغبتك في مغادرة السيرفر التالي؟\n**${label}**`,
                    components: [row]
                });
            } catch {
                return;
            }
        }

        // Owner: Role Select Guild
        if (interaction.isStringSelectMenu() && interaction.customId === 'owner:roleselectguild') {
            const { ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const guildId = interaction.values?.[0];
            const g = client.guilds.cache.get(guildId);
            if (!g) {
                try {
                    return interaction.update({ content: 'السيرفر غير موجود.', components: [] });
                } catch {
                    return;
                }
            }

            const roles = [...g.roles.cache.values()]
                .filter((r) => r && r.name !== '@everyone' && !r.managed)
                .sort((a, b) => (b.position || 0) - (a.position || 0))
                .slice(0, 25)
                .map((r) => ({
                    label: r.name.slice(0, 100),
                    description: r.editable ? `ID: ${r.id}` : `غير قابل للإسناد (Hierarchy)`.slice(0, 100),
                    value: `${guildId}:${r.id}`
                }));

            if (!roles.length) {
                try {
                    return interaction.update({ content: 'لا توجد رتب قابلة للتعديل في هذا السيرفر.', components: [] });
                } catch {
                    return;
                }
            }

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('owner:roleselectrole')
                    .setPlaceholder('اختر الرتبة')
                    .addOptions(roles)
            );

            try {
                return interaction.update({
                    content: `**${g.name}**\nاختر الرتبة التي ترغب في منحها:`,
                    components: [row]
                });
            } catch {
                return;
            }
        }

        // Owner: Remove Role - Guild Select
        if (interaction.isStringSelectMenu() && interaction.customId === 'owner:rmroleselectguild') {
            const { ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const guildId = interaction.values?.[0];
            const g = client.guilds.cache.get(guildId);
            if (!g) {
                try {
                    return interaction.update({ content: 'السيرفر غير موجود.', components: [] });
                } catch {
                    return;
                }
            }

            const roles = [...g.roles.cache.values()]
                .filter((r) => r && r.name !== '@everyone' && !r.managed)
                .sort((a, b) => (b.position || 0) - (a.position || 0))
                .slice(0, 25)
                .map((r) => ({
                    label: r.name.slice(0, 100),
                    description: r.editable ? `ID: ${r.id}` : `غير قابل للتعديل (Hierarchy)`.slice(0, 100),
                    value: `${guildId}:${r.id}`
                }));

            if (!roles.length) {
                try {
                    return interaction.update({ content: 'لا توجد رتب قابلة للتعديل في هذا السيرفر.', components: [] });
                } catch {
                    return;
                }
            }

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('owner:rmroleselectrole')
                    .setPlaceholder('اختر الرتبة')
                    .addOptions(roles)
            );

            try {
                return interaction.update({
                    content: `**${g.name}**\nاختر الرتبة التي ترغب في سحبها:`,
                    components: [row]
                });
            } catch {
                return;
            }
        }

        // Owner: Role Select Role
        if (interaction.isStringSelectMenu() && interaction.customId === 'owner:roleselectrole') {
            const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const val = interaction.values?.[0];
            if (!val) {
                try {
                    return interaction.update({ content: 'تعذر تحديد الرتبة.', components: [] });
                } catch {
                    return;
                }
            }

            const [guildId, roleId] = val.split(':');
            const g = client.guilds.cache.get(guildId);
            if (!g) {
                try {
                    return interaction.update({ content: 'السيرفر غير موجود.', components: [] });
                } catch {
                    return;
                }
            }

            const role = g.roles.cache.get(roleId);
            if (!role) {
                try {
                    return interaction.update({ content: 'الرتبة غير موجودة.', components: [] });
                } catch {
                    return;
                }
            }

            const modal = new ModalBuilder()
                .setCustomId(`owner:grantmodal:${guildId}:${roleId}`)
                .setTitle(`منح رتبة: ${role.name}`);

            const userInput = new TextInputBuilder()
                .setCustomId('userid')
                .setLabel('معرف المستخدم (User ID)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(userInput));

            try {
                return interaction.showModal(modal);
            } catch {
                return;
            }
        }

        // Owner: Remove Role - Role Select
        if (interaction.isStringSelectMenu() && interaction.customId === 'owner:rmroleselectrole') {
            const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const val = interaction.values?.[0];
            if (!val) {
                try {
                    return interaction.update({ content: 'تعذر تحديد الرتبة.', components: [] });
                } catch {
                    return;
                }
            }

            const [guildId, roleId] = val.split(':');
            const g = client.guilds.cache.get(guildId);
            if (!g) {
                try {
                    return interaction.update({ content: 'السيرفر غير موجود.', components: [] });
                } catch {
                    return;
                }
            }

            const role = g.roles.cache.get(roleId);
            if (!role) {
                try {
                    return interaction.update({ content: 'الرتبة غير موجودة.', components: [] });
                } catch {
                    return;
                }
            }

            const modal = new ModalBuilder()
                .setCustomId(`owner:rmmodal:${guildId}:${roleId}`)
                .setTitle(`سحب رتبة: ${role.name}`);

            const userInput = new TextInputBuilder()
                .setCustomId('userid')
                .setLabel('معرف المستخدم (User ID)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(userInput));

            try {
                return interaction.showModal(modal);
            } catch {
                return;
            }
        }

        // Owner: Leave Guild Confirmation
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('owner:leave:')) {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const guildId = interaction.customId.split(':')[2];
            const g = client.guilds.cache.get(guildId);
            if (!g) {
                try {
                    return interaction.update({ content: 'البوت غير موجود في السيرفر المحدد.', components: [] });
                } catch {
                    return;
                }
            }

            const name = g.name;
            try {
                await g.leave();
                return interaction.update({ content: `تمت المغادرة بنجاح من: **${name}** (${guildId})`, components: [] });
            } catch {
                try {
                    return interaction.update({ content: 'تعذرت عملية المغادرة من السيرفر.', components: [] });
                } catch {
                    return;
                }
            }
        }

        // Owner: Cancel
        if (interaction.isButton() && interaction.customId === 'owner:cancel') {
            try {
                return interaction.update({ content: 'تم إلغاء العملية.', components: [] });
            } catch {
                return;
            }
        }

        // Owner: Monitor Select (Delete)
        if (interaction.isStringSelectMenu() && interaction.customId === 'owner:monitorselect') {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try { return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const monitors = getMonitors();
            const index = parseInt(interaction.values[0], 10);
            if (isNaN(index) || index < 0 || index >= monitors.length) {
                try { return interaction.reply({ content: '❌ مؤشر غير صالح.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const removed = monitors[index];
            removeMonitor(index);

            // Rebuild and update
            const updated = getMonitors();
            const ownerCmd = client.commands.get('owner');
            const buildEmbed = ownerCmd && typeof ownerCmd.buildMonitorPanelEmbed === 'function' ? ownerCmd.buildMonitorPanelEmbed : null;
            const embed = buildEmbed ? buildEmbed(updated) : new EmbedBuilder().setTitle('🔍 مراقبة الرسائل').setColor(0x2c2c54);

            const rows = [];
            if (updated.length > 0) {
                const options = updated.slice(0, 25).map((m, i) => ({
                    label: `مصدر: ${m.sourceChannelId}`.slice(0, 100),
                    description: `هدف: ${m.targetChannelId}`.slice(0, 100),
                    value: String(i)
                }));
                const selectRow = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('owner:monitorselect')
                        .setPlaceholder('اختر مراقبة لحذفها')
                        .addOptions(options)
                );
                rows.push(selectRow);
            }

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('owner:monitoradd')
                    .setLabel('➕ إضافة مراقبة')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('➕'),
                new ButtonBuilder()
                    .setCustomId('owner:monitorrefresh')
                    .setLabel('🔄 تحديث')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄')
            );
            rows.push(actionRow);

            try {
                await interaction.update({ embeds: [embed], components: rows });
            } catch {
                try { await interaction.editReply({ embeds: [embed], components: rows }); } catch {}
            }

            // Confirm deletion
            try {
                await interaction.followUp({ content: `✅ تم حذف المراقبة: <#${removed.sourceChannelId}> ← <#${removed.targetChannelId}>`, flags: MessageFlags.Ephemeral });
            } catch {}
            return;
        }

        // Owner: Eval Modal Submit
        if (interaction.isModalSubmit() && interaction.customId === 'owner:evalmodal') {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const code = interaction.fields.getTextInputValue('code');
            try {
                const evaled = await eval(code);
                const output = typeof evaled === 'string' ? evaled : require('util').inspect(evaled, { depth: 0 });
                const truncated = output.slice(0, 1900);

                return interaction.reply({
                    content: `**نتيجة التنفيذ:**\n\`\`\`js\n${truncated}\n\`\`\``,
                    flags: MessageFlags.Ephemeral
                });
            } catch (err) {
                return interaction.reply({
                    content: `**خطأ في التنفيذ:**\n\`\`\`js\n${String(err).slice(0, 1900)}\n\`\`\``,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Owner: Presence Modal Submit
        if (interaction.isModalSubmit() && interaction.customId === 'owner:presencemodal') {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const statusRaw = String(interaction.fields.getTextInputValue('status') || '').trim().toLowerCase();
            const typeRaw = String(interaction.fields.getTextInputValue('type') || '').trim().toUpperCase();
            const text = String(interaction.fields.getTextInputValue('text') || '').trim();

            const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
            const typeMap = {
                PLAYING: ActivityType.Playing,
                WATCHING: ActivityType.Watching,
                LISTENING: ActivityType.Listening,
                COMPETING: ActivityType.Competing,
                STREAMING: ActivityType.Streaming
            };

            const status = statusMap[statusRaw] || 'online';
            const type = typeMap[typeRaw] || ActivityType.Playing;
            const typeName = Object.prototype.hasOwnProperty.call(typeMap, typeRaw) ? typeRaw : 'PLAYING';
            const activityText = text || 'مع الأوامر!';

            try {
                client.user.setPresence({
                    status,
                    activities: [{ name: activityText, type }]
                });
                // Persist so the next restart restores exactly this presence.
                savePresence({ status, type: typeName, text: activityText });
                return interaction.reply({ content: `✅ تم تحديث الحالة وحفظها: **${status}** — **${typeName} ${activityText}**`, flags: MessageFlags.Ephemeral });
            } catch (err) {
                return interaction.reply({ content: `صار خطأ وأنا أحدث الحالة: \`${String(err).slice(0, 500)}\``, flags: MessageFlags.Ephemeral });
            }
        }

        // Owner: Set/Remove Owner Modal Submit
        if (interaction.isModalSubmit() && interaction.customId === 'owner:setownermodal') {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const raw = String(interaction.fields.getTextInputValue('ownerid') || '').trim();
            if (raw && !/^\d{15,20}$/.test(raw)) {
                return interaction.reply({ content: 'المعرف غير صحيح — لازم يكون رقم سنو فليج (15-20 رقم).', flags: MessageFlags.Ephemeral });
            }

            // Runtime-only: updates the owner for this process (env is not persisted).
            if (raw) {
                process.env.OWNER_ID = raw;
                return interaction.reply({ content: `✅ تم تعيين المالك الجديد: **${raw}** (يُطبّق حتى إعادة التشغيل)`, flags: MessageFlags.Ephemeral });
            }
            process.env.OWNER_ID = '';
            return interaction.reply({ content: '✅ تم حذف معرف المالك (يُطبّق حتى إعادة التشغيل)', flags: MessageFlags.Ephemeral });
        }

        // Owner: Grant Role Modal Submit
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('owner:grantmodal:')) {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const parts = interaction.customId.split(':');
            const guildId = parts[2];
            const roleId = parts[3];
            const userId = interaction.fields.getTextInputValue('userid');

            const g = client.guilds.cache.get(guildId);
            if (!g) {
                try {
                    return interaction.reply({ content: 'السيرفر غير موجود.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const role = g.roles.cache.get(roleId);
            if (!role) {
                try {
                    return interaction.reply({ content: 'الرتبة غير موجودة.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (!role.editable) {
                try {
                    return interaction.reply({
                        content: 'لا يمكنني منح هذه الرتبة حالياً بسبب ترتيب الرتب (Role Hierarchy). اجعل رتبة البوت أعلى من هذه الرتبة ثم أعد المحاولة.',
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    return;
                }
            }

            try {
                const member = await g.members.fetch(userId);
                await member.roles.add(role);
                return interaction.reply({
                    content: `تم منح الرتبة **${role.name}** للمستخدم <@${userId}> في السيرفر **${g.name}**.`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (err) {
                return interaction.reply({
                    content: `تعذر منح الرتبة. الخطأ: ${String(err).slice(0, 500)}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Owner: Remove Role Modal Submit
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('owner:rmmodal:')) {
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const parts = interaction.customId.split(':');
            const guildId = parts[2];
            const roleId = parts[3];
            const userId = interaction.fields.getTextInputValue('userid');

            const g = client.guilds.cache.get(guildId);
            if (!g) {
                try {
                    return interaction.reply({ content: 'السيرفر غير موجود.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const role = g.roles.cache.get(roleId);
            if (!role) {
                try {
                    return interaction.reply({ content: 'الرتبة غير موجودة.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (!role.editable) {
                try {
                    return interaction.reply({
                        content: 'لا يمكنني سحب هذه الرتبة حالياً بسبب ترتيب الرتب (Role Hierarchy). اجعل رتبة البوت أعلى من هذه الرتبة ثم أعد المحاولة.',
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    return;
                }
            }

            try {
                const member = await g.members.fetch(userId);
                await member.roles.remove(role);
                return interaction.reply({
                    content: `تم سحب الرتبة **${role.name}** من المستخدم <@${userId}> في السيرفر **${g.name}**.`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (err) {
                return interaction.reply({
                    content: `تعذر سحب الرتبة. الخطأ: ${String(err).slice(0, 500)}`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Owner: Broadcast Modal Submit
        if (interaction.isModalSubmit() && interaction.customId.startsWith('owner:broadcastmodal:')) {
            const { MessageFlags, PermissionsBitField } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try { return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const [, , guildId, channelId] = interaction.customId.split(':');
            const msg = (interaction.fields.getTextInputValue('message') || '').trim();

            if (!msg) {
                try { return interaction.reply({ content: 'نص الرسالة مطلوب.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                try { return interaction.reply({ content: 'السيرفر غير موجود.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const channel = guild.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased()) {
                try { return interaction.reply({ content: 'الروم غير موجود أو ليس روم نصي.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
            if (!me || !channel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)) {
                try { return interaction.reply({ content: 'ليس لدي صلاحية الإرسال في هذا الروم.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            try {
                await channel.send({ content: msg });
                try { return interaction.reply({ content: `✅ تم إرسال الرسالة بنجاح إلى **${guild.name}** > ${channel}`, flags: MessageFlags.Ephemeral }); } catch { return; }
            } catch (e) {
                try { return interaction.reply({ content: `❌ فشل الإرسال: ${String(e).slice(0, 200)}`, flags: MessageFlags.Ephemeral }); } catch { return; }
            }
        }

        // Owner: Monitor Modal Submit
        if (interaction.isModalSubmit() && interaction.customId === 'owner:monitor:modal') {
            const { MessageFlags } = require('discord.js');
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try { return interaction.reply({ content: 'عذراً، هذا الإجراء مخصص لصاحب البوت فقط.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            const sourceChannelId = (interaction.fields.getTextInputValue('sourceChannelId') || '').trim();
            const targetChannelId = (interaction.fields.getTextInputValue('targetChannelId') || '').trim();
            const sourceGuildId = (interaction.fields.getTextInputValue('sourceGuildId') || '').trim();

            if (!sourceChannelId || !targetChannelId) {
                try { return interaction.reply({ content: '❌ آيدي قناة المصدر والهدف مطلوبان.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            // Auto-detect source guild if not specified
            let guildId = sourceGuildId || interaction.guild?.id || null;

            // Try to find source channel to auto-detect guild
            if (!guildId) {
                // Search all guilds for the source channel
                for (const [, g] of client.guilds.cache) {
                    const ch = g.channels.cache.get(sourceChannelId);
                    if (ch) {
                        guildId = g.id;
                        break;
                    }
                }
            }

            if (!guildId) {
                try { return interaction.reply({ content: '❌ لم يتم العثور على سيرفر المصدر. تأكد من كتابة آيدي القناة أو تحديد آيدي السيرفر.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            // Check if target channel is valid (exists and bot can see it)
            const targetChannel = client.channels.cache.get(targetChannelId);
            if (!targetChannel || !targetChannel.isTextBased()) {
                try { return interaction.reply({ content: '❌ قناة الهدف غير موجودة أو ليست قناة نصية.', flags: MessageFlags.Ephemeral }); } catch { return; }
            }

            try {
                addMonitor(guildId, sourceChannelId, targetChannelId);

                // Rebuild the monitor panel
                const monitors = getMonitors();
                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
                const ownerCmd = client.commands.get('owner');
                const buildEmbed = ownerCmd && typeof ownerCmd.buildMonitorPanelEmbed === 'function' ? ownerCmd.buildMonitorPanelEmbed : null;
                const embed = buildEmbed ? buildEmbed(monitors) : new EmbedBuilder().setTitle('🔍 مراقبة الرسائل').setColor(0x2c2c54);

                const rows = [];
                if (monitors.length > 0) {
                    const options = monitors.slice(0, 25).map((m, i) => ({
                        label: `مصدر: ${m.sourceChannelId}`.slice(0, 100),
                        description: `هدف: ${m.targetChannelId}`.slice(0, 100),
                        value: String(i)
                    }));
                    const selectRow = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('owner:monitorselect')
                            .setPlaceholder('اختر مراقبة لحذفها')
                            .addOptions(options)
                    );
                    rows.push(selectRow);
                }

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('owner:monitoradd')
                        .setLabel('➕ إضافة مراقبة')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('➕'),
                    new ButtonBuilder()
                        .setCustomId('owner:monitorrefresh')
                        .setLabel('🔄 تحديث')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🔄')
                );
                rows.push(actionRow);

                try {
                    await interaction.reply({
                        content: `✅ تم إضافة المراقبة! <#${sourceChannelId}> ← <#${targetChannelId}>`,
                        embeds: [embed],
                        components: rows,
                        flags: MessageFlags.Ephemeral
                    });
                } catch {}
            } catch (e) {
                try { return interaction.reply({ content: `❌ فشل إضافة المراقبة: ${String(e).slice(0, 200)}`, flags: MessageFlags.Ephemeral }); } catch { return; }
            }
        }

        // === AUTOREACT UI HANDLERS ===
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('autoreact:')) {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
            
            if (!interaction.guild) {
                return interaction.reply({ content: 'عذراً، هذا الأمر يعمل فقط داخل السيرفر.', flags: MessageFlags.Ephemeral });
            }
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: 'عذراً، تحتاج صلاحية Manage Messages.', flags: MessageFlags.Ephemeral });
            }

            const action = interaction.customId.split(':')[1];
            const cfg = getGuildConfig(interaction.guild.id);
            const ar = cfg.autoReactions && typeof cfg.autoReactions === 'object' ? cfg.autoReactions : {};

            // Setup - Channel selection
            if (action === 'setup') {
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('autoreact:channelselect')
                        .setPlaceholder('اختر الروم')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );
                return interaction.reply({
                    content: '**⚡ الرياكشن التلقائي**\nاختر الروم المستهدف:',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Exclude roles
            if (action === 'exclude') {
                const row = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('autoreact:roleselect')
                        .setPlaceholder('اختر الرتب المستثناة (يمكن اختيار متعدد)')
                        .setMinValues(0)
                        .setMaxValues(5)
                );
                return interaction.reply({
                    content: '**🚫 استثناء رتب**\nاختر الرتب التي لن يُطبق عليها الرياكشن التلقائي:',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Toggle
            if (action === 'toggle') {
                const chId = ar.channelId;
                const emojis = Array.isArray(ar.emojis) ? ar.emojis : [];
                if (chId && emojis.length > 0) {
                    updateGuildConfig(interaction.guild.id, (c) => ({
                        ...c,
                        autoReactions: { ...ar, channelId: null }
                    }));
                    return interaction.update({
                        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚡ الرياكشن التلقائي').setDescription('تم تعطيل الرياكشن التلقائي.')],
                        components: []
                    });
                } else {
                    return interaction.reply({
                        content: 'يرجى إعداد الروم والإيموجيات أولاً باستخدام زر "تفعيل"',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            // Preview
            if (action === 'preview') {
                const chId = ar.channelId || null;
                const emojis = Array.isArray(ar.emojis) ? ar.emojis : [];
                const excludedRoles = Array.isArray(ar.excludedRoles) ? ar.excludedRoles : [];
                const embed = new EmbedBuilder()
                    .setColor(chId && emojis.length ? 0x57f287 : 0xed4245)
                    .setTitle('⚡ معاينة الإعدادات')
                    .addFields(
                        { name: '📍 الروم', value: chId ? `<#${chId}>` : 'غير محدد', inline: true },
                        { name: '🎭 الإيموجيات', value: emojis.length ? emojis.join(' ') : 'غير محدد', inline: true },
                        { name: '🚫 مستثنى', value: excludedRoles.length ? excludedRoles.map(r => `<@&${r}>`).join(', ') : 'لا يوجد', inline: false }
                    );
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            // Clear
            if (action === 'clear') {
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    autoReactions: { channelId: null, emojis: [], excludedRoles: [] }
                }));
                return interaction.update({
                    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚡ الرياكشن التلقائي').setDescription('تم إعادة تعيين جميع الإعدادات.')],
                    components: []
                });
            }
        }

        // Autoreact: Channel Select
        if (interaction.isChannelSelectMenu() && interaction.customId === 'autoreact:channelselect') {
            const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: 'عذراً، تحتاج صلاحية Manage Messages.', flags: MessageFlags.Ephemeral });
            }
            const channelId = interaction.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`autoreact:emojimodal:${channelId}`)
                .setTitle('إعداد الإيموجيات')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('emojis')
                            .setLabel('الإيموجيات (افصل بينها بمسافات)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('😀 ❤️ 👍 🎉 😎')
                            .setRequired(true)
                            .setMaxLength(100)
                    )
                );
            return interaction.showModal(modal);
        }

        // Autoreact: Role Select (for exclusion)
        if (interaction.isRoleSelectMenu() && interaction.customId === 'autoreact:roleselect') {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: 'عذراً، تحتاج صلاحية Manage Messages.', flags: MessageFlags.Ephemeral });
            }
            const roleIds = interaction.values;
            updateGuildConfig(interaction.guild.id, (c) => {
                const ar = c.autoReactions && typeof c.autoReactions === 'object' ? c.autoReactions : {};
                return {
                    ...c,
                    autoReactions: { ...ar, excludedRoles: roleIds }
                };
            });
            return interaction.reply({
                content: `**🚫 تم التحديث**\nالرتب المستثناة: ${roleIds.length > 0 ? roleIds.map(r => `<@&${r}>`).join(', ') : 'لا يوجد'}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Autoreact: Emoji Modal Submit
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('autoreact:emojimodal:')) {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: 'عذراً، تحتاج صلاحية Manage Messages.', flags: MessageFlags.Ephemeral });
            }
            const channelId = interaction.customId.split(':')[2];
            const emojisRaw = interaction.fields.getTextInputValue('emojis');
            const emojis = String(emojisRaw || '').trim().split(/\s+/g).map(s => s.trim()).filter(Boolean).slice(0, 10);
            
            if (!emojis.length) {
                return interaction.reply({ content: 'يرجى إدخال إيموجي واحد على الأقل.', flags: MessageFlags.Ephemeral });
            }
            
            updateGuildConfig(interaction.guild.id, (c) => {
                const ar = c.autoReactions && typeof c.autoReactions === 'object' ? c.autoReactions : {};
                return {
                    ...c,
                    autoReactions: { ...ar, channelId, emojis }
                };
            });
            
            return interaction.reply({
                content: `**⚡ تم التفعيل**\n📍 الروم: <#${channelId}>\n🎭 الإيموجيات: ${emojis.join(' ')}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // === SUGGESTIONS UI HANDLERS ===
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('suggestions:') && 
            !interaction.customId.includes(':approve:') && !interaction.customId.includes(':reject:') && 
            !interaction.customId.includes(':edit:') && !interaction.customId.includes(':delete:')) {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
            
            if (!interaction.guild) {
                return interaction.reply({ content: 'عذراً، هذا الأمر يعمل فقط داخل السيرفر.', flags: MessageFlags.Ephemeral });
            }
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
                return interaction.reply({ content: 'عذراً، تحتاج صلاحية Manage Channels.', flags: MessageFlags.Ephemeral });
            }

            const action = interaction.customId.split(':')[1];
            const cfg = getGuildConfig(interaction.guild.id);

            // Setup - Channel selection
            if (action === 'setup') {
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('suggestions:channelselect')
                        .setPlaceholder('اختر روم الاقتراحات')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );
                return interaction.reply({
                    content: '**💡 نظام الاقتراحات**\nاختر روم الاقتراحات:',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Approved channel
            if (action === 'approved') {
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('suggestions:approvedselect')
                        .setPlaceholder('اختر روم الاقتراحات المقبولة (اختياري)')
                        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );
                return interaction.reply({
                    content: '**✅ روم المقبولة**\nاختر روم نقل الاقتراحات المقبولة (يمكن تركه فارغاً للإلغاء):',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Toggle
            if (action === 'toggle') {
                const chId = cfg.suggestionsChannelId;
                if (chId) {
                    updateGuildConfig(interaction.guild.id, (c) => ({ ...c, suggestionsChannelId: null }));
                    return interaction.update({
                        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('💡 نظام الاقتراحات').setDescription('تم تعطيل نظام الاقتراحات.')],
                        components: []
                    });
                } else {
                    return interaction.reply({ content: 'يرجى تحديد روم الاقتراحات أولاً.', flags: MessageFlags.Ephemeral });
                }
            }

            // Preview
            if (action === 'preview') {
                const chId = cfg.suggestionsChannelId || null;
                const approvedId = cfg.suggestionsApprovedChannelId || null;
                const embed = new EmbedBuilder()
                    .setColor(chId ? 0x5865f2 : 0xed4245)
                    .setTitle('💡 معاينة الإعدادات')
                    .addFields(
                        { name: '📝 روم الاقتراحات', value: chId ? `<#${chId}>` : 'غير محدد', inline: true },
                        { name: '✅ روم المقبولة', value: approvedId ? `<#${approvedId}>` : 'غير محدد', inline: true }
                    );
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            // Clear
            if (action === 'clear') {
                updateGuildConfig(interaction.guild.id, (c) => ({ ...c, suggestionsChannelId: null, suggestionsApprovedChannelId: null }));
                return interaction.update({
                    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('💡 نظام الاقتراحات').setDescription('تم إعادة تعيين جميع الإعدادات.')],
                    components: []
                });
            }
        }

        // Suggestions: Channel Select
        if (interaction.isChannelSelectMenu() && interaction.customId === 'suggestions:channelselect') {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
                return interaction.reply({ content: 'عذراً، تحتاج صلاحية Manage Channels.', flags: MessageFlags.Ephemeral });
            }
            const channelId = interaction.values[0];
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, suggestionsChannelId: channelId }));
            return interaction.reply({
                content: `**💡 تم التحديث**\n📝 روم الاقتراحات: <#${channelId}>`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Suggestions: Approved Channel Select
        if (interaction.isChannelSelectMenu() && interaction.customId === 'suggestions:approvedselect') {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
                return interaction.reply({ content: 'عذراً، تحتاج صلاحية Manage Channels.', flags: MessageFlags.Ephemeral });
            }
            const channelId = interaction.values[0];
            if (channelId) {
                updateGuildConfig(interaction.guild.id, (c) => ({ ...c, suggestionsApprovedChannelId: channelId }));
                return interaction.reply({
                    content: `**✅ تم التحديث**\n✅ روم المقبولة: <#${channelId}>`,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                updateGuildConfig(interaction.guild.id, (c) => ({ ...c, suggestionsApprovedChannelId: null }));
                return interaction.reply({ content: '**✅ تم إلغاء** روم الاقتراحات المقبولة.', flags: MessageFlags.Ephemeral });
            }
        }

        // === SUGGESTION OWNER EDIT/DELETE HANDLERS ===
        if (interaction.isButton() && typeof interaction.customId === 'string' && 
            (interaction.customId.startsWith('suggestions:edit:') || interaction.customId.startsWith('suggestions:delete:'))) {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
            
            const parts = interaction.customId.split(':');
            const action = parts[1]; // edit or delete
            const ownerId = parts[2];
            const messageId = parts[3];

            // Check if user is the owner
            if (String(interaction.user.id) !== String(ownerId)) {
                return interaction.reply({ content: 'عذراً، فقط صاحب الاقتراح يمكنه تعديله أو حذفه.', flags: MessageFlags.Ephemeral });
            }

            if (action === 'delete') {
                try {
                    await interaction.message.delete();
                    return interaction.reply({ content: '✅ تم حذف الاقتراح.', flags: MessageFlags.Ephemeral });
                } catch (err) {
                    return interaction.reply({ content: '❌ تعذر حذف الاقتراح.', flags: MessageFlags.Ephemeral });
                }
            }

            if (action === 'edit') {
                // Get current content from embed
                const currentEmbed = interaction.message.embeds[0];
                const currentContent = currentEmbed?.description || '';
                
                const modal = new ModalBuilder()
                    .setCustomId(`suggestions:editmodal:${messageId}`)
                    .setTitle('تعديل الاقتراح')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('newcontent')
                                .setLabel('محتوى الاقتراح الجديد')
                                .setStyle(TextInputStyle.Paragraph)
                                .setValue(currentContent.replace(/\*بدون نص\*/g, ''))
                                .setRequired(true)
                                .setMaxLength(4000)
                        )
                    );
                return interaction.showModal(modal);
            }
        }

        // Suggestions: Edit Modal Submit
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('suggestions:editmodal:')) {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const messageId = interaction.customId.split(':')[2];
            const newContent = interaction.fields.getTextInputValue('newcontent');
            
            try {
                const currentEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(currentEmbed)
                    .setDescription(newContent.slice(0, 4000));
                
                await interaction.update({ embeds: [updatedEmbed] });
                return interaction.followUp({ content: '✅ تم تعديل الاقتراح بنجاح.', flags: MessageFlags.Ephemeral });
            } catch (err) {
                return interaction.reply({ content: '❌ تعذر تعديل الاقتراح.', flags: MessageFlags.Ephemeral });
            }
        }

        // Suggestions: Approve/Reject modal (admin)
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('suggestions:mod:')) {
            if (!interaction.guild) return;
            if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                try { return await interaction.reply({ content: 'اسفة بس تحتاج صلاحية Administrator 3:', ephemeral: true }); } catch { return; }
            }

            const key = interaction.customId.split(':')[2] || '';
            const pending = key ? pendingSuggestionModerations.get(key) : null;
            if (!pending) {
                try { return await interaction.reply({ content: 'انتهت صلاحية الطلب… جرّب مرة ثانية 3:', ephemeral: true }); } catch { return; }
            }
            pendingSuggestionModerations.delete(key);

            // Expire after 5 minutes
            if (pending.createdAt && Date.now() - Number(pending.createdAt) > 5 * 60_000) {
                try { return await interaction.reply({ content: 'انتهت صلاحية الطلب… جرّب مرة ثانية 3:', ephemeral: true }); } catch { return; }
            }

            const action = String(pending.action || '');
            const reason = String(interaction.fields.getTextInputValue('reason') || '').trim();

            // Use the message from the interaction directly instead of fetching by ID
            let msg = null;
            try {
                // Try to get the message from the channel where the button was clicked
                const channel = await interaction.guild.channels.fetch(String(pending.channelId || '')).catch(() => null);
                if (channel && channel.isTextBased()) {
                    msg = await channel.messages.fetch(String(pending.messageId || '')).catch(() => null);
                }
            } catch {
                msg = null;
            }
            
            // If still not found, try to get it from the original message reference
            if (!msg && interaction.message) {
                msg = interaction.message;
            }
            
            if (!msg) {
                try { return await interaction.reply({ content: 'الاقتراح مو موجود (يمكن انحذف) 3:', ephemeral: true }); } catch { return; }
            }

            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const currentEmbed = msg.embeds && msg.embeds[0] ? msg.embeds[0] : null;
            const embed = currentEmbed ? EmbedBuilder.from(currentEmbed) : new EmbedBuilder().setColor('#E7D3B0').setTitle('💡 اقتراح');

            const fields = Array.isArray(embed.data.fields) ? [...embed.data.fields] : [];
            const statusIdx = fields.findIndex((f) => f && f.name === 'الحالة');
            const reasonIdx = fields.findIndex((f) => f && f.name === 'السبب');
            const newStatus = action === 'approve' ? 'تمت الموافقة ✅' : 'تم الرفض ⛔';
            const newColor = action === 'approve' ? '#57F287' : '#ED4245';
            embed.setColor(newColor);

            if (statusIdx >= 0) fields[statusIdx] = { ...fields[statusIdx], value: newStatus };
            else fields.push({ name: 'الحالة', value: newStatus, inline: true });

            if (reason) {
                if (reasonIdx >= 0) fields[reasonIdx] = { ...fields[reasonIdx], value: reason.slice(0, 1024) };
                else fields.push({ name: 'السبب', value: reason.slice(0, 1024), inline: false });
            } else if (reasonIdx >= 0) {
                // keep existing reason if present
            }

            embed.setFields(fields);

            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('suggestions:approve:disabled').setLabel('موافقة').setStyle(ButtonStyle.Success).setDisabled(true),
                new ButtonBuilder().setCustomId('suggestions:reject:disabled').setLabel('رفض').setStyle(ButtonStyle.Danger).setDisabled(true)
            );
            const ownerRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('suggestions:edit:disabled').setLabel('تعديل').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('suggestions:delete:disabled').setLabel('حذف').setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            // Forward approved suggestions to configured channel
            if (action === 'approve') {
                try {
                    const cfg = getGuildConfig(interaction.guild.id);
                    const outId = cfg && typeof cfg.suggestionsApprovedChannelId === 'string' ? cfg.suggestionsApprovedChannelId : null;
                    if (outId) {
                        const outCh = await interaction.guild.channels.fetch(outId).catch(() => null);
                        if (outCh && outCh.isTextBased && outCh.isTextBased()) {
                            const jump = msg?.url ? `\n\n🔗 رابط الاقتراح: ${msg.url}` : '';
                            const forwarded = EmbedBuilder.from(embed).setFooter({ text: 'اقتراح تمت الموافقة عليه' });
                            const desc = (forwarded.data.description || '').slice(0, 3800);
                            forwarded.setDescription(`${desc}${jump}`.slice(0, 4096));
                            await outCh.send({ embeds: [forwarded] });
                        }
                    }
                } catch (err) {
                    console.error('suggestions:approve forward error:', err);
                }
            }

            try {
                const logEmbed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle(action === 'approve' ? '💡 اقتراح: تمت الموافقة' : '💡 اقتراح: تم الرفض')
                    .setDescription(
                        `${interaction.user} ${action === 'approve' ? 'وافق' : 'رفض'} اقتراحًا.` +
                        (reason ? `\n\nالسبب: ${reason.slice(0, 1000)}` : '') +
                        (msg?.url ? `\n\n🔗 ${msg.url}` : '')
                    )
                    .setTimestamp();
                await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
            } catch {
                // ignore
            }

            try {
                await msg.edit({ embeds: [embed], components: [adminRow, ownerRow] });
            } catch {
                // ignore
            }

            try {
                return await interaction.reply({ content: action === 'approve' ? '✅ تمت الموافقة.' : '✅ تم الرفض.', ephemeral: true });
            } catch {
                return;
            }
        }

        // === SHORTCUTS HANDLERS ===
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('shortcuts:')) {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
            
            if (!interaction.guild) {
                return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
            }
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server 3:', flags: MessageFlags.Ephemeral });
            }

            const action = interaction.customId.split(':')[1];
            const cfg = getGuildConfig(interaction.guild.id);
            const shortcuts = Array.isArray(cfg.shortcuts) ? cfg.shortcuts : [];

            // Add shortcut - show command select (dynamic: every loaded command)
            if (action === 'add') {
                return interaction.reply({ content: '**➕ إضافة اختصار جديد**\nاختر الأمر:', components: buildShortcutCommandRows(client, 0), flags: MessageFlags.Ephemeral });
            }

            // Shortcut picker pagination
            if (action === 'page') {
                const page = parseInt(interaction.customId.split(':')[2], 10) || 0;
                return interaction.update({ content: '**➕ إضافة اختصار جديد**\nاختر الأمر:', components: buildShortcutCommandRows(client, page) });
            }

            // Edit shortcut - show list
            if (action === 'edit') {
                if (shortcuts.length === 0) {
                    return interaction.reply({ content: 'لا توجد اختصارات للتعديل.', flags: MessageFlags.Ephemeral });
                }
                const options = shortcuts.slice(0, 25).map((s, i) => ({
                    label: s.trigger || `اختصار ${i + 1}`,
                    value: String(i),
                    description: `الأمر: ${s.command}`
                }));
                const select = new StringSelectMenuBuilder()
                    .setCustomId('shortcuts:editselect')
                    .setPlaceholder('اختر الاختصار للتعديل')
                    .addOptions(options);
                const row = new ActionRowBuilder().addComponents(select);
                return interaction.reply({ content: '**✏️ تعديل اختصار**', components: [row], flags: MessageFlags.Ephemeral });
            }

            // Remove shortcut - show list
            if (action === 'remove') {
                if (shortcuts.length === 0) {
                    return interaction.reply({ content: 'لا توجد اختصارات للحذف.', flags: MessageFlags.Ephemeral });
                }
                const options = shortcuts.slice(0, 25).map((s, i) => ({
                    label: s.trigger || `اختصار ${i + 1}`,
                    value: String(i),
                    description: `الأمر: ${s.command}`
                }));
                const select = new StringSelectMenuBuilder()
                    .setCustomId('shortcuts:removeselect')
                    .setPlaceholder('اختر الاختصار للحذف')
                    .addOptions(options);
                const row = new ActionRowBuilder().addComponents(select);
                return interaction.reply({ content: '**🗑️ حذف اختصار**', components: [row], flags: MessageFlags.Ephemeral });
            }

            // List shortcuts
            if (action === 'list') {
                if (shortcuts.length === 0) {
                    return interaction.reply({ content: 'لا توجد اختصارات حالياً.', flags: MessageFlags.Ephemeral });
                }
                const list = shortcuts.map((s, i) => `**${i + 1}.** \`${s.trigger}\` → \`${s.command}\``).join('\n');
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('📋 قائمة الاختصارات')
                    .setDescription(list.slice(0, 4000))
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }

            // Clear all shortcuts
            if (action === 'clear') {
                updateGuildConfig(interaction.guild.id, (c) => ({ ...c, shortcuts: [] }));
                return interaction.reply({ content: '✅ تم حذف جميع الاختصارات.', flags: MessageFlags.Ephemeral });
            }
        }

        // Shortcuts: Select command for new shortcut (paged: shortcuts:selectcmd:<page>)
        if (interaction.isStringSelectMenu() && typeof interaction.customId === 'string' && interaction.customId.startsWith('shortcuts:selectcmd')) {
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            const cmd = interaction.values[0];
            const modal = new ModalBuilder()
                .setCustomId(`shortcuts:addmodal:${cmd}`)
                .setTitle(`إنشاء اختصار: ${cmd}`)
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('trigger')
                            .setLabel('كلمة/إيموجي الاختصار')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('مثال: تايم أو ⏱️ أو !تايم')
                            .setRequired(true)
                            .setMaxLength(50)
                    )
                );
            return interaction.showModal(modal);
        }

        // Shortcuts: Add modal submit
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('shortcuts:addmodal:')) {
            const cmd = interaction.customId.split(':')[2];
            const trigger = normalizeShortcutTrigger(interaction.guild, interaction.fields.getTextInputValue('trigger'));
            
            if (!trigger) {
                return interaction.reply({ content: 'يجب إدخال كلمة الاختصار.', flags: MessageFlags.Ephemeral });
            }

            const cfg = getGuildConfig(interaction.guild.id);
            const existing = Array.isArray(cfg.shortcuts) ? cfg.shortcuts : [];
            if (existing.some((s) => normalizeShortcutTrigger(interaction.guild, s && s.trigger) === trigger)) {
                return interaction.reply({ content: 'هذا الاختصار موجود مسبقاً.', flags: MessageFlags.Ephemeral });
            }

            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                shortcuts: [...existing, { trigger, command: cmd }]
            }));

            return interaction.reply({ content: `✅ تم إضافة الاختصار: \`${trigger}\` → \`${cmd}\``, flags: MessageFlags.Ephemeral });
        }

        // Shortcuts: Edit select
        if (interaction.isStringSelectMenu() && interaction.customId === 'shortcuts:editselect') {
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            const idx = parseInt(interaction.values[0], 10);
            const cfg = getGuildConfig(interaction.guild.id);
            const shortcuts = Array.isArray(cfg.shortcuts) ? cfg.shortcuts : [];
            const s = shortcuts[idx];
            
            if (!s) {
                return interaction.reply({ content: 'الاختصار غير موجود.', flags: MessageFlags.Ephemeral });
            }

            const modal = new ModalBuilder()
                .setCustomId(`shortcuts:editmodal:${idx}`)
                .setTitle('تعديل الاختصار')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('trigger')
                            .setLabel('كلمة/إيموجي الاختصار')
                            .setStyle(TextInputStyle.Short)
                            .setValue(s.trigger || '')
                            .setRequired(true)
                            .setMaxLength(50)
                    )
                );
            return interaction.showModal(modal);
        }

        // Shortcuts: Edit modal submit
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('shortcuts:editmodal:')) {
            const idx = parseInt(interaction.customId.split(':')[2], 10);
            const newTrigger = normalizeShortcutTrigger(interaction.guild, interaction.fields.getTextInputValue('trigger'));
            
            const cfg = getGuildConfig(interaction.guild.id);
            const shortcuts = Array.isArray(cfg.shortcuts) ? cfg.shortcuts : [];
            
            if (!shortcuts[idx]) {
                return interaction.reply({ content: 'الاختصار غير موجود.', flags: MessageFlags.Ephemeral });
            }

            shortcuts[idx] = { ...shortcuts[idx], trigger: newTrigger };
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, shortcuts }));

            return interaction.reply({ content: `✅ تم تعديل الاختصار: \`${newTrigger}\``, flags: MessageFlags.Ephemeral });
        }

        // Shortcuts: Remove select
        if (interaction.isStringSelectMenu() && interaction.customId === 'shortcuts:removeselect') {
            const idx = parseInt(interaction.values[0], 10);
            const cfg = getGuildConfig(interaction.guild.id);
            const shortcuts = Array.isArray(cfg.shortcuts) ? cfg.shortcuts : [];
            const removed = shortcuts[idx];
            
            if (!removed) {
                return interaction.reply({ content: 'الاختصار غير موجود.', flags: MessageFlags.Ephemeral });
            }

            shortcuts.splice(idx, 1);
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, shortcuts }));

            return interaction.reply({ content: `✅ تم حذف الاختصار: \`${removed.trigger}\``, flags: MessageFlags.Ephemeral });
        }

        // verify: handler
        // Backup import/export buttons (self-contained handler exported by commands/backup.js)
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('backup:')) {
            const backupCmd = client.commands.get('backup');
            if (backupCmd && typeof backupCmd.handleBackupButton === 'function') {
                return await backupCmd.handleBackupButton({ client, interaction });
            }
            return;
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('verify:')) {
            const parts = interaction.customId.split(':');
            const guildId = parts[1] ? String(parts[1]) : '';

            // The verify button can arrive in DMs (sent there when no channel was
            // available) — resolve the guild from the customId instead of assuming
            // interaction.guild exists.
            const verifyGuild = interaction.guild
                || (guildId ? client.guilds.cache.get(guildId) : null)
                || null;
            if (!verifyGuild) {
                try {
                    return interaction.reply({ content: 'Invalid verification context.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }
            if (guildId && String(verifyGuild.id) !== guildId) {
                try {
                    return interaction.reply({ content: 'Invalid verification context.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const cfg = getGuildConfig(verifyGuild.id);
            const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : null;
            if (!ar || ar.verifyEnabled !== true) {
                try {
                    return interaction.reply({ content: 'Verification is disabled.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const until = Math.max(0, Math.floor(Number(ar.lockdownUntil) || 0));
            if (!until || Date.now() >= until) {
                try {
                    return interaction.reply({ content: 'Lockdown is not active right now.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }
            const roleId = ar && ar.verifyRoleId ? String(ar.verifyRoleId) : '';
            if (!roleId) {
                try {
                    return interaction.reply({ content: 'Verification role is not configured.', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            try {
                const member = interaction.guild
                    ? interaction.member
                    : await verifyGuild.members.fetch(interaction.user.id).catch(() => null);
                if (member && member.roles && member.roles.remove) {
                    await member.roles.remove(roleId, 'Verified by button');
                }
            } catch {
                try {
                    return interaction.reply({ content: 'I could not update your roles. (Missing permissions / role hierarchy)', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            try {
                if (interaction.deferred || interaction.replied) {
                    return interaction.followUp({ content: '✅ Verified. You can chat now. :3', flags: MessageFlags.Ephemeral });
                }
                return interaction.reply({ content: '✅ Verified. You can chat now. :3', flags: MessageFlags.Ephemeral });
            } catch {
                return;
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('help:')) {
            const helpCmd = client.commands.get('help');
            if (helpCmd && typeof helpCmd.handleHelpButton === 'function') {
                return helpCmd.handleHelpButton(interaction, client.commands);
            }
            try {
                return interaction.reply({ content: 'آسف، نظام المساعدة غير جاهز 3:', ephemeral: true });
            } catch {
                return;
            }
        }

        if (interaction.isStringSelectMenu() && typeof interaction.customId === 'string' && interaction.customId.startsWith('helpSelect:')) {
            const helpCmd = client.commands.get('help');
            if (helpCmd && typeof helpCmd.handleHelpSelect === 'function') {
                return helpCmd.handleHelpSelect(interaction, client.commands);
            }
            try {
                return interaction.reply({ content: 'آسف، نظام المساعدة غير جاهز 3:', ephemeral: true });
            } catch {
                return;
            }
        }

        if (interaction.isStringSelectMenu() && typeof interaction.customId === 'string' && interaction.customId.startsWith('mechanicsSelect:')) {
            const mechCmd = client.commands.get('mechanics');
            if (mechCmd && typeof mechCmd.handleMechanicsSelect === 'function') {
                return mechCmd.handleMechanicsSelect(interaction);
            }
            try {
                return interaction.reply({ content: 'آسف، نظام الشرح غير جاهز 3:', ephemeral: true });
            } catch {
                return;
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('mechanics:')) {
            const mechCmd = client.commands.get('mechanics');
            if (mechCmd && typeof mechCmd.handleMechanicsButton === 'function') {
                return mechCmd.handleMechanicsButton(interaction);
            }
            try {
                return interaction.reply({ content: 'آسف، نظام الشرح غير جاهز 3:', ephemeral: true });
            } catch {
                return;
            }
        }

        // Online music: switching to the tray player is a separate action from
        // entering a link. The link input lives inside the tray itself.
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musiconline:')) {
            if (!interaction.guild) return;
            try { client.music.__getSession(interaction.guild.id).viewMode = 'tray'; } catch { /* ignore */ }
            await deferUpdateSafe(interaction);
            await refreshMusicPanelMessage(interaction.guild.id).catch(() => null);
            try {
                await interaction.followUp({ content: '🎵 صار هذا مشغّل الموسيقى — اضغط **🔗 رابط / اسم أغنية** عشان تشغّل شي.', flags: MessageFlags.Ephemeral });
            } catch { /* ignore */ }
            return;
        }

        // The link/name input inside the tray player.
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musiconput:')) {
            if (!interaction.guild) return;
            try {
                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
                const modal = new ModalBuilder()
                    .setCustomId('musicModal:online')
                    .setTitle('تشغيل أغنية من YouTube');
                const query = new TextInputBuilder()
                    .setCustomId('query')
                    .setLabel('اسم الأغنية أو رابط YouTube')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('مثلاً: أغنية عربية أو https://youtube.com/watch?v=...');
                modal.addComponents(new ActionRowBuilder().addComponents(query));
                await interaction.showModal(modal);
            } catch {
                // panel expired — ignore
            }
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'musicModal:online') {
            if (!interaction.guild) return;
            const text = String(interaction.fields.getTextInputValue('query') || '').trim();
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const result = await interaction.client.music.playOnline(interaction, text);
                await interaction.editReply({
                    content: result && result.queued
                        ? `✅ تمت الإضافة للقائمة: **${result.title}**`
                        : `✅ جاري التشغيل: **${result.title}**`
                });
                await interaction.client.music.refreshPanel(interaction.guild.id).catch(() => null);
            } catch (err) {
                try {
                    await interaction.editReply({ content: `❌ ${String(err && err.message ? err.message : err).slice(0, 500)}` });
                } catch { /* ignore */ }
            }
            return;
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musicctl:')) {
            if (!interaction.guild) return;
            await deferUpdateSafe(interaction);

            const action = String(interaction.customId.split(':')[1] || '').trim();
            if (!action) return;

            if (action === 'panel') {
                try { client.music.__getSession(interaction.guild.id).viewMode = 'panel'; } catch { /* ignore */ }
                await refreshMusicPanelMessage(interaction.guild.id).catch(() => null);
                return replyEphemeral(interaction, { content: 'رجعنا للوحة الموسيقى الكاملة 3:' });
            }

            if (action === 'skip') {
                const res = await client.music.skip(interaction.guild.id);
                if (!res.ok) {
                    return replyEphemeral(interaction, { content: `اسفة بس ${res.error || 'ما قدرت أتخطى'} 3:` });
                }
                const { embed, components } = client.music.buildNowPlayingEmbed(interaction.guild.id);
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({ content: 'تم التخطي 3=', embeds: [embed], components, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'stop') {
                const res = await client.music.stop(interaction.guild.id);
                if (!res.ok) {
                    return replyEphemeral(interaction, { content: `اسفة بس ${res.error || 'ما قدرت أوقف'} 3:` });
                }
                const { embed, components } = client.music.buildNowPlayingEmbed(interaction.guild.id);
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({ content: 'تم إيقاف التشغيل 3:', embeds: [embed], components, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'pause') {
                const res = await pauseGuildPlayback(interaction.guild.id);
                if (!res.ok) {
                    return replyEphemeral(interaction, { content: `اسفة بس ${res.error || 'ما قدرت أوقف مؤقت'} 3:` });
                }
                const { embed, components } = client.music.buildNowPlayingEmbed(interaction.guild.id);
                try {
                    return interaction.followUp({ content: 'تم الإيقاف المؤقت 3:', embeds: [embed], components, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'play') {
                const res = await resumeGuildPlayback(interaction);
                if (!res.ok) {
                    return replyEphemeral(interaction, { content: `اسفة بس ${res.error || 'ما قدرت أكمل التشغيل'} 3:` });
                }
                const { embed, components } = client.music.buildNowPlayingEmbed(interaction.guild.id);
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({ content: 'تم التشغيل 3:', embeds: [embed], components, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'queue') {
                const state = client.music.getState(interaction.guild.id);
                const session = client.music.__getSession(interaction.guild.id);
                const cur = state.current;
                const fields = [];
                if (cur) {
                    const title = cur.info && cur.info.title ? cur.info.title : 'Track';
                    const by = session.currentTrack && session.currentTrack.requestedBy && String(session.currentTrack.requestedBy) !== '0'
                        ? ` — <@${session.currentTrack.requestedBy}>` : '';
                    fields.push({ name: '🎵 يشتغل الآن', value: `${title}${by}` });
                } else {
                    fields.push({ name: '🎵 يشتغل الآن', value: 'لا يوجد شيء قيد التشغيل 3:' });
                }
                const total = Array.isArray(session.queue) ? session.queue.length : 0;
                const lines = client.music.getQueueLines(interaction.guild.id, 15);
                const more = total > 15 ? `\n… و **${total - 15}** بعد` : '';
                fields.push({ name: `⏭️ التالي (${total})`, value: (lines.length ? lines.join('\n') + more : '—').slice(0, 1024) });

                const embed = UI.embed({ title: '📥 قائمة الانتظار', color: UI.COLORS.music, fields });
                const qRow = UI.row(
                    UI.btn('musicctl:shuffle', 'خلط القائمة', { disabled: total < 2 }),
                    UI.btn('musicctl:clearq', 'مسح القائمة', { style: ButtonStyle.Danger, disabled: total < 1 }),
                    UI.btn('musicctl:leave', 'خروج من الفويس', { style: ButtonStyle.Danger })
                );

                try {
                    return interaction.followUp({ embeds: [embed], components: [qRow], flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'seekback' || action === 'seekfwd') {
                const deltaMs = action === 'seekfwd' ? 15000 : -15000;
                const res = await client.music.seek(interaction.guild.id, deltaMs);
                if (!res.ok) {
                    return replyEphemeral(interaction, { content: `اسفة بس ${res.error || 'ما قدرت أنتقل'} 3:` });
                }
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({
                        content: `${action === 'seekfwd' ? '⏩' : '⏪'} صار عند **${fmtMmSsLocal(res.positionMs)}**${res.durationMs ? ` / ${fmtMmSsLocal(res.durationMs)}` : ''}`,
                        flags: MessageFlags.Ephemeral
                    });
                } catch {
                    return;
                }
            }

            if (action === 'repeat') {
                const mode = client.music.cycleRepeatMode(interaction.guild.id);
                const label = mode === 'one' ? '🔁 مقطع واحد' : mode === 'all' ? '🔂 كل القائمة' : 'مطفى';
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({ content: `التكرار صار: **${label}**`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'volup' || action === 'voldown') {
                const session = client.music.__getSession(interaction.guild.id);
                const nextVol = Math.max(0, Math.min(2, (Number(session.volume) || 1) + (action === 'volup' ? 0.1 : -0.1)));
                client.music.setVolume(interaction.guild.id, nextVol);
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({ content: `🔊 الصوت صار: **${Math.round(nextVol * 100)}%**`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'shuffle') {
                const count = client.music.shuffleQueue(interaction.guild.id);
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({ content: `🔀 انخلطت القائمة (**${count}** مقطع)`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'clearq') {
                const count = client.music.clearQueue(interaction.guild.id);
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.followUp({ content: `🗑️ انمسحت القائمة (**${count}** مقطع)`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'leave') {
                await client.music.stop(interaction.guild.id);
                const session = client.music.__getSession(interaction.guild.id);
                try {
                    if (session.connection) session.connection.destroy();
                } catch { /* ignore */ }
                session.connection = null;
                client.music.clearMusicPanel(interaction.guild.id);
                try {
                    return interaction.followUp({ content: '👋 طلعت من الفويس', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            return;
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('aipanel:')) {
            if (!interaction.guild) return;

            const parts = interaction.customId.split(':');
            const action = parts[1] || '';
            const ownerId = parts[2] || '';
            if (ownerId && String(interaction.user.id) !== String(ownerId)) {
                return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true });
            }

            if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'آسف بس هذا الخيار للإدمن فقط 3:', ephemeral: true });
            }

            const aiCmd = client.commands.get('ai');
            const buildEmbed = aiCmd && typeof aiCmd.buildAiPanelEmbed === 'function' ? aiCmd.buildAiPanelEmbed : null;
            const buildRows = aiCmd && typeof aiCmd.buildAiPanelRows === 'function' ? aiCmd.buildAiPanelRows : null;

            const refreshPanel = async () => {
                if (!buildEmbed || !buildRows) return;
                const embed = buildEmbed(interaction.guild.id);
                const components = buildRows(ownerId || interaction.user.id);
                try {
                    if (interaction.deferred || interaction.replied) {
                        return await interaction.editReply({ embeds: [embed], components });
                    }
                } catch {
                    // ignore
                }
                try {
                    return await interaction.update({ embeds: [embed], components });
                } catch {
                    try {
                        return await interaction.reply({ embeds: [embed], components, ephemeral: true });
                    } catch {
                        return;
                    }
                }
            };

            const openModal = async (customId, title, fields) => {
                const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
                for (const f of fields) {
                    const input = new TextInputBuilder()
                        .setCustomId(f.id)
                        .setLabel(f.label)
                        .setStyle(f.style || TextInputStyle.Short)
                        .setRequired(Boolean(f.required));
                    if (typeof f.placeholder === 'string') input.setPlaceholder(f.placeholder);
                    if (typeof f.value === 'string') input.setValue(f.value);
                    if (typeof f.maxLength === 'number') input.setMaxLength(f.maxLength);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                }
                return interaction.showModal(modal);
            };

            if (action === 'toggle') {
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    ai: {
                        ...(c.ai && typeof c.ai === 'object' ? c.ai : {}),
                        enabled: !(c.ai && typeof c.ai === 'object' && c.ai.enabled)
                    }
                }));
                try {
                    await interaction.deferUpdate();
                } catch {
                    // ignore
                }
                return refreshPanel();
            }

            if (action === 'memorytoggle') {
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    ai: {
                        ...(c.ai && typeof c.ai === 'object' ? c.ai : {}),
                        memoryEnabled: !(c.ai && typeof c.ai === 'object' && c.ai.memoryEnabled)
                    }
                }));
                try {
                    await interaction.deferUpdate();
                } catch {
                    // ignore
                }
                return refreshPanel();
            }

            if (action === 'memoryclear') {
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    ai: {
                        ...(c.ai && typeof c.ai === 'object' ? c.ai : {}),
                        memoryResetAt: Date.now()
                    }
                }));
                try {
                    await interaction.deferUpdate();
                } catch {
                    // ignore
                }
                return refreshPanel();
            }

            if (action === 'refresh') {
                try {
                    await interaction.deferUpdate();
                } catch {
                    // ignore
                }
                return refreshPanel();
            }

            if (action === 'url') {
                const cfg = getGuildConfig(interaction.guild.id);
                const ai = cfg.ai && typeof cfg.ai === 'object' ? cfg.ai : {};
                const current = typeof ai.baseUrl === 'string' ? ai.baseUrl : '';
                try {
                    return await openModal(
                        `aipanelModal:url:${ownerId}`,
                        'تغيير رابط Ollama',
                        [{
                            id: 'url',
                            label: 'الرابط (مثال: http://192.168.1.50:11434)',
                            required: true,
                            value: String(current || '').slice(0, 400),
                            maxLength: 400
                        }]
                    );
                } catch {
                    return interaction.reply({ content: 'آسف بس ما قدرت أفتح نافذة تغيير الرابط 3:', ephemeral: true });
                }
            }

            if (action === 'model') {
                const cfg = getGuildConfig(interaction.guild.id);
                const ai = cfg.ai && typeof cfg.ai === 'object' ? cfg.ai : {};
                const current = typeof ai.model === 'string' ? ai.model : '';
                try {
                    return await openModal(
                        `aipanelModal:model:${ownerId}`,
                        'تغيير موديل Ollama',
                        [{
                            id: 'model',
                            label: 'اسم الموديل (مثل: luna)',
                            required: true,
                            value: String(current || '').slice(0, 80),
                            maxLength: 80
                        }]
                    );
                } catch {
                    return interaction.reply({ content: 'آسف بس ما قدرت أفتح نافذة تغيير الموديل 3:', ephemeral: true });
                }
            }

            if (action === 'tuning') {
                const cfg = getGuildConfig(interaction.guild.id);
                const ai = cfg.ai && typeof cfg.ai === 'object' ? cfg.ai : {};
                const cooldown = typeof ai.cooldownMs === 'number' ? Math.round(ai.cooldownMs / 1000) : 15;
                const ttlMin = typeof ai.memoryTtlMs === 'number' ? Math.round(ai.memoryTtlMs / 60000) : 120;
                try {
                    return await openModal(
                        `aipanelModal:tuning:${ownerId}`,
                        'إعدادات AI المتقدمة',
                        [
                            {
                                id: 'cooldownSec',
                                label: 'Cooldown بالثواني (3 - 120)',
                                required: true,
                                value: String(cooldown),
                                maxLength: 6
                            },
                            {
                                id: 'ttlMin',
                                label: 'TTL بالدقائق (0 = بدون انتهاء)',
                                required: true,
                                value: String(ttlMin),
                                maxLength: 6
                            }
                        ]
                    );
                } catch {
                    return interaction.reply({ content: 'آسف بس ما قدرت أفتح نافذة الإعدادات 3:', ephemeral: true });
                }
            }

            if (action === 'channel') {
                const cfg = getGuildConfig(interaction.guild.id);
                const ai = cfg.ai && typeof cfg.ai === 'object' ? cfg.ai : {};
                const current = typeof ai.allowedChannelId === 'string' ? ai.allowedChannelId : '';
                try {
                    return await openModal(
                        `aipanelModal:channel:${ownerId}`,
                        'تحديد روم الذكاء الصناعي',
                        [{
                            id: 'channelId',
                            label: 'ايدي الروم (مثال: 123456789012345678)',
                            required: true,
                            value: current,
                            placeholder: 'حط ايدي الروم هنا',
                            maxLength: 30
                        }]
                    );
                } catch {
                    return interaction.reply({ content: 'آسف بس ما قدرت أفتح نافذة تحديد الروم 3:', ephemeral: true });
                }
            }

            return interaction.reply({ content: 'آسف بس ما فهمت الخيار 3:', ephemeral: true });
        }

        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('dailycfgModal:')) {
            const cfgCmd = client.commands.get('dailyconfig');
            if (cfgCmd && typeof cfgCmd.handleModal === 'function') {
                return cfgCmd.handleModal(interaction);
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('daily:claim:')) {
            const dailyCmd = client.commands.get('daily');
            if (dailyCmd && typeof dailyCmd.handleClaim === 'function') {
                return dailyCmd.handleClaim(interaction);
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('dailycfg:')) {
            const cfgCmd = client.commands.get('dailyconfig');
            if (cfgCmd && typeof cfgCmd.handleButton === 'function') {
                return cfgCmd.handleButton(interaction);
            }
        }


        // Admin Report handlers
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('adminreport:')) {
            if (!interaction.guild) return;
            const parts = interaction.customId.split(':');
            const action = parts[1] || '';
            const ownerId = parts[2] || '';

            const arCmd = client.commands.get('adminreport');
            if (!arCmd) return interaction.reply({ content: 'نظام التقارير مو محمل 3:', ephemeral: true });

            const hasModerationPerm = !!interaction.memberPermissions && (
                interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers) ||
                interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)
            );
            const hasAdminPerm = !!interaction.memberPermissions && interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator);

            const configActions = ['toggle', 'settings', 'roles', 'postform', 'export'];
            const staffActions = ['today', 'leaderboard', 'missing', 'admins', 'refresh'];

            if (configActions.includes(action)) {
                if (ownerId && String(interaction.user.id) !== String(ownerId)) {
                    return interaction.reply({ content: 'اسفة بس هاللوحة لصاحبها بس 3:', ephemeral: true });
                }
            }
            if (configActions.includes(action) && !hasAdminPerm) {
                return interaction.reply({ content: 'اسفة بس هذا الخيار للإدمن فقط 3:', ephemeral: true });
            }
            if (staffActions.includes(action) && !hasModerationPerm) {
                return interaction.reply({ content: 'هذا الخيار للمشرفين فقط 3:', ephemeral: true });
            }

            if (action === 'toggle') {
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    adminReport: {
                        ...(c.adminReport && typeof c.adminReport === 'object' ? c.adminReport : {}),
                        enabled: !(c.adminReport && typeof c.adminReport === 'object' && c.adminReport.enabled === true)
                    }
                }));
                const embed = arCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = arCmd.buildConfigRows(ownerId || interaction.user.id, interaction.guild.id);
                return interaction.update({ embeds: [embed], components });
            }

            if (action === 'settings') {
                const modal = arCmd.buildSettingsModal(ownerId || interaction.user.id, interaction.guild.id);
                return interaction.showModal(modal);
            }

            if (action === 'postform') {
                const cfg = getGuildConfig(interaction.guild.id);
                const arCfg = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
                if (!arCfg.formChannelId) {
                    return interaction.reply({ content: 'حدد روم الفورم من الإعدادات أول 3:', ephemeral: true });
                }
                const channel = interaction.guild.channels.cache.get(arCfg.formChannelId);
                if (!channel || !channel.isTextBased()) {
                    return interaction.reply({ content: 'روم الفورم مو موجود أو غير مناسب 3:', ephemeral: true });
                }
                const embed = arCmd.buildFormEmbed();
                const row = arCmd.buildFormButton();
                await channel.send({ embeds: [embed], components: [row] });
                return interaction.reply({ content: `✅ تم نشر الفورم بـ <#${arCfg.formChannelId}>`, ephemeral: true });
            }

            if (action === 'submit') {
                const cfg = getGuildConfig(interaction.guild.id);
                const arCfg = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
                if (!arCfg.enabled) {
                    return interaction.reply({ content: 'نظام التقارير معطل 3:', ephemeral: true });
                }
                const isStaff = interaction.member && interaction.member.permissions && (
                    interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                    interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
                    interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
                );
                if (!isStaff) {
                    return interaction.reply({ content: 'هذا الفورم للأدمن والمود فقط 3:', ephemeral: true });
                }
                if (arCmd.hasSubmittedToday(interaction.guild.id, interaction.user.id)) {
                    return interaction.reply({ content: 'قدمت تقريرك لليوم بالفعل! تعال بكرة 3:', ephemeral: true });
                }
                
                const sinceTs = Date.now() - 24 * 60 * 60 * 1000;
                const stats = await arCmd.fetchAuditLogStats(interaction.guild, interaction.user.id, sinceTs).catch(() => ({ timeouts: 0, bans: 0 }));
                const modal = arCmd.buildFormModal(interaction.user.id, { tickets: 0, timeouts: stats.timeouts, bans: stats.bans });
                return interaction.showModal(modal);
            }

            if (action === 'today') {
                const reports = arCmd.getTodayReports(interaction.guild.id);
                if (reports.length === 0) {
                    return interaction.reply({ content: 'ما في تقارير لليوم بعد 3:', ephemeral: true });
                }
                let desc = reports.slice(0, 10).map((r, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                    return `${medal} <@${r.user_id}>: **${r.total_points}** نقطة\n   تكتات: ${r.tickets} | تايمات: ${r.timeouts} | باندات: ${r.bans}`;
                }).join('\n\n');
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle(`📊 تقارير اليوم - ${arCmd.dayKey()}`)
                    .setDescription(desc)
                    .setFooter({ text: `إجمالي ${reports.length} تقرير` })
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (action === 'leaderboard') {
                const lb = arCmd.getLeaderboard(interaction.guild.id, 7);
                if (lb.length === 0) {
                    return interaction.reply({ content: 'ما في تقارير بعد 3:', ephemeral: true });
                }
                let desc = lb.slice(0, 10).map((r, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                    return `${medal} <@${r.user_id}>: **${r.total_points}** نقطة (${r.reports} تقارير)`;
                }).join('\n');
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🏆 متصدرين الأسبوع')
                    .setDescription(desc)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (action === 'missing') {
                const missing = arCmd.getMissingAdmins(interaction.guild);
                if (missing.length === 0) {
                    return interaction.reply({ content: '✅ كل الأدمن قدموا تقاريرهم اليوم!', ephemeral: true });
                }
                const list = missing.slice(0, 20).map(m => `<@${m.id}>`).join('\n');
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle(`⚠️ أدمن ما قدموا تقريرهم (${missing.length})`)
                    .setDescription(list)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (action === 'export') {
                const result = arCmd.exportReports(interaction.guild.id, 'csv', 30);
                if (!result) {
                    return interaction.reply({ content: 'ما في تقارير للتصدير 3:', ephemeral: true });
                }
                const { AttachmentBuilder } = require('discord.js');
                const attachment = new AttachmentBuilder(result.filepath, { name: result.filename });
                return interaction.reply({ content: `✅ تم تصدير ${result.count} تقرير`, files: [attachment], ephemeral: true });
            }

            if (action === 'refresh') {
                const embed = arCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = arCmd.buildConfigRows(ownerId || interaction.user.id, interaction.guild.id);
                return interaction.update({ embeds: [embed], components });
            }

            if (action === 'roles') {
                const modal = arCmd.buildAdminRolesModal(ownerId || interaction.user.id, interaction.guild.id);
                return interaction.showModal(modal);
            }

            if (action === 'admins') {
                const embed = arCmd.buildAdminsListEmbed(interaction.guild);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            return interaction.reply({ content: 'اسفة بس ما فهمت 3:', ephemeral: true });
        }

        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('adminreportModal:')) {
            if (!interaction.guild) return;
            const parts = interaction.customId.split(':');
            const kind = parts[1] || '';
            const userId = parts[2] || '';

            const arCmd = client.commands.get('adminreport');
            if (!arCmd) return interaction.reply({ content: 'نظام التقارير مو محمل 3:', ephemeral: true });

            if (kind === 'settings') {
                if (userId && String(interaction.user.id) !== String(userId)) {
                    return interaction.reply({ content: 'اسفة بس هاللوحة لصاحبها بس 3:', ephemeral: true });
                }
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: 'اسفة بس هذا الخيار للإدمن فقط 3:', ephemeral: true });
                }
                const formChannelId = String(interaction.fields.getTextInputValue('formChannelId') || '').trim();
                const reportChannelId = String(interaction.fields.getTextInputValue('reportChannelId') || '').trim();
                const reminderHourRaw = String(interaction.fields.getTextInputValue('reminderHour') || '').trim();
                const reminderHourParsed = Number(reminderHourRaw);
                const reminderHour = reminderHourRaw === '' || !Number.isFinite(reminderHourParsed)
                    ? -1
                    : Math.max(-1, Math.min(23, Math.floor(reminderHourParsed)));
                
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    adminReport: {
                        ...(c.adminReport && typeof c.adminReport === 'object' ? c.adminReport : {}),
                        formChannelId: /^\d+$/.test(formChannelId) ? formChannelId : null,
                        reportChannelId: /^\d+$/.test(reportChannelId) ? reportChannelId : null,
                        reminderHour
                    }
                }));
                
                const embed = arCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = arCmd.buildConfigRows(userId || interaction.user.id, interaction.guild.id);
                await interaction.deferReply({ ephemeral: true }).catch(() => null);
                return interaction.editReply({ embeds: [embed], components });
            }

            if (kind === 'roles') {
                if (userId && String(interaction.user.id) !== String(userId)) {
                    return interaction.reply({ content: 'اسفة بس هاللوحة لصاحبها بس 3:', ephemeral: true });
                }
                if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: 'اسفة بس هذا الخيار للإدمن فقط 3:', ephemeral: true });
                }
                const rolesInput = String(interaction.fields.getTextInputValue('adminRoleIds') || '');
                const adminRoleIds = rolesInput.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s)).slice(0, 20);
                
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    adminReport: {
                        ...(c.adminReport && typeof c.adminReport === 'object' ? c.adminReport : {}),
                        adminRoleIds
                    }
                }));
                
                const embed = arCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = arCmd.buildConfigRows(userId || interaction.user.id, interaction.guild.id);
                await interaction.deferReply({ ephemeral: true }).catch(() => null);
                return interaction.editReply({ embeds: [embed], components });
            }

            if (kind === 'submit') {
                const cfg = getGuildConfig(interaction.guild.id);
                const arCfg = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
                console.log('Admin report submit - arCfg:', JSON.stringify(arCfg));
                if (!arCfg.enabled) {
                    return interaction.reply({ content: 'نظام التقارير معطل 3:', ephemeral: true });
                }
                if (arCmd.hasSubmittedToday(interaction.guild.id, interaction.user.id)) {
                    return interaction.reply({ content: 'قدمت تقريرك لليوم بالفعل! 3:', ephemeral: true });
                }

                const tickets = Math.max(0, Math.floor(Number(interaction.fields.getTextInputValue('tickets')) || 0));
                const timeouts = Math.max(0, Math.floor(Number(interaction.fields.getTextInputValue('timeouts')) || 0));
                const bans = Math.max(0, Math.floor(Number(interaction.fields.getTextInputValue('bans')) || 0));
                const improvements = String(interaction.fields.getTextInputValue('improvements') || '').trim();

                const points = arCmd.saveReport(interaction.guild.id, interaction.user.id, { tickets, timeouts, bans, improvements });

                // Send to report forum channel (create individual thread for each admin)
                if (arCfg.reportChannelId) {
                    try {
                        const reportChannel =
                            interaction.guild.channels.cache.get(String(arCfg.reportChannelId)) ||
                            (await interaction.guild.channels.fetch(String(arCfg.reportChannelId)).catch(() => null));

                        if (!reportChannel) {
                            console.error(`Admin report: report channel ${arCfg.reportChannelId} not found`);
                        } else if (reportChannel.type !== 15) { // 15 is ChannelType.GuildForum
                            console.error(`Admin report: report channel ${arCfg.reportChannelId} is not a forum channel`);
                        } else {
                            const pointsBreakdown = [
                                `التكتات: ${tickets} × 2 = ${tickets * 2}`,
                                `التايمات: ${timeouts} × 1 = ${timeouts}`,
                                `الباندات: ${bans} × 3 = ${bans * 3}`
                            ];
                            if (improvements.length > 10) pointsBreakdown.push(`تحسينات: +${Math.min(5, Math.floor(improvements.length / 100) + 1)}`);

                            const reportEmbed = new EmbedBuilder()
                                .setColor('#E7D3B0')
                                .setAuthor({
                                    name: `${interaction.user.username} (${interaction.user.id})`,
                                    iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 64 })
                                })
                                .setTitle('📋 تقرير إداري يومي')
                                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 128 }))
                                .addFields(
                                    { name: '👤 الإداري', value: `<@${interaction.user.id}>`, inline: true },
                                    { name: '📊 النقاط الإجمالية', value: `**${points}** نقطة`, inline: true },
                                    { name: '📅 التاريخ', value: arCmd.dayKey(), inline: true },
                                    { name: '📝 تفاصيل النقاط', value: pointsBreakdown.join('\n'), inline: false },
                                    { name: '🎫 التكتات', value: String(tickets), inline: true },
                                    { name: '⏱️ التايمات', value: String(timeouts), inline: true },
                                    { name: '🔨 الباندات', value: String(bans), inline: true },
                                    { name: '💡 التحسينات', value: improvements || 'لا يوجد', inline: false }
                                )
                                .setTimestamp();

                            // Check if thread already exists for this admin
                            const threadName = `تقارير ${interaction.user.username} (${interaction.user.id})`;
                            const existingThreads = await reportChannel.threads.fetch().catch(() => null);
                            let targetThread = null;

                            if (existingThreads) {
                                targetThread = existingThreads.threads.find(t =>
                                    t.name === threadName
                                );
                            }

                            if (targetThread) {
                                // Add report as reply to existing thread
                                await targetThread.send({ embeds: [reportEmbed] });
                                console.log(`Admin report: sent to existing thread ${targetThread.name}`);
                            } else {
                                // Create new forum post for this admin
                                const post = await reportChannel.threads.create({
                                    name: threadName,
                                    autoArchiveDuration: 1440,
                                    message: {
                                        content: `📋 **سجل تقارير الإداري**\nالإداري: <@${interaction.user.id}>\nالاسم: ${interaction.user.username}\nالـ ID: ${interaction.user.id}`,
                                        embeds: [reportEmbed]
                                    }
                                });
                                console.log(`Admin report: created new forum post ${post.name}`);
                            }
                        }
                    } catch (err) {
                        console.error('Admin report: failed to send to report channel:', err);
                    }
                } else {
                    console.log('Admin report: no reportChannelId configured');
                }

                return interaction.reply({ content: `✅ تم استلام تقريرك! حصلت على **${points}** نقطة.`, ephemeral: true });
            }
        }

        // PunishLog button handlers
        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('punishlog:')) {
            if (!interaction.guild) return;
            const parts = interaction.customId.split(':');
            const action = parts[1] || '';
            const ownerId = parts[2] || '';
            
            if (ownerId && String(interaction.user.id) !== String(ownerId)) {
                return interaction.reply({ content: 'هذه اللوحة لصاحبها فقط', ephemeral: true });
            }
            if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'هذا الخيار للإدمن فقط', ephemeral: true });
            }

            const plCmd = client.commands.get('punishlog');
            if (!plCmd) return interaction.reply({ content: 'نظام سجل العقوبات غير محمل', ephemeral: true });

            if (action === 'toggle') {
                const { updateGuildConfig } = require('./guildConfig');
                const cfg = getGuildConfig(interaction.guild.id);
                const current = cfg.punishLog && typeof cfg.punishLog === 'object' ? cfg.punishLog : {};
                updateGuildConfig(interaction.guild.id, c => ({
                    ...c,
                    punishLog: { ...current, enabled: !current.enabled }
                }));
                const embed = plCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = plCmd.buildConfigRows(interaction.user.id, interaction.guild.id);
                return interaction.update({ embeds: [embed], components });
            }

            if (action === 'autoban') {
                const { updateGuildConfig } = require('./guildConfig');
                const cfg = getGuildConfig(interaction.guild.id);
                const current = cfg.punishLog && typeof cfg.punishLog === 'object' ? cfg.punishLog : {};
                updateGuildConfig(interaction.guild.id, c => ({
                    ...c,
                    punishLog: { ...current, autoBanEnabled: !current.autoBanEnabled }
                }));
                const embed = plCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = plCmd.buildConfigRows(interaction.user.id, interaction.guild.id);
                return interaction.update({ embeds: [embed], components });
            }

            if (action === 'settings') {
                const modal = plCmd.buildSettingsModal(interaction.user.id, interaction.guild.id);
                return interaction.showModal(modal);
            }

            if (action === 'roles') {
                const modal = plCmd.buildRolesModal(interaction.user.id, interaction.guild.id);
                return interaction.showModal(modal);
            }
        }

        // PunishLog modal handlers
        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('punishlogModal:')) {
            if (!interaction.guild) return;
            const parts = interaction.customId.split(':');
            const kind = parts[1] || '';
            const userId = parts[2] || '';

            if (userId && String(interaction.user.id) !== String(userId)) {
                return interaction.reply({ content: 'هذه اللوحة لصاحبها فقط', ephemeral: true });
            }
            if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'هذا الخيار للإدمن فقط', ephemeral: true });
            }

            const plCmd = client.commands.get('punishlog');
            if (!plCmd) return interaction.reply({ content: 'نظام سجل العقوبات غير محمل', ephemeral: true });

            if (kind === 'settings') {
                const forumChannelId = String(interaction.fields.getTextInputValue('forumChannelId') || '').trim();
                const logChannelId = String(interaction.fields.getTextInputValue('logChannelId') || '').trim();
                const maxWarnings = Number.isFinite(Number(interaction.fields.getTextInputValue('maxWarnings')))
                    ? Math.max(0, Math.floor(Number(interaction.fields.getTextInputValue('maxWarnings'))))
                    : 3;
                const banReason = String(interaction.fields.getTextInputValue('banReason') || '').trim() || 'تجاوز حد التحذيرات';

                const { updateGuildConfig } = require('./guildConfig');
                updateGuildConfig(interaction.guild.id, c => {
                    const current = c.punishLog && typeof c.punishLog === 'object' ? c.punishLog : {};
                    return {
                        ...c,
                        punishLog: {
                            ...current,
                            forumChannelId: /^\d+$/.test(forumChannelId) ? forumChannelId : null,
                            logChannelId: /^\d+$/.test(logChannelId) ? logChannelId : null,
                            maxWarnings,
                            banReason
                        }
                    };
                });

                const embed = plCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = plCmd.buildConfigRows(interaction.user.id, interaction.guild.id);
                await interaction.deferReply({ ephemeral: true }).catch(() => null);
                return interaction.editReply({ embeds: [embed], components });
            }

            if (kind === 'roles') {
                const rolesInput = String(interaction.fields.getTextInputValue('warningRoles') || '');
                const warningRoles = plCmd.parseWarningRolesInput ? plCmd.parseWarningRolesInput(rolesInput) : [];

                const { updateGuildConfig } = require('./guildConfig');
                updateGuildConfig(interaction.guild.id, c => {
                    const current = c.punishLog && typeof c.punishLog === 'object' ? c.punishLog : {};
                    return { ...c, punishLog: { ...current, warningRoles } };
                });

                const embed = plCmd.buildConfigEmbed(interaction.guild.id, interaction.guild);
                const components = plCmd.buildConfigRows(interaction.user.id, interaction.guild.id);
                await interaction.deferReply({ ephemeral: true }).catch(() => null);
                return interaction.editReply({ embeds: [embed], components });
            }
        }

        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('aipanelModal:')) {
            if (!interaction.guild) return;
            const parts = interaction.customId.split(':');
            const modalType = parts[1] || '';
            const ownerId = parts[2] || '';
            if (ownerId && String(interaction.user.id) !== String(ownerId)) {
                return interaction.reply({ content: 'اسفة بس هاللوحة لصاحبها بس 3:', ephemeral: true });
            }
            if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'اسفة بس هذا الخيار للإدمن فقط 3:', ephemeral: true });
            }

            const normalizeBaseUrl = (input) => {
                const raw = String(input || '').trim();
                if (!raw) return null;
                try {
                    const u = new URL(raw);
                    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
                    u.pathname = '';
                    u.search = '';
                    u.hash = '';
                    return u.toString().replace(/\/$/, '');
                } catch {
                    return null;
                }
            };

            const aiCmd = client.commands.get('ai');
            const buildEmbed = aiCmd && typeof aiCmd.buildAiPanelEmbed === 'function' ? aiCmd.buildAiPanelEmbed : null;
            const buildRows = aiCmd && typeof aiCmd.buildAiPanelRows === 'function' ? aiCmd.buildAiPanelRows : null;

            const refreshPanel = async () => {
                if (buildEmbed && buildRows) {
                    const embed = buildEmbed(interaction.guild.id);
                    const components = buildRows(ownerId || interaction.user.id);
                    try {
                        return await interaction.editReply({ embeds: [embed], components });
                    } catch {
                        // ignore
                    }
                }
                return interaction.editReply({ content: '✅ تم حفظ الإعدادات.', components: [] });
            };

            try {
                await interaction.deferReply({ ephemeral: true });
            } catch {
                // ignore
            }

            if (modalType === 'url') {
                const urlRaw = interaction.fields.getTextInputValue('url');
                const url = normalizeBaseUrl(urlRaw);
                if (!url) return interaction.editReply({ content: 'الرابط غير صحيح. مثال: http://192.168.1.50:11434', components: [] });

                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    ai: {
                        ...(c.ai && typeof c.ai === 'object' ? c.ai : {}),
                        baseUrl: url
                    }
                }));
                return refreshPanel();
            }

            if (modalType === 'model') {
                const model = String(interaction.fields.getTextInputValue('model') || '').trim();
                if (!model) return interaction.editReply({ content: 'اكتب اسم الموديل 3:', components: [] });

                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    ai: {
                        ...(c.ai && typeof c.ai === 'object' ? c.ai : {}),
                        model
                    }
                }));
                return refreshPanel();
            }

            if (modalType === 'tuning') {
                const cooldownSec = Math.floor(Number(interaction.fields.getTextInputValue('cooldownSec') || 0));
                const ttlMin = Math.floor(Number(interaction.fields.getTextInputValue('ttlMin') || 0));

                if (!Number.isFinite(cooldownSec) || cooldownSec < 3 || cooldownSec > 120) {
                    return interaction.editReply({ content: 'Cooldown لازم يكون بين 3 و 120 ثانية.', components: [] });
                }
                if (!Number.isFinite(ttlMin) || ttlMin < 0 || ttlMin > 24 * 60 * 7) {
                    return interaction.editReply({ content: 'TTL غير صحيح (0 إلى 10080 دقيقة).', components: [] });
                }

                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    ai: {
                        ...(c.ai && typeof c.ai === 'object' ? c.ai : {}),
                        cooldownMs: cooldownSec * 1000,
                        memoryTtlMs: ttlMin * 60 * 1000
                    }
                }));
                return refreshPanel();
            }

            if (modalType === 'channel') {
                const chIdRaw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
                const chId = chIdRaw.replace(/[<#>]/g, '');
                if (!/^\d{17,20}$/.test(chId)) {
                    return interaction.editReply({ content: 'ايدي الروم غير صحيح. مثال: 123456789012345678', components: [] });
                }

                const channel = interaction.guild.channels.cache.get(chId);
                if (!channel) {
                    return interaction.editReply({ content: 'ما لقيت هالروم بالسيرفر 3:', components: [] });
                }

                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    ai: {
                        ...(c.ai && typeof c.ai === 'object' ? c.ai : {}),
                        allowedChannelId: chId
                    }
                }));
                return refreshPanel();
            }

            return interaction.editReply({ content: 'اسفة بس هالمودال مو معروف 3:', components: [] });
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musiccat:')) {
            if (!interaction.guild) return;

            const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
            const fs = require('fs');
            const path = require('path');

            try {
                const { ButtonBuilder, ButtonStyle } = require('discord.js');

                await deferUpdateSafe(interaction);

                const parts = interaction.customId.split(':');
                const catKey = parts[1] ? String(parts[1]) : null;
                const ownerId = parts[2] ? String(parts[2]) : null;

                if (ownerId && String(interaction.user.id) !== ownerId) {
                    return replyEphemeral(interaction, { content: 'اسفة بس هالاختيار لصاحب الأمر بس 3:' });
                }

                const resolvedOwner = ownerId || interaction.user.id;
                const view = buildCategoryBrowseView(interaction.guild.id, resolvedOwner, catKey, 0);
                if (!view) {
                    return replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أحدد النوع 3:' });
                }

                return replyEphemeral(interaction, { ...view });
            } catch (err) {
                console.error('playcat handler failed:', err);
                return replyEphemeral(interaction, { content: 'اسفة بس لقيت مشكلة وانا محاول سوي اللي بدك ياه >:' });
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musicpage:')) {
            if (!interaction.guild) return;

            try {
                await deferUpdateSafe(interaction);

                const parts = interaction.customId.split(':');
                const catKey = parts[1] ? String(parts[1]) : null;
                const ownerId = parts[2] ? String(parts[2]) : null;
                const page = parseInt(parts[3], 10) || 0;

                if (ownerId && String(interaction.user.id) !== ownerId) {
                    return replyEphemeral(interaction, { content: 'اسفة بس هالقائمة لصاحب الأمر بس 3:' });
                }

                const view = buildCategoryBrowseView(interaction.guild.id, ownerId || interaction.user.id, catKey, page);
                if (!view) {
                    return replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أحدد النوع 3:' });
                }

                return interaction.editReply({ ...view });
            } catch (err) {
                logError('musicpage handler failed', err);
                return;
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musicback:')) {
            if (!interaction.guild) return;

            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const ownerId = String(interaction.customId.split(':')[1] || '');
            if (ownerId && String(interaction.user.id) !== ownerId) {
                try {
                    return interaction.reply({ content: 'اسفة بس هالزر لصاحب الأمر بس 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const built = interaction.client.music.buildNowPlayingEmbed(interaction.guild.id);
            const embed = built && built.embed
                ? built.embed
                : new EmbedBuilder().setColor('#E7D3B0').setTitle('Music').setDescription('ما فيه شي شغال الحين 3:').setTimestamp();

            const resolvedOwner = ownerId || interaction.user.id;
            const rows = buildPanelRows(resolvedOwner);

            try {
                const res = await interaction.update({ embeds: [embed], components: rows });
                try {
                    const session = getOrCreateVoiceSession(interaction.guild.id);
                    session.musicPanel = {
                        channelId: interaction.channelId,
                        messageId: interaction.message && interaction.message.id ? interaction.message.id : null,
                        ownerId: resolvedOwner
                    };
                    session.lastPanelOwnerId = resolvedOwner;
                } catch {
                    // ignore
                }
                return res;
            } catch {
                try {
                    return interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musicsettings:')) {
            if (!interaction.guild) return;

            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const ownerId = String(interaction.customId.split(':')[1] || '');
            if (ownerId && String(interaction.user.id) !== ownerId) {
                try {
                    return interaction.reply({ content: 'اسفة بس هالزر لصاحب الأمر بس 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const session = getOrCreateVoiceSession(interaction.guild.id);
            const volPct = Math.round(clampNumber(session.volume, 0, 2) * 100);
            const repeatMode = session.repeatMode || (session.repeat ? 'one' : 'off');
            const repeatStatus = repeatMode === 'one' ? '🔁 مقطع واحد' : repeatMode === 'all' ? '🔂 كل القائمة' : 'مطفى';
            const autoplayStatus = session.autoplayShuffle ? 'مفعل' : 'مطفى';

            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('إعدادات التشغيل')
                .setDescription(`الصوت: **${volPct}%**\nالتكرار: **${repeatStatus}**\nالتشغيل التلقائي: **${autoplayStatus}**\n\nاختار من الأزرار تحت 3:`);

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`musicset:volume:${ownerId}`).setLabel('تحكم بالصوت').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`musicset:repeat:${ownerId}`).setLabel('تكرار').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`musicset:autoplay:${ownerId}`).setLabel('تشغيل تلقائي').setStyle(ButtonStyle.Primary)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`musicset:stop:${ownerId}`).setLabel('إيقاف').setStyle(ButtonStyle.Danger)
            );

            try {
                return interaction.reply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
            } catch {
                return;
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musicset:')) {
            if (!interaction.guild) return;

            const { MessageFlags, EmbedBuilder } = require('discord.js');
            const parts = interaction.customId.split(':');
            const action = String(parts[1] || '');
            const ownerId = String(parts[2] || '');
            if (ownerId && String(interaction.user.id) !== ownerId) {
                try {
                    return interaction.reply({ content: 'اسفة بس هالزر لصاحب الأمر بس 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const session = getOrCreateVoiceSession(interaction.guild.id);

            if (action === 'volume') {
                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
                const volPct = Math.round(clampNumber(session.volume, 0, 2) * 100);
                const modal = new ModalBuilder()
                    .setCustomId(`musicModal:volume:${ownerId}`)
                    .setTitle('تحكم بالصوت');
                const input = new TextInputBuilder()
                    .setCustomId('percent')
                    .setLabel('نسبة الصوت (0 - 200)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(volPct));
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                try {
                    return interaction.showModal(modal);
                } catch {
                    try {
                        return interaction.reply({ content: 'اسفة بس ما قدرت أفتح نافذة التحكم بالصوت 3:', flags: MessageFlags.Ephemeral });
                    } catch {
                        return;
                    }
                }
            }

            if (action === 'repeat') {
                const mode = client.music.cycleRepeatMode(interaction.guild.id);
                const label = mode === 'one' ? '🔁 مقطع واحد' : mode === 'all' ? '🔂 كل القائمة' : 'مطفى';
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.reply({ content: `التكرار صار: **${label}** 3:`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'autoplay') {
                session.autoplayShuffle = !session.autoplayShuffle;
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.reply({ content: `التشغيل التلقائي صار: **${session.autoplayShuffle ? 'مفعل' : 'مطفى'}** 3:`, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            if (action === 'stop') {
                await client.music.stop(interaction.guild.id);
                try {
                    try { await refreshMusicPanelMessage(interaction.guild.id); } catch { /* ignore */ }
                    return interaction.reply({ content: 'تم إيقاف التشغيل ومسح القائمة 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            try {
                return interaction.reply({ content: 'اسفة بس ما فهمت هالخيار 3:', flags: MessageFlags.Ephemeral });
            } catch {
                return;
            }
        }

        if (interaction.isButton() && interaction.customId === 'lootbox:open') {
            if (!interaction.guild) return;

            const reply = async (payload) => {
                try {
                    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
                } catch {
                    // ignore
                }
                try {
                    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            };

            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                }
            } catch {
                // ignore
            }

            const cfg = getGuildConfig(interaction.guild.id);
            const l = cfg.lootboxes && typeof cfg.lootboxes === 'object' ? cfg.lootboxes : {};
            const now = Date.now();
            if (!l.activeMessageId || String(l.activeMessageId) !== String(interaction.message?.id || '')) {
                return reply({ content: '🌙 هذا اللوت بوكس مو متاح (يمكن انتهى أو انفتح).' });
            }
            if (l.activeUntil && now >= Number(l.activeUntil)) {
                return reply({ content: 'فاتك… اللوت بوكس انتهى 😅' });
            }
            if (l.openedBy) {
                return reply({ content: 'انفتح بالفعل 3:' });
            }

            const reward = 7 + Math.floor(Math.random() * 9);
            addLunaPoints(interaction.guild.id, interaction.user.id, reward);

            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                lootboxes: {
                    ...(c.lootboxes && typeof c.lootboxes === 'object' ? c.lootboxes : {}),
                    activeMessageId: null,
                    activeUntil: 0,
                    openedBy: String(interaction.user.id)
                }
            }));

            try {
                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🎉 تم فتح اللوت بوكس!')
                    .setDescription(`انفتح بواسطة: ${interaction.user}\n\nالمكافأة: **${reward}** Luna Points 💰🌙`)
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('lootbox:opened').setLabel('انفتح').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                await interaction.message.edit({ embeds: [embed], components: [row] });
            } catch {
                // ignore
            }

            return reply({ content: `🎁🌙 مبروك! حصلت على **${reward}** Luna Points.` });
        }

        // Suggestions approve/reject buttons (admin only)
        if (interaction.isButton() && typeof interaction.customId === 'string' && 
            (interaction.customId.startsWith('suggestions:approve:') || interaction.customId.startsWith('suggestions:reject:'))) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
            }

            if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Administrator عشان تضغط هالأزرار 3:', ephemeral: true });
            }

            const parts = interaction.customId.split(':');
            const action = parts[1];
            const messageId = parts[2] || (interaction.message && interaction.message.id ? interaction.message.id : '');
            const channelId = interaction.channelId || (interaction.channel && interaction.channel.id ? interaction.channel.id : '');

            // Ask for optional reason via modal (prevents accidental clicks and improves auditability)
            try {
                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
                let key = '';
                try {
                    const crypto = require('crypto');
                    key = crypto.randomBytes(6).toString('hex');
                } catch {
                    key = String(Math.random()).slice(2, 10);
                }
                pendingSuggestionModerations.set(key, {
                    guildId: String(interaction.guild.id),
                    channelId: String(channelId || ''),
                    messageId: String(messageId || ''),
                    action: String(action || ''),
                    createdAt: Date.now()
                });

                const modal = new ModalBuilder()
                    .setCustomId(`suggestions:mod:${key}`)
                    .setTitle(action === 'approve' ? 'موافقة على اقتراح' : 'رفض اقتراح');

                const reason = new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('السبب (اختياري)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(400);

                modal.addComponents(new ActionRowBuilder().addComponents(reason));
                return interaction.showModal(modal);
            } catch {
                // fallback: proceed بدون سبب
            }

            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const currentEmbed = interaction.message && Array.isArray(interaction.message.embeds) && interaction.message.embeds[0]
                ? interaction.message.embeds[0]
                : null;

            const embed = currentEmbed ? EmbedBuilder.from(currentEmbed) : new EmbedBuilder().setColor('#E7D3B0').setTitle('💡 اقتراح');

            const fields = Array.isArray(embed.data.fields) ? embed.data.fields : [];
            const idx = fields.findIndex((f) => f && f.name === 'الحالة');
            const newStatus = action === 'approve' ? 'تمت الموافقة ✅' : 'تم الرفض ⛔';
            const newColor = action === 'approve' ? '#57F287' : '#ED4245';
            embed.setColor(newColor);
            if (idx >= 0) {
                fields[idx] = { ...fields[idx], value: newStatus };
                embed.setFields(fields);
            } else {
                embed.addFields({ name: 'الحالة', value: newStatus, inline: true });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('suggestions:approve:disabled')
                    .setLabel('موافقة')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('suggestions:reject:disabled')
                    .setLabel('رفض')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true)
            );

            if (action === 'approve') {
                try {
                    const cfg = getGuildConfig(interaction.guild.id);
                    const outId = cfg && typeof cfg.suggestionsApprovedChannelId === 'string' ? cfg.suggestionsApprovedChannelId : null;
                    if (outId) {
                        const outCh = await interaction.guild.channels.fetch(outId).catch(() => null);
                        if (outCh && outCh.isTextBased && outCh.isTextBased()) {
                            const jump = interaction.message?.url ? `\n\n🔗 رابط الاقتراح: ${interaction.message.url}` : '';
                            const forwarded = EmbedBuilder.from(embed).setFooter({ text: 'اقتراح تمت الموافقة عليه' });
                            const desc = (forwarded.data.description || '').slice(0, 3800);
                            forwarded.setDescription(`${desc}${jump}`.slice(0, 4096));
                            await outCh.send({ embeds: [forwarded] });
                        }
                    }
                } catch (err) {
                    console.error('suggestions:approve forward error:', err);
                }
            }

            try {
                const logEmbed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle(action === 'approve' ? '💡 اقتراح: تمت الموافقة' : '💡 اقتراح: تم الرفض')
                    .setDescription(`${interaction.user} ${action === 'approve' ? 'وافق' : 'رفض'} اقتراحًا.${interaction.message?.url ? `\n\n🔗 ${interaction.message.url}` : ''}`)
                    .setTimestamp();
                await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
            } catch {
                // ignore
            }

            try {
                await interaction.update({ embeds: [embed], components: [row] });
            } catch {
                try {
                    await interaction.reply({ content: 'اسفة بس ما قدرت أحدث الاقتراح… ممكن الرسالة قديمة/تم حذفها 3:', ephemeral: true });
                } catch {
                    // ignore
                }
            }
            return;
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('forumPost:')) {
            if (!interaction.guild) return;

            const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
            const parts = interaction.customId.split(':');
            const postId = parts[1] || '';
            const kind = parts[2] || '';
            const idxRaw = parts[3] || '0';
            const btnIdx = Math.max(0, Math.min(4, parseInt(idxRaw, 10) || 0));

            if (kind !== 'btn') {
                return interaction.reply({ content: 'اسفة بس ما فهمت 3:', ephemeral: true });
            }

            const forumUi = require('./forumUi');
            const post = forumUi.getPostById(postId);
            if (!post || !post.data) {
                return interaction.reply({ content: 'اسفة بس ما لقيت بيانات المنشور 3:', ephemeral: true });
            }

            const buttons = Array.isArray(post.data.buttons) ? post.data.buttons : [];
            const b = buttons[btnIdx];
            const options = Array.isArray(b && b.options ? b.options : []) ? b.options : [];
            if (!options.length) {
                return interaction.reply({ content: 'ما فيه خيارات لهذا الزر.', ephemeral: true });
            }

            const menu = new StringSelectMenuBuilder()
                .setCustomId(`forumPostSel:${postId}:${btnIdx}`)
                .setPlaceholder('اختار من القائمة')
                .addOptions(
                    options.slice(0, 25).map((o, i) => ({
                        label: String(o.label || `خيار ${i + 1}`).slice(0, 100),
                        value: String(i)
                    }))
                );

            const row = new ActionRowBuilder().addComponents(menu);
            return interaction.reply({ content: `📌 ${String(b.label || 'خيارات')}`, components: [row], ephemeral: true });
        }

        if (interaction.isStringSelectMenu && interaction.isStringSelectMenu() && typeof interaction.customId === 'string' && interaction.customId.startsWith('forumPostSel:')) {
            if (!interaction.guild) return;

            const parts = interaction.customId.split(':');
            const postId = parts[1] || '';
            const idxRaw = parts[2] || '0';
            const btnIdx = Math.max(0, Math.min(4, parseInt(idxRaw, 10) || 0));
            const choiceIdx = interaction.values && interaction.values[0] ? parseInt(interaction.values[0], 10) : 0;

            const forumUi = require('./forumUi');
            const post = forumUi.getPostById(postId);
            if (!post || !post.data) {
                return interaction.reply({ content: 'اسفة بس ما لقيت بيانات المنشور 3:', ephemeral: true });
            }
            const buttons = Array.isArray(post.data.buttons) ? post.data.buttons : [];
            const b = buttons[btnIdx];
            const options = Array.isArray(b && b.options ? b.options : []) ? b.options : [];
            const opt = options[Math.max(0, Math.min(options.length - 1, choiceIdx))];
            if (!opt) {
                return interaction.reply({ content: 'اسفة بس الخيار مو موجود 3:', ephemeral: true });
            }

            try {
                return interaction.update({ content: String(opt.response || '').slice(0, 1900), components: [] });
            } catch {
                try {
                    return interaction.reply({ content: String(opt.response || '').slice(0, 1900), ephemeral: true });
                } catch {
                    return;
                }
            }
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'useSelect:type') {
            if (!interaction.guild) return;

            const raw = interaction.values && interaction.values[0] ? String(interaction.values[0]) : '';
            const type = raw === 'title' || raw === 'boost' || raw === 'service' ? raw : null;
            if (!type) {
                return interaction.reply({ content: 'اسفة بس ما فهمت الاختيار 3:', ephemeral: true });
            }

            const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
            const inv = getUserInventory(interaction.guild.id, interaction.user.id);

            const respondUse = async (payload) => {
                try {
                    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
                } catch {
                    // ignore
                }
                try {
                    return await interaction.reply({ ...payload, ephemeral: payload.ephemeral ?? true });
                } catch {
                    return;
                }
            };

            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ ephemeral: true });
                }
            } catch {
                // ignore
            }

            if (type === 'title') {
                const titles = Array.isArray(inv.titles) ? inv.titles.filter((t) => t && typeof t.title === 'string') : [];
                if (!titles.length) return respondUse({ content: 'ما عندك ألقاب قابلة للاستخدام حاليًا 😅', components: [] });

                const options = titles.slice(0, 25).map((t, idx) => ({
                    label: String(t.title).slice(0, 100),
                    value: `t:${idx}`
                }));

                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🎭 الألقاب')
                    .setDescription('اختار اللقب اللي تبغى تفعّله:');

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('useSelect:item:title')
                        .setPlaceholder('اختار لقب...')
                        .addOptions(options)
                );

                return respondUse({ embeds: [embed], components: [row] });
            }

            if (type === 'boost') {
                const boosts = Array.isArray(inv.boosts) ? inv.boosts.filter((b) => b && typeof b.type === 'string') : [];
                if (!boosts.length) return respondUse({ content: 'ما عندك بوستات قابلة للاستخدام حاليًا 😅', components: [] });

                const seen = new Set();
                const options = [];
                for (const b of boosts) {
                    const key = String(b.type);
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    options.push({ label: (getBoostNameAr(key) || key).slice(0, 100), value: `b:${key}` });
                    if (options.length >= 25) break;
                }
                if (!options.length) return respondUse({ content: 'ما عندك بوستات قابلة للاستخدام حاليًا 😅', components: [] });

                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🌟 البوستات')
                    .setDescription('اختار البوست اللي تبغى تفعّله:');

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('useSelect:item:boost')
                        .setPlaceholder('اختار بوست...')
                        .addOptions(options)
                );

                return respondUse({ embeds: [embed], components: [row] });
            }

            if (type === 'service') {
                const services = inv.services && typeof inv.services === 'object' ? inv.services : {};
                const entries = Object.entries(services).filter(([, v]) => typeof v === 'number' && v > 0);
                if (!entries.length) return respondUse({ content: 'ما عندك خدمات قابلة للاستخدام حاليًا 😅', components: [] });

                const labelMap = {
                    renameOnce: '📝 تغيير الاسم (مرة واحدة)',
                    xpTransfer: '🎯 نقل XP (مرة واحدة)',
                    rebalance: '🔄 إعادة توازن',
                    vipTitle: '👑 لقب VIP (24 ساعة)',
                    shield: '🛡️ درع الحماية'
                };
                const keyToValue = {
                    renameOnce: 'rename_once',
                    xpTransfer: 'xp_transfer',
                    rebalance: 'rebalance',
                    vipTitle: 'vip_title',
                    shield: 'shield'
                };

                const options = entries.slice(0, 25).map(([k, v]) => ({
                    label: `${labelMap[k] || k} (${v})`.slice(0, 100),
                    value: `s:${keyToValue[k] || k}`
                }));

                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🧩 الخدمات')
                    .setDescription('اختار الخدمة اللي تبغى تستخدمها:');

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('useSelect:item:service')
                        .setPlaceholder('اختار خدمة...')
                        .addOptions(options)
                );

                return respondUse({ embeds: [embed], components: [row] });
            }

            return respondUse({ content: 'اسفة بس ما فهمت الاختيار 3:', components: [] });
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('useSelect:item:')) {
            if (!interaction.guild) return;
            const type = interaction.customId.split(':')[2];
            const raw = interaction.values && interaction.values[0] ? interaction.values[0] : '';

            const useCommand = client.commands.get('use');
            if (!useCommand || typeof useCommand.useItem !== 'function') {
                return interaction.reply({ content: 'اسفة بس أمر /use مو جاهز 3:', ephemeral: true });
            }

            const respondUse = async (payload) => {
                if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
                return interaction.reply({ ...payload, ephemeral: payload.ephemeral ?? true });
            };

            const ackEphemeral = async () => {
                try {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.deferReply({ ephemeral: true });
                    }
                } catch {
                    // ignore
                }
            };

            if (type === 'title') {
                await ackEphemeral();
                const inv = getUserInventory(interaction.guild.id, interaction.user.id);
                const titles = Array.isArray(inv.titles) ? inv.titles.filter((t) => t && typeof t.title === 'string') : [];
                const idx = raw.startsWith('t:') ? Number(raw.slice(2)) : NaN;
                const title = Number.isInteger(idx) && idx >= 0 && idx < titles.length ? titles[idx].title : null;
                if (!title) return respondUse({ content: 'اسفة بس ما قدرت أحدد اللقب 3:' });
                try {
                    return await useCommand.useItem(interaction, { type: 'title', value: title });
                } catch (err) {
                    console.error('useSelect:item:title error:', err);
                    return respondUse({ content: 'صار خطأ وأنا أفعّل اللقب 😩' });
                }
            }

            if (type === 'boost') {
                await ackEphemeral();
                const boostType = raw.startsWith('b:') ? raw.slice(2) : null;
                if (!boostType) return respondUse({ content: 'اسفة بس ما قدرت أحدد البوست 3:' });
                try {
                    return await useCommand.useItem(interaction, { type: 'boost', value: boostType });
                } catch (err) {
                    console.error('useSelect:item:boost error:', err);
                    return respondUse({ content: 'صار خطأ وأنا أفعّل البوست 😩' });
                }
            }

            if (type === 'service') {
                const serviceKey = raw.startsWith('s:') ? raw.slice(2) : null;
                if (!serviceKey) return interaction.reply({ content: 'اسفة بس ما قدرت أحدد الخدمة 3:', ephemeral: true });

                const modalServices = new Set(['rename_once', 'xp_transfer', 'rebalance']);

                if (!modalServices.has(serviceKey)) {
                    await ackEphemeral();
                }

                try {
                    return await useCommand.useItem(interaction, { type: 'service', value: serviceKey });
                } catch (err) {
                    console.error('useSelect:item:service error:', err);
                    if (interaction.deferred || interaction.replied) {
                        return interaction.editReply({ content: 'صار خطأ وأنا أستخدم الخدمة 😩', components: [] });
                    }
                    return interaction.reply({ content: 'صار خطأ وأنا أستخدم الخدمة 😩', ephemeral: true });
                }
            }

            return interaction.reply({ content: 'اسفة بس نوع غير معروف 3:', ephemeral: true });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'botguilds:select') {
            if (!interaction.guild) return;

            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'اسفة بس هذا الخيار للمالك فقط 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const guildId = interaction.values && interaction.values[0] ? String(interaction.values[0]) : null;
            if (!guildId) {
                try {
                    return interaction.update({ content: 'اسفة بس ما قدرت أحدد السيرفر 3:', components: [] });
                } catch {
                    return;
                }
            }

            const g = client.guilds.cache.get(guildId);
            const label = g ? `${g.name} (${g.id})` : guildId;

            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`botguilds:leave:${guildId}`).setLabel('خروج من السيرفر').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('botguilds:cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
            );

            try {
                return interaction.update({
                    content: `تأكيد: تبغى البوت يطلع من السيرفر؟\n**${label}**`,
                    components: [row]
                });
            } catch {
                return;
            }
        }

        if (interaction.isButton() && typeof interaction.customId === 'string' && interaction.customId.startsWith('botguilds:')) {
            if (!interaction.guild) return;

            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID;
            if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
                try {
                    return interaction.reply({ content: 'اسفة بس هذا الخيار للمالك فقط 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const parts = interaction.customId.split(':');
            const action = parts[1];

            if (action === 'infoall') {
                try {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.deferReply();
                    }
                } catch {
                    // ignore
                }

                const guilds = [...client.guilds.cache.values()]
                    .map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount || 0 }))
                    .sort((a, b) => b.memberCount - a.memberCount);

                if (!guilds.length) {
                    try {
                        return interaction.editReply({ content: 'البوت مو موجود بأي سيرفر حاليًا.' });
                    } catch {
                        return;
                    }
                }

                const { PermissionsBitField, ChannelType, AttachmentBuilder } = require('discord.js');

                const lines = [];
                lines.push(`Guilds: ${guilds.length}`);
                lines.push('');

                for (const item of guilds) {
                    const g = client.guilds.cache.get(item.id);
                    if (!g) continue;

                    let ownerTxt = 'Unknown';
                    try {
                        const owner = await g.fetchOwner();
                        ownerTxt = owner && owner.user ? `${owner.user.tag} (${owner.user.id})` : ownerTxt;
                    } catch {
                        // ignore
                    }

                    let inviteTxt = 'لا يوجد';
                    try {
                        const me = g.members.me || (await g.members.fetchMe().catch(() => null));
                        if (me) {
                            const channels = [...g.channels.cache.values()];
                            const candidate = channels.find((ch) => {
                                if (!ch || !ch.isTextBased || !ch.isTextBased()) return false;
                                if (!ch.viewable) return false;
                                if (ch.type === ChannelType.GuildForum) return false;
                                if (typeof ch.createInvite !== 'function') return false;
                                const perms = ch.permissionsFor(me);
                                if (!perms) return false;
                                return perms.has(PermissionsBitField.Flags.CreateInstantInvite);
                            });

                            if (candidate) {
                                const inv = await candidate.createInvite({ maxAge: 0, maxUses: 0, unique: true }).catch(() => null);
                                if (inv && inv.url) inviteTxt = inv.url;
                            }
                        }
                    } catch {
                        // ignore
                    }

                    lines.push(`- Name: ${g.name}`);
                    lines.push(`  ID: ${g.id}`);
                    lines.push(`  Members: ${g.memberCount || item.memberCount || 0}`);
                    lines.push(`  Owner: ${ownerTxt}`);
                    lines.push(`  Invite: ${inviteTxt}`);
                    lines.push('');
                }

                const text = lines.join('\n').slice(0, 190000);
                const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'guilds.txt' });

                try {
                    return interaction.editReply({ content: 'تم ✅ (الملف يحتوي التفاصيل)', files: [file] });
                } catch {
                    try {
                        return interaction.editReply({ content: 'تم ✅ بس ما قدرت أرسل الملف.' });
                    } catch {
                        return;
                    }
                }
            }

            if (action === 'cancel') {
                try {
                    return interaction.update({ content: 'تم الإلغاء.', components: [] });
                } catch {
                    return;
                }
            }

            if (action === 'leave') {
                const guildId = parts[2] ? String(parts[2]) : null;
                if (!guildId) {
                    try {
                        return interaction.update({ content: 'اسفة بس ما قدرت أحدد السيرفر 3:', components: [] });
                    } catch {
                        return;
                    }
                }

                const g = client.guilds.cache.get(guildId);
                if (!g) {
                    try {
                        return interaction.update({ content: 'البوت مو موجود بالسيرفر هذا (يمكن طلع already).', components: [] });
                    } catch {
                        return;
                    }
                }

                try {
                    await g.leave();
                    return interaction.update({ content: `✅ تم الخروج من: **${g.name}** (${g.id})`, components: [] });
                } catch {
                    try {
                        return interaction.update({ content: 'اسفة بس ما قدرت أطلع من السيرفر 3:', components: [] });
                    } catch {
                        return;
                    }
                }
            }

            return;
        }

        // === AI ACTION CONFIRMATION BUTTONS ===
        // Current format:
        // - ai_act:c:<key>
        // - ai_act:x:<key>
        // Backward-compat formats:
        // - ai_act_c:<key>
        // - ai_act_x:<key>
        if (
            interaction.isButton()
            && typeof interaction.customId === 'string'
            && (interaction.customId.startsWith('ai_act:') || interaction.customId.startsWith('ai_act_c:') || interaction.customId.startsWith('ai_act_x:'))
        ) {
            if (!interaction.guild) return interaction.reply({ content: 'This action can only be performed in a server.', ephemeral: true });
            
            let actionType = '';
            let actionKey = '';
            const cid = interaction.customId;

            if (cid.startsWith('ai_act:')) {
                const parts = cid.split(':');
                actionType = parts[1] || ''; // 'c' or 'x'
                actionKey = parts[2] || '';
            } else if (cid.startsWith('ai_act_c:')) {
                actionType = 'c';
                actionKey = cid.slice('ai_act_c:'.length);
            } else if (cid.startsWith('ai_act_x:')) {
                actionType = 'x';
                actionKey = cid.slice('ai_act_x:'.length);
            }

            actionKey = String(actionKey || '').trim();

            // Cleanup old pending actions (10 minutes)
            cleanupPendingActions();

            const pending = actionKey ? getPendingAction(actionKey) : null;
            if (!pending) {
                try {
                    return interaction.reply({ content: 'This action request has expired or is no longer available.', ephemeral: true });
                } catch {
                    return;
                }
            }

            const requesterId = pending.requesterId || '';
            
            // Only the original requester can confirm/cancel
            if (requesterId && String(interaction.user.id) !== String(requesterId)) {
                return interaction.reply({ content: 'Only the user who requested this action can confirm or cancel it.', ephemeral: true });
            }
            
            if (actionType === 'x') {
                deletePendingAction(actionKey);
                return interaction.update({ content: '❌ Action cancelled.', embeds: [], components: [] });
            }
            
            if (actionType === 'c') {
                const actionTypeActual = pending.type || '';
                const targetUserId = pending.userId || '';
                const reason = pending.reason || '';
                const seconds = pending.seconds || '';
                const messageId = pending.messageId || '';
                
                const { EmbedBuilder } = require('discord.js');
                
                try {
                    // Check permissions again
                    const requesterIsAdmin = !!(interaction.member && interaction.member.permissions && interaction.member.permissions.has && interaction.member.permissions.has(PermissionsBitField.Flags.Administrator));
                    const requesterIsMod = !!(interaction.member && interaction.member.permissions && interaction.member.permissions.has && interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers));
                    
                    if (actionTypeActual === 'ban' && !requesterIsAdmin) {
                        return interaction.update({ content: '⛔ Ban requires Administrator permissions.', embeds: [], components: [] });
                    }
                    if (['warn', 'timeout', 'delete_message'].includes(actionTypeActual) && !requesterIsMod && !requesterIsAdmin) {
                        return interaction.update({ content: '⛔ This action requires Moderator permissions.', embeds: [], components: [] });
                    }
                    
                    let resultText = '';
                    
                    if (actionTypeActual === 'member_info' && targetUserId) {
                        let member = null;
                        try {
                            member = await interaction.guild.members.fetch(targetUserId);
                        } catch {
                            member = interaction.guild.members.cache.get(targetUserId) || null;
                        }
                        
                        if (!member) {
                            resultText = 'Could not find that member.';
                        } else {
                            const roleNames = member.roles && member.roles.cache
                                ? [...member.roles.cache.values()]
                                    .filter((r) => r && r.name && r.id !== interaction.guild.id)
                                    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
                                    .slice(0, 10)
                                    .map((r) => r.name)
                                : [];
                            
                            let stats = null;
                            try { stats = getUserStats(interaction.guild.id, targetUserId); } catch {}
                            
                            let warnCount = 0;
                            try {
                                const punishLog = require('./punishLog');
                                warnCount = punishLog.getPunishmentCount(interaction.guild.id, targetUserId) || 0;
                            } catch {}
                            try {
                                const { listWarnings } = require('./db');
                                const ws = listWarnings(interaction.guild.id, targetUserId, 100);
                                warnCount += ws ? ws.length : 0;
                            } catch {}
                            
                            const infoEmbed = new EmbedBuilder()
                                .setColor('#E7D3B0')
                                .setTitle(`📋 Member Info: ${member.displayName}`)
                                .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
                                .addFields(
                                    { name: 'User', value: `${member.user} (${member.user.id})`, inline: false },
                                    { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
                                    { name: 'Account Created', value: member.user.createdTimestamp ? `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` : 'Unknown', inline: true },
                                    { name: 'Roles', value: roleNames.length ? roleNames.join(', ') : 'None', inline: false },
                                    { name: 'Level', value: stats ? `${stats.level}` : 'Unknown', inline: true },
                                    { name: 'Luna Points', value: stats ? `${stats.lunaPoints}` : 'Unknown', inline: true },
                                    { name: 'Warnings', value: `${warnCount}`, inline: true }
                                )
                                .setTimestamp();
                            
                            return interaction.update({ content: '', embeds: [infoEmbed], components: [] });
                        }
                    } else if (actionTypeActual === 'warn' && targetUserId) {
                        try {
                            const modActions = require('./modActions');
                            const warnReason = reason || 'No reason provided';
                            const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
                            const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
                            if (targetUser) {
                                // التسجيل الموحّد: سجل العقوبات + رتب التحذير + الباند التلقائي + إشعار العضو
                                await modActions.executePunishment({
                                    client: interaction.client,
                                    guild: interaction.guild,
                                    moderator: interaction.member,
                                    targetUser,
                                    targetMember,
                                    type: 'warn',
                                    reason: warnReason
                                });
                            }

                            // Send a visible warning message in the channel
                            try {
                                if (interaction.channel && interaction.channel.send) {
                                    await interaction.channel.send(`⚠️ <@${targetUserId}> has been warned. Reason: ${warnReason}`);
                                }
                            } catch {
                                // ignore
                            }

                            resultText = `✅ <@${targetUserId}> has been warned. Reason: ${warnReason}`;
                            
                            // Log the warning
                            const logEmbed = new EmbedBuilder()
                                .setColor('#E7D3B0')
                                .setTitle('⚠️ Warning Issued')
                                .setDescription(`User: <@${targetUserId}>\nBy: ${interaction.user}\nReason: ${warnReason}`)
                                .setTimestamp();
                            await sendGuildLog(interaction.guild, { embeds: [logEmbed] }, { category: 'moderation' });
                        } catch (e) {
                            resultText = 'Failed to warn user.';
                        }
                    } else if (actionTypeActual === 'timeout' && targetUserId) {
                        const timeoutSec = Math.max(1, Math.min(604800, Math.floor(Number(seconds) || 60)));
                        try {
                            const targetMember = await interaction.guild.members.fetch(targetUserId);
                            const warnReason = reason || 'No reason provided';

                            if (targetMember.moderatable) {
                                await targetMember.timeout(timeoutSec * 1000, warnReason);
                                resultText = `✅ <@${targetUserId}> has been timed out for ${timeoutSec} seconds. Reason: ${warnReason}`;
                                
                                const logEmbed = new EmbedBuilder()
                                    .setColor('#E7D3B0')
                                    .setTitle('⏱️ Timeout Issued')
                                    .setDescription(`User: <@${targetUserId}>\nBy: ${interaction.user}\nDuration: ${timeoutSec}s\nReason: ${warnReason}`)
                                    .setTimestamp();
                                await sendGuildLog(interaction.guild, { embeds: [logEmbed] }, { category: 'moderation' });
                            } else {
                                // Detailed diagnostics
                                const me = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
                                const botHasPerm = !!(me && me.permissions && me.permissions.has && me.permissions.has(PermissionsBitField.Flags.ModerateMembers));
                                const botTop = me && me.roles && me.roles.highest ? me.roles.highest : null;
                                const requesterMember = interaction.member || null;
                                const requesterTop = requesterMember && requesterMember.roles && requesterMember.roles.highest ? requesterMember.roles.highest : null;
                                const targetTop = targetMember && targetMember.roles && targetMember.roles.highest ? targetMember.roles.highest : null;
                                const botRolePos = botTop ? botTop.position : -1;
                                const requesterRolePos = requesterTop ? requesterTop.position : -1;
                                const targetRolePos = targetTop ? targetTop.position : -1;
                                const hierarchyOk = botRolePos > targetRolePos;
                                const isOwner = !!(interaction.guild && interaction.guild.ownerId && String(targetMember.id) === String(interaction.guild.ownerId));

                                const reasons = [];
                                if (!botHasPerm) reasons.push('Bot lacks Moderate Members permission.');
                                if (!hierarchyOk) reasons.push('Bot role is not higher than the target user role.');
                                if (isOwner) reasons.push('Target user is the server owner (cannot be moderated).');
                                if (!reasons.length) reasons.push('Unknown moderation constraint.');

                                resultText = [
                                    'Cannot timeout this user.',
                                    '',
                                    `Checks:`,
                                    `- Bot has ModerateMembers: ${botHasPerm ? 'YES' : 'NO'}`,
                                    `- Bot top role: ${botTop ? `${botTop.name} (${botRolePos})` : 'Unknown'}`,
                                    `- Requester top role: ${requesterTop ? `${requesterTop.name} (${requesterRolePos})` : 'Unknown'}`,
                                    `- Target top role: ${targetTop ? `${targetTop.name} (${targetRolePos})` : 'Unknown'}`,
                                    `- Role hierarchy OK: ${hierarchyOk ? 'YES' : 'NO'}`,
                                    `- Target is server owner: ${isOwner ? 'YES' : 'NO'}`,
                                    '',
                                    `Reason(s): ${reasons.join(' ')}`,
                                    '',
                                    'Fix: Give the bot the Moderate Members permission and move the bot role above the target user roles.'
                                ].join('\n');
                            }
                        } catch (e) {
                            resultText = 'Failed to timeout user.';
                        }
                    } else if (actionTypeActual === 'ban' && targetUserId) {
                        try {
                            await interaction.guild.bans.create(targetUserId, { reason: reason || 'No reason provided' });
                            resultText = `✅ <@${targetUserId}> has been banned. Reason: ${reason || 'No reason provided'}`;
                            
                            const logEmbed = new EmbedBuilder()
                                .setColor('#E7D3B0')
                                .setTitle('🔨 Ban Issued')
                                .setDescription(`User: <@${targetUserId}>\nBy: ${interaction.user}\nReason: ${reason || 'No reason provided'}`)
                                .setTimestamp();
                            await sendGuildLog(interaction.guild, { embeds: [logEmbed] }, { category: 'moderation' });
                        } catch (e) {
                            resultText = 'Failed to ban user.';
                        }
                    } else if (actionTypeActual === 'delete_message' && messageId) {
                        try {
                            const msg = await interaction.channel.messages.fetch(messageId).catch(() => null);
                            if (msg && msg.deletable) {
                                await msg.delete();
                                resultText = '✅ Message deleted.';
                            } else {
                                resultText = 'Cannot delete that message.';
                            }
                        } catch (e) {
                            resultText = 'Failed to delete message.';
                        }
                    } else if (actionTypeActual === 'server_info') {
                        const g = interaction.guild;
                        const serverEmbed = new EmbedBuilder()
                            .setColor('#E7D3B0')
                            .setTitle(`📊 Server Info: ${g.name}`)
                            .setThumbnail(g.iconURL({ size: 128 }))
                            .addFields(
                                { name: 'Server ID', value: g.id, inline: true },
                                { name: 'Members', value: `${g.memberCount || 'Unknown'}`, inline: true },
                                { name: 'Channels', value: `${g.channels && g.channels.cache ? g.channels.cache.size : 'Unknown'}`, inline: true },
                                { name: 'Roles', value: `${g.roles && g.roles.cache ? g.roles.cache.size : 'Unknown'}`, inline: true },
                                { name: 'Created', value: g.createdTimestamp ? `<t:${Math.floor(g.createdTimestamp / 1000)}:R>` : 'Unknown', inline: true },
                                { name: 'Owner', value: g.ownerId ? `<@${g.ownerId}>` : 'Unknown', inline: true }
                            )
                            .setTimestamp();
                        
                        return interaction.update({ content: '', embeds: [serverEmbed], components: [] });
                    } else {
                        resultText = 'Unknown action type.';
                    }

                    deletePendingAction(actionKey);

                    return interaction.update({ content: resultText, embeds: [], components: [] });
                } catch (e) {
                    console.error('AI action execution error:', e);
                    deletePendingAction(actionKey);
                    return interaction.update({ content: 'An error occurred while executing the action.', embeds: [], components: [] });
                }
            }
            
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'renameModal:rename_once') {
            if (!interaction.guild) return;

            const raw = String(interaction.fields.getTextInputValue('nickname') || '').replace(/\s+/g, ' ').trim();
            if (!raw) {
                return interaction.reply({ content: 'اسفة بس الاسم ما ينفع يكون فاضي 3:', ephemeral: true });
            }
            if (raw.length > 32) {
                return interaction.reply({ content: 'اسفة بس الاسم طويل… الحد الأقصى 32 حرف 3:', ephemeral: true });
            }
            if (/@everyone|@here/i.test(raw)) {
                return interaction.reply({ content: 'اسفة بس ممنوع @everyone أو @here بالاسم >:', ephemeral: true });
            }

            const inv = getUserInventory(interaction.guild.id, interaction.user.id);
            const renameCount = inv.services && typeof inv.services.renameOnce === 'number' ? inv.services.renameOnce : 0;
            if (!inv.services || renameCount <= 0) {
                return interaction.reply({ content: 'اسفة بس ما عندك بطاقة تغيير الاسم ضمن ممتلكاتك 3:', ephemeral: true });
            }

            let member;
            try {
                member = await interaction.guild.members.fetch(interaction.user.id);
            } catch {
                member = null;
            }
            if (!member) {
                return interaction.reply({ content: 'اسفة بس ما قدرت أوصل لعضويتك بالسيرفر 3:', ephemeral: true });
            }

            const botMember = interaction.guild.members.me;
            if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
                return interaction.reply({ content: 'اسفة بس ما عندي صلاحية تغيير الأسماء (Manage Nicknames) 3:', ephemeral: true });
            }
            if (botMember.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
                return interaction.reply({ content: 'اسفة بس ما بقدر أغير اسمك… رتبتك أعلى/تساوي رتبة لونا >:', ephemeral: true });
            }

            try {
                await member.setNickname(raw, 'Rename card');
            } catch {
                return interaction.reply({ content: 'اسفة بس ما قدرت أغير الاسم… تأكد من الصلاحيات وإعدادات السيرفر 3:', ephemeral: true });
            }

            updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
                const next = { ...cur };
                next.services = next.services && typeof next.services === 'object' ? { ...next.services } : { renameOnce: 0 };
                next.services.renameOnce = typeof next.services.renameOnce === 'number' ? next.services.renameOnce : 0;
                next.services.renameOnce = Math.max(0, next.services.renameOnce - 1);
                return next;
            });

            return interaction.reply({ content: `تم تغيير اسمك بنجاح ✅\nالاسم الجديد: **${raw}**`, ephemeral: true });
        }

        if (interaction.isModalSubmit() && interaction.customId === 'xpTransferModal:xp_transfer') {
            if (!interaction.guild) return;

            const { updateUserStats, getUserStats } = require('./levelsStore');
            const { getUserInventory, updateUserInventory } = require('./shopStore');

            const targetRaw = String(interaction.fields.getTextInputValue('target') || '').trim();
            const percentRaw = String(interaction.fields.getTextInputValue('percent') || '').trim();
            const targetId = extractId(targetRaw);
            const percent = Math.floor(Number(percentRaw) || 0);

            if (!targetId) {
                return interaction.reply({ content: 'اسفة بس اكتبي User ID أو منشن صح 3:', ephemeral: true });
            }
            if (targetId === interaction.user.id) {
                return interaction.reply({ content: 'اسفة بس ما ينفع تنقل XP لنفسك >:', ephemeral: true });
            }
            if (percent < 5 || percent > 50) {
                return interaction.reply({ content: 'اسفة بس النسبة لازم تكون بين 5 و 50 3:', ephemeral: true });
            }

            const inv = getUserInventory(interaction.guild.id, interaction.user.id);
            const count = inv.services && typeof inv.services.xpTransfer === 'number' ? inv.services.xpTransfer : 0;
            if (!inv.services || count <= 0) {
                return interaction.reply({ content: 'اسفة بس ما عندك خدمة نقل XP ضمن ممتلكاتك 3:', ephemeral: true });
            }

            let targetMember;
            try {
                targetMember = await interaction.guild.members.fetch(targetId);
            } catch {
                targetMember = null;
            }
            if (!targetMember || targetMember.user.bot) {
                return interaction.reply({ content: 'اسفة بس ما قدرت ألاقي هالعضو بالسيرفر 3:', ephemeral: true });
            }

            const senderBefore = getUserStats(interaction.guild.id, interaction.user.id);
            const senderXp = Math.max(0, Math.floor(Number(senderBefore.xp) || 0));
            const toTransfer = Math.max(0, Math.floor(senderXp * (percent / 100)));
            if (toTransfer <= 0) {
                return interaction.reply({ content: 'XP الحالي عندك قليل وما فيه شيء يننقل.', ephemeral: true });
            }

            // Deduct from sender
            updateUserStats(interaction.guild.id, interaction.user.id, (s) => {
                const next = { ...s };
                next.xp = Math.max(0, (typeof next.xp === 'number' ? next.xp : 0) - toTransfer);
                return next;
            });

            // Add to target (and process level-ups for target)
            const targetInv = getUserInventory(interaction.guild.id, targetId);
            const xpCfg = getGuildConfig(interaction.guild.id);
            const tgtRoles = targetMember ? [...targetMember.roles.cache.keys()] : [];
            const tgtRoleBoosts = Array.isArray(xpCfg.roleBoosts) ? xpCfg.roleBoosts : [];
            const tgtRunes = Array.isArray(targetInv.runes) ? targetInv.runes : [];
            const tgtEquippedIds = Array.isArray(targetInv.equippedRuneIds) ? targetInv.equippedRuneIds : [];
            const tgtEquippedRunes = tgtRunes.filter((r) => r && tgtEquippedIds.includes(r.id));
            const tgtLunaMult =
                getActiveLunaMultiplier(targetInv) * getRoleBoostMultiplier(tgtRoles, tgtRoleBoosts, 'luna_boost') * getEquippedRuneMultiplier(tgtEquippedRunes, 'luna_boost');
            const tgtLevelupMult =
                getActiveLevelUpRewardMultiplier(targetInv) * getRoleBoostMultiplier(tgtRoles, tgtRoleBoosts, 'levelup_reward_boost') * getEquippedRuneMultiplier(tgtEquippedRunes, 'levelup_reward_boost');

            const xpResult = processXpGain(interaction.guild.id, targetId, toTransfer, {
                lunaMult: tgtLunaMult,
                levelUpRewardMult: tgtLevelupMult
            });
            const targetAfter = xpResult.after;
            const gainedLuna = xpResult.lunaGained;

            updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
                const next = { ...cur };
                next.services = next.services && typeof next.services === 'object'
                    ? { ...next.services }
                    : { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0 };
                next.services.xpTransfer = typeof next.services.xpTransfer === 'number' ? next.services.xpTransfer : 0;
                next.services.xpTransfer = Math.max(0, next.services.xpTransfer - 1);
                return next;
            });

            const bonusLines = [...xpResult.milestoneLines, ...xpResult.rewardLines, ...xpResult.runeLines];
            const lvlUpText = gainedLuna > 0
                ? `\n🎉 ورفع لمستوى **${targetAfter.level}** (+${gainedLuna} Luna Points).`
                : '';
            const bonusText = bonusLines.length > 0 ? '\n' + bonusLines.join('\n') : '';

            return interaction.reply({
                content: `✅ تم نقل **${toTransfer} XP** إلى ${targetMember}.${lvlUpText}${bonusText}`,
                ephemeral: true
            });
        }

        if (interaction.isModalSubmit() && interaction.customId === 'rebalanceModal:rebalance') {
            if (!interaction.guild) return;

            const { updateUserStats, spendLunaPoints } = require('./levelsStore');
            const { getUserInventory, updateUserInventory } = require('./shopStore');

            const confirm = String(interaction.fields.getTextInputValue('confirm') || '').trim().toLowerCase();
            if (confirm !== 'confirm') {
                return interaction.reply({ content: 'تم الإلغاء. اكتب CONFIRM لتأكيد العملية.', ephemeral: true });
            }

            const inv = getUserInventory(interaction.guild.id, interaction.user.id);
            const count = inv.services && typeof inv.services.rebalance === 'number' ? inv.services.rebalance : 0;
            if (!inv.services || count <= 0) {
                return interaction.reply({ content: 'اسفة بس ما عندك إعادة توازن ضمن ممتلكاتك 3:', ephemeral: true });
            }

            const hasShield = inv.services && typeof inv.services.shield === 'number' ? inv.services.shield > 0 : false;
            const penalty = hasShield ? 15 : 50;

            const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, penalty);
            if (!spend.ok) {
                return interaction.reply({ content: `اسفة بس لازم يكون عندك **${penalty}** Luna Points عشان تسوي إعادة التوازن 3:`, ephemeral: true });
            }

            updateUserStats(interaction.guild.id, interaction.user.id, (s) => {
                const next = { ...s };
                next.xp = 0;
                return next;
            });

            updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
                const next = { ...cur };
                next.services = next.services && typeof next.services === 'object'
                    ? { ...next.services }
                    : { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0 };
                next.services.rebalance = typeof next.services.rebalance === 'number' ? next.services.rebalance : 0;
                next.services.rebalance = Math.max(0, next.services.rebalance - 1);
                if (hasShield) {
                    next.services.shield = typeof next.services.shield === 'number' ? next.services.shield : 0;
                    next.services.shield = Math.max(0, next.services.shield - 1);
                }
                return next;
            });

            const shieldTxt = hasShield ? ' (تم استخدام درع الحماية 🛡️)' : '';
            return interaction.reply({
                content: `✅ تمت إعادة التوازن: تم تصفير XP وخصم **${penalty}** Luna Points.${shieldTxt}`,
                ephemeral: true
            });
        }

        if (interaction.isButton() && interaction.customId.startsWith('replies:')) {
            if (!interaction.guild) {
                return interaction.reply({ content: 'اسفة بس هالخيار بس بالسيرفر 3:', ephemeral: true });
            }

            if (!interaction.memberPermissions || !interaction.memberPermissions.has('ManageGuild')) {
                return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
            }

            const action = interaction.customId.split(':')[1];
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

            if (action === 'add') {
                const modal = new ModalBuilder()
                    .setCustomId('repliesModal:add')
                    .setTitle('إضافة رد تلقائي');

                const trigger = new TextInputBuilder()
                    .setCustomId('trigger')
                    .setLabel('المحفّز (Trigger)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const response = new TextInputBuilder()
                    .setCustomId('response')
                    .setLabel('الرد')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                const mode = new TextInputBuilder()
                    .setCustomId('mode')
                    .setLabel('الوضع: exact أو includes')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue('exact');

                const allow = new TextInputBuilder()
                    .setCustomId('allow')
                    .setLabel('مسموح لـ (اختياري): منشن/IDs/رتب')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('مثال: @User أو @Role أو 123...')

                modal.addComponents(
                    new ActionRowBuilder().addComponents(trigger),
                    new ActionRowBuilder().addComponents(response),
                    new ActionRowBuilder().addComponents(mode),
                    new ActionRowBuilder().addComponents(allow)
                );

                try {
                    return await interaction.showModal(modal);
                } catch {
                    try {
                        return await interaction.reply({
                            content: 'اسفة بس انتهت صلاحية القائمة… شغّل `/replies` مرة ثانية 3:',
                            ephemeral: true
                        });
                    } catch {
                        return;
                    }
                }
            }

            if (action === 'channel') {
                const cfg = getGuildConfig(interaction.guild.id);
                const list = Array.isArray(cfg.channelAutoReplies) ? cfg.channelAutoReplies : [];
                const editId = interaction.customId.split(':')[2] || null;
                const existing = editId ? list.find((r) => r && String(r.id) === String(editId)) : null;
                const car = existing || {};
                const embedCfg = car.embed && typeof car.embed === 'object' ? car.embed : {};

                const modal = new ModalBuilder()
                    .setCustomId(existing ? `repliesModal:channel:${encodeURIComponent(existing.id)}` : 'repliesModal:channel')
                    .setTitle(existing ? 'تعديل رد روم (Embed)' : 'إضافة رد روم (Embed)');

                const channelId = new TextInputBuilder()
                    .setCustomId('channelId')
                    .setLabel('Channel ID (أو none للإيقاف)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(typeof car.channelId === 'string' ? String(car.channelId).slice(0, 100) : '');

                const title = new TextInputBuilder()
                    .setCustomId('title')
                    .setLabel('عنوان الإيمبد (اختياري)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(typeof embedCfg.title === 'string' ? embedCfg.title.slice(0, 100) : '');

                const description = new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('الوصف')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue(typeof embedCfg.description === 'string' ? embedCfg.description.slice(0, 1000) : '');

                const color = new TextInputBuilder()
                    .setCustomId('color')
                    .setLabel('لون HEX مثال: #E7D3B0')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(typeof embedCfg.color === 'string' ? embedCfg.color.slice(0, 20) : '#E7D3B0');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(channelId),
                    new ActionRowBuilder().addComponents(title),
                    new ActionRowBuilder().addComponents(description),
                    new ActionRowBuilder().addComponents(color)
                );

                try {
                    return await interaction.showModal(modal);
                } catch {
                    try {
                        return await interaction.reply({
                            content: 'اسفة بس انتهت صلاحية القائمة… شغّل `/replies` مرة ثانية 3:',
                            ephemeral: true
                        });
                    } catch {
                        return;
                    }
                }
            }

            if (action === 'chanlist') {
                const cfgCh = getGuildConfig(interaction.guild.id);
                const chans = Array.isArray(cfgCh.channelAutoReplies) ? cfgCh.channelAutoReplies : [];
                if (!chans.length) {
                    return interaction.reply({ content: 'ما في ردود روم مضافة بعد. اضغط «إضافة رد روم (Embed)».', ephemeral: true });
                }
                const { EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
                const lines = chans.slice(0, 25).map((r, i) => {
                    const title = r.embed && typeof r.embed.title === 'string' && r.embed.title.trim()
                        ? r.embed.title.trim().slice(0, 60)
                        : 'بدون عنوان';
                    return `**${i + 1}.** <#${r.channelId}> — ${title}`;
                });
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('📺 ردود الروم')
                    .setDescription(lines.join('\n').slice(0, 4000))
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('repliesSelect:chan')
                        .setPlaceholder('اختار رد روم عشان تعدله أو تحذفه...')
                        .addOptions(
                            chans.slice(0, 25).map((r) => ({
                                label: `#${r.channelId}`.slice(0, 100),
                                description: (r.embed && typeof r.embed.title === 'string' && r.embed.title.trim()
                                    ? r.embed.title.trim().slice(0, 100)
                                    : 'بدون عنوان'),
                                value: String(r.id)
                            }))
                        )
                );
                return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            }

            const cfg = getGuildConfig(interaction.guild.id);
            const list = Array.isArray(cfg.autoReplies) ? cfg.autoReplies : [];

            if (list.length === 0) {
                return interaction.reply({ content: 'لا يوجد ردود تلقائية مضافة حاليًا.', ephemeral: true });
            }

            const options = list.slice(0, 25).map((r) => ({
                label: (r.trigger || '').slice(0, 100) || '(empty)',
                description: ((r.mode || 'exact') + ' -> ' + (r.response || '')).slice(0, 100),
                value: r.trigger
            }));

            if (action === 'remove') {
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('repliesSelect:remove')
                        .setPlaceholder('اختار محفّز')
                        .addOptions(options)
                );

                return interaction.reply({
                    content: 'حذف رد تلقائي\nاختار المحفّز الذي تريد حذفه.',
                    components: [row],
                    ephemeral: true
                });
            }

            if (action === 'edit') {
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('repliesSelect:edit')
                        .setPlaceholder('اختار محفّز')
                        .addOptions(options)
                );

                return interaction.reply({
                    content: 'تعديل رد تلقائي\nاختار المحفّز الذي تريد تعديله.',
                    components: [row],
                    ephemeral: true
                });
            }

            // List all replies
            if (action === 'list') {
                const { EmbedBuilder } = require('discord.js');
                const listText = list.map((r, i) => `**${i + 1}.** \`${r.trigger}\` → ${r.response?.slice(0, 50) || ''}`).join('\n');
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('📋 قائمة الردود التلقائية')
                    .setDescription(listText.slice(0, 4000) || 'لا توجد ردود')
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Clear all replies
            if (action === 'clear') {
                updateGuildConfig(interaction.guild.id, (c) => ({ ...c, autoReplies: [] }));
                return interaction.reply({ content: '✅ تم حذف جميع الردود التلقائية.', ephemeral: true });
            }

            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('repliesChan:')) {
            if (!interaction.guild) return;

            if (!interaction.memberPermissions || !interaction.memberPermissions.has('ManageGuild')) {
                return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
            }

            const parts = interaction.customId.split(':');
            const action = parts[1] || '';

            if (action === 'cancel') {
                try {
                    return await interaction.update({ content: 'تم الإلغاء.', embeds: [], components: [] });
                } catch {
                    return;
                }
            }

            const id = parts[2] ? decodeURIComponent(parts[2]) : '';
            const cfg = getGuildConfig(interaction.guild.id);
            const chans = Array.isArray(cfg.channelAutoReplies) ? cfg.channelAutoReplies : [];
            const entry = chans.find((r) => r && String(r.id) === String(id));
            if (!entry) {
                return interaction.reply({ content: 'اسفة بس رد الروم هذا ما عاد موجود 3:', ephemeral: true });
            }

            if (action === 'edit') {
                const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                const e = entry.embed && typeof entry.embed === 'object' ? entry.embed : {};
                const modal = new ModalBuilder()
                    .setCustomId(`repliesModal:channel:${encodeURIComponent(entry.id)}`)
                    .setTitle('تعديل رد روم (Embed)');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('channelId')
                            .setLabel('Channel ID (أو none للحذف)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setValue(String(entry.channelId || ''))
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('title')
                            .setLabel('عنوان الإيمبد (اختياري)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setValue(typeof e.title === 'string' ? e.title.slice(0, 100) : '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('description')
                            .setLabel('الوصف')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                            .setValue(typeof e.description === 'string' ? e.description.slice(0, 1000) : '')
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('color')
                            .setLabel('لون HEX مثال: #E7D3B0')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setValue(typeof e.color === 'string' ? e.color.slice(0, 20) : '#E7D3B0')
                    )
                );
                try {
                    return await interaction.showModal(modal);
                } catch {
                    return;
                }
            }

            if (action === 'delete') {
                updateGuildConfig(interaction.guild.id, (c) => ({
                    ...c,
                    channelAutoReplies: (Array.isArray(c.channelAutoReplies) ? c.channelAutoReplies : []).filter(
                        (r) => !(r && String(r.id) === String(entry.id))
                    )
                }));

                // Remove the embed(s) it posted so no orphan stays behind.
                const channel = interaction.guild.channels.cache.get(String(entry.channelId));
                if (channel && typeof channel.messages?.fetch === 'function') {
                    for (const mid of Array.isArray(entry.lastMessageIds) ? entry.lastMessageIds : []) {
                        await channel.messages.delete(String(mid)).catch(() => null);
                    }
                }

                try {
                    return await interaction.update({ content: `✅ تم حذف رد الروم في <#${entry.channelId}>.`, embeds: [], components: [] });
                } catch {
                    return interaction.reply({ content: `✅ تم حذف رد الروم في <#${entry.channelId}>.`, ephemeral: true });
                }
            }

            return;
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('repliesSelect:')) {
            if (!interaction.guild) return;

            if (!interaction.memberPermissions || !interaction.memberPermissions.has('ManageGuild')) {
                return interaction.reply({ content: 'اسفة بس ما عندك صلاحية عشان تستعمل هاد الامر p:' });
            }

            const mode = interaction.customId.split(':')[1];
            const selectedTrigger = interaction.values && interaction.values[0] ? interaction.values[0] : '';

            // Channel embed management card.
            if (mode === 'chan') {
                const { EmbedBuilder } = require('discord.js');
                const cfgChan = getGuildConfig(interaction.guild.id);
                const chans = Array.isArray(cfgChan.channelAutoReplies) ? cfgChan.channelAutoReplies : [];
                const entry = chans.find((r) => r && String(r.id) === String(selectedTrigger));
                if (!entry) {
                    return interaction.reply({ content: 'اسفة بس رد الروم هذا ما عاد موجود 3:', ephemeral: true });
                }
                const e = entry.embed && typeof entry.embed === 'object' ? entry.embed : {};
                const embed = new EmbedBuilder()
                    .setColor(typeof e.color === 'string' ? e.color : '#E7D3B0')
                    .setTitle((e.title || 'بدون عنوان').slice(0, 256))
                    .setDescription((e.description || '*بدون وصف*').slice(0, 4000))
                    .setFooter({ text: `#${entry.channelId}` })
                    .setTimestamp();
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`repliesChan:edit:${entry.id}`)
                        .setLabel('تعديل')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('✏️'),
                    new ButtonBuilder()
                        .setCustomId(`repliesChan:delete:${entry.id}`)
                        .setLabel('حذف')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🗑️'),
                    new ButtonBuilder()
                        .setCustomId('repliesChan:cancel')
                        .setLabel('إلغاء')
                        .setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            }

            const cfg = getGuildConfig(interaction.guild.id);
            const list = Array.isArray(cfg.autoReplies) ? cfg.autoReplies : [];
            const rule = list.find(r => r && typeof r.trigger === 'string' && r.trigger === selectedTrigger);

            if (!rule) {
                return interaction.reply({ content: 'اسفة بس هالرد ما عاد موجود 3:' });
            }

            if (mode === 'remove') {
                updateGuildConfig(interaction.guild.id, (c) => {
                    const next = { ...c };
                    next.autoReplies = Array.isArray(next.autoReplies)
                        ? next.autoReplies.filter(r => !(r && typeof r.trigger === 'string' && r.trigger === selectedTrigger))
                        : [];
                    return next;
                });

                try {
                    return await interaction.update({ content: `تم حذف الرد التلقائي للمحفّز: **${selectedTrigger}**`, embeds: [], components: [] });
                } catch {
                    try {
                        return await interaction.reply({
                            content: 'اسفة بس انتهت صلاحية القائمة… شغّل `/replies` مرة ثانية 3:',
                        });
                    } catch {
                        return;
                    }
                }
            }

            if (mode === 'edit') {
                const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
                const modal = new ModalBuilder()
                    .setCustomId(`repliesModal:edit:${encodeURIComponent(selectedTrigger)}`)
                    .setTitle('تعديل رد تلقائي');

                const trigger = new TextInputBuilder()
                    .setCustomId('trigger')
                    .setLabel('المحفّز (Trigger)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(rule.trigger);

                const response = new TextInputBuilder()
                    .setCustomId('response')
                    .setLabel('الرد')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setValue(rule.response || '');

                const m = new TextInputBuilder()
                    .setCustomId('mode')
                    .setLabel('الوضع: exact أو includes')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(rule.mode || 'exact');

                const allow = new TextInputBuilder()
                    .setCustomId('allow')
                    .setLabel('مسموح لـ (اختياري): منشن/IDs/رتب')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setValue(
                        [
                            ...(Array.isArray(rule.allowUserIds) ? rule.allowUserIds.map((id) => `<@${id}>`) : []),
                            ...(Array.isArray(rule.allowRoleIds) ? rule.allowRoleIds.map((id) => `<@&${id}>`) : [])
                        ].join(' ').slice(0, 100)
                    );

                modal.addComponents(
                    new ActionRowBuilder().addComponents(trigger),
                    new ActionRowBuilder().addComponents(response),
                    new ActionRowBuilder().addComponents(m),
                    new ActionRowBuilder().addComponents(allow)
                );

                try {
                    return await interaction.showModal(modal);
                } catch {
                    try {
                        return await interaction.reply({
                            content: 'اسفة بس انتهت صلاحية القائمة… شغّل `/replies` مرة ثانية وحاولي بسرعة 3:',
                        });
                    } catch {
                        return;
                    }
                }
            }
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('repliesModal:')) {
            if (!interaction.guild) return;

            if (!interaction.memberPermissions || !interaction.memberPermissions.has('ManageGuild')) {
                return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
            }

            const parts = interaction.customId.split(':');
            const modalType = parts[1];
            const prevTrigger = parts[2] ? decodeURIComponent(parts[2]) : null;

            if (modalType === 'channel') {
                const channelIdRaw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
                const title = String(interaction.fields.getTextInputValue('title') || '').trim();
                const description = String(interaction.fields.getTextInputValue('description') || '');
                const colorRaw = String(interaction.fields.getTextInputValue('color') || '').trim();

                const normalized = channelIdRaw.replace(/[<#>]/g, '').trim();
                const channelId = (!normalized || normalized.toLowerCase() === 'none' || normalized === '0')
                    ? null
                    : (/^\d{15,20}$/.test(normalized) ? normalized : null);
                if (channelIdRaw && !channelId && !['none', '0'].includes(normalized.toLowerCase())) {
                    return interaction.reply({ content: 'ايدي الروم غير صحيح. مثال: 123456789012345678', ephemeral: true });
                }
                if (channelId) {
                    const ch = interaction.guild.channels.cache.get(channelId);
                    if (!ch) {
                        return interaction.reply({ content: 'ما لقيت هالروم بالسيرفر 3:', ephemeral: true });
                    }
                }
                const color = /^#?[0-9a-fA-F]{6}$/.test(colorRaw)
                    ? (colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`)
                    : '#E7D3B0';

                const cfgNow = getGuildConfig(interaction.guild.id);
                const list = Array.isArray(cfgNow.channelAutoReplies)
                    ? cfgNow.channelAutoReplies.map((r) => ({ ...r }))
                    : [];
                const editId = prevTrigger || null;
                const idx = editId ? list.findIndex((r) => r && String(r.id) === String(editId)) : -1;

                const deletePosted = async (entry) => {
                    const ch = interaction.guild.channels.cache.get(String(entry.channelId));
                    if (!ch || typeof ch.messages?.fetch !== 'function') return;
                    for (const mid of Array.isArray(entry.lastMessageIds) ? entry.lastMessageIds : []) {
                        await ch.messages.delete(String(mid)).catch(() => null);
                    }
                };

                // `none` removes an existing entry.
                if (!channelId) {
                    if (idx < 0) {
                        return interaction.reply({ content: 'ما في رد روم محدد عشان ينحذف.', ephemeral: true });
                    }
                    const [removed] = list.splice(idx, 1);
                    updateGuildConfig(interaction.guild.id, (c) => ({ ...c, channelAutoReplies: list }));
                    await deletePosted(removed);
                    return interaction.reply({ content: `✅ تم حذف رد الروم في <#${removed.channelId}>.`, ephemeral: true });
                }

                if (idx < 0 && list.length >= 25) {
                    return interaction.reply({ content: 'وصلت الحد الأقصى (25) لردود الروم 3:', ephemeral: true });
                }

                const entry = idx >= 0
                    ? { ...list[idx] }
                    : { id: `car_${Math.random().toString(36).slice(2, 10)}`, channelId, embed: {}, lastMessageIds: [] };

                const movedChannel = String(entry.channelId) !== String(channelId);
                if (movedChannel) {
                    // The old channel keeps an orphan otherwise.
                    await deletePosted(entry);
                    entry.lastMessageIds = [];
                }

                entry.channelId = channelId;
                entry.embed = { title, description, color };

                if (idx >= 0) list[idx] = entry;
                else list.push(entry);

                updateGuildConfig(interaction.guild.id, (c) => ({ ...c, channelAutoReplies: list }));

                return interaction.reply({
                    content: idx >= 0
                        ? `✅ تم تحديث رد الروم: <#${channelId}>`
                        : `✅ تمت إضافة رد الروم: <#${channelId}>`,
                    ephemeral: true
                });
            }

            const trigger = (interaction.fields.getTextInputValue('trigger') || '').trim();
            const response = interaction.fields.getTextInputValue('response') || '';
            const modeInput = (interaction.fields.getTextInputValue('mode') || 'exact').trim().toLowerCase();
            const mode = modeInput === 'includes' ? 'includes' : 'exact';
            const allowRaw = (() => {
                try { return interaction.fields.getTextInputValue('allow'); } catch { return ''; }
            })();
            const parsedAllow = parseAllowTargets(allowRaw);

            if (!trigger) {
                return interaction.reply({ content: 'اسفة بس المحفّز ما ينفع يكون فاضي 3:', ephemeral: true });
            }

            updateGuildConfig(interaction.guild.id, (cfg) => {
                const next = { ...cfg };
                let list = Array.isArray(next.autoReplies) ? [...next.autoReplies] : [];

                if (modalType === 'edit' && prevTrigger) {
                    list = list.filter(r => !(r && typeof r.trigger === 'string' && r.trigger === prevTrigger));
                }

                const existingIdx = list.findIndex(r => r && typeof r.trigger === 'string' && r.trigger.toLowerCase() === trigger.toLowerCase());
                const entry = { trigger, response, mode, allowUserIds: parsedAllow.allowUserIds, allowRoleIds: parsedAllow.allowRoleIds };
                if (existingIdx >= 0) list[existingIdx] = entry;
                else list.push(entry);
                next.autoReplies = list;
                return next;
            });

            if (modalType === 'add') {
                return interaction.reply({ content: `تمت إضافة رد تلقائي للمحفّز: **${trigger}**`, ephemeral: true });
            }

            return interaction.reply({ content: `تم تحديث الرد التلقائي. المحفّز: **${trigger}**`, ephemeral: true });
        }

        if (interaction.isButton()) {
            return;
        }

        if (interaction.isStringSelectMenu() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musicfile:')) {
            if (!interaction.guild) return;

            const fs = require('fs');
            const path = require('path');
            const { EmbedBuilder } = require('discord.js');

            await deferUpdateSafe(interaction);

            try {
                const parts = interaction.customId.split(':');
                const catKey = parts[1] ? String(parts[1]) : null;
                const ownerId = parts[2] ? String(parts[2]) : null;

                if (ownerId && String(interaction.user.id) !== ownerId) {
                    return replyEphemeral(interaction, { content: 'اسفة بس هالقائمة لصاحب الأمر بس 3:' });
                }

                const selectionRaw = interaction.values && interaction.values[0] ? String(interaction.values[0]) : null;
                if (!selectionRaw) {
                    return replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أحدد اختيارك 3:' });
                }

                const catMap = {
                    anashid: { title: 'اناشيد', folder: 'اناشيد' },
                    halal: { title: 'موسيقى حلال', folder: 'موسيقى حلال' },
                    quran: { title: 'قران', folder: 'قران' },
                    shiir: { title: 'شعر', folder: 'شعر' }
                };
                const cat = catKey && catMap[catKey] ? catMap[catKey] : null;
                if (!cat) {
                    return replyEphemeral(interaction, { content: 'اسفة بس ما قدرت أحدد النوع 3:' });
                }

                const voice = interaction.member && interaction.member.voice ? interaction.member.voice : null;
                const channel = voice && voice.channel ? voice.channel : null;
                if (!channel) {
                    return replyEphemeral(interaction, { content: 'ادخل فويس أول وبعدين اختار المقطع 3:' });
                }

                const cached = getPlayBrowseCache(interaction.guild.id, ownerId || interaction.user.id, catKey);
                const valueToName = cached && cached.valueToName ? cached.valueToName : null;
                const selection = valueToName ? valueToName.get(selectionRaw) : null;
                if (!selection) {
                    return replyEphemeral(interaction, { content: 'اسفة بس القائمة انتهت صلاحيتها… اضغط رجوع واختر القسم من جديد 3:' });
                }

                const baseDir = path.join(__dirname, '..', 'audio');
                const filePath = path.join(baseDir, cat.folder, selection);
                if (!fs.existsSync(filePath)) {
                    return replyEphemeral(interaction, { content: 'اسفة بس الملف هذا مو موجود (يمكن انحذف) 3:' });
                }

                const session = getOrCreateVoiceSession(interaction.guild.id);
                const isPlaying = !!(session.player && session.player.state && session.player.state.status && session.player.state.status !== 'idle');
                // If anything is playing OR paused, queue instead of replacing the track
                const hasActiveTrack = isPlaying || !!session.paused;
                if (hasActiveTrack) {
                    session.queue = Array.isArray(session.queue) ? session.queue : [];
                    session.queue.push({ filePath, displayName: selection, requestedBy: interaction.user.id });
                    const embed = UI.embed({
                        title: 'تمت الإضافة',
                        color: UI.COLORS.music,
                        description: `تمت إضافة المقطع للقائمة 3=\n\nالملف: **${selection}**\nالمركز: **${session.queue.length}**`
                    });
                    try {
                        return interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
                    } catch {
                        return;
                    }
                }

                try {
                    await startPlaybackFromFile(interaction, filePath, selection);
                } catch {
                    // ignore
                }

                const embed = UI.embed({
                    title: 'تم التشغيل',
                    color: UI.COLORS.music,
                    description: `الملف: **${selection}**\n\nالتكرار: **${(session.repeatMode || 'off') === 'one' ? '🔁 مقطع واحد' : (session.repeatMode === 'all' ? '🔂 كل القائمة' : 'مطفى')}**\nالتشغيل التلقائي: **${session.autoplayShuffle ? 'مفعل' : 'مطفى'}**`
                });

                try {
                    return interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            } catch (err) {
                logError('playfile handler failed', err);
                return replyEphemeral(interaction, { content: 'آسف ما قدرت أشغّل المقطع… تأكد إن عندي صلاحيات Connect/Speak وبإن الملف صوتي صحيح 3:' });
            }
        }

        if (interaction.isStringSelectMenu()) {
            return;
        }

        if (interaction.isModalSubmit() && typeof interaction.customId === 'string' && interaction.customId.startsWith('musicModal:volume:')) {
            if (!interaction.guild) return;

            const { MessageFlags } = require('discord.js');
            const ownerId = String(interaction.customId.split(':')[2] || '');
            if (ownerId && String(interaction.user.id) !== ownerId) {
                try {
                    return interaction.reply({ content: 'اسفة بس هالنافذة لصاحب الأمر بس 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const raw = String(interaction.fields.getTextInputValue('percent') || '').trim();
            const pct = Math.floor(Number(raw));
            if (!Number.isFinite(pct) || pct < 0 || pct > 200) {
                try {
                    return interaction.reply({ content: 'اكتبي نسبة بين **0** و **200** 3:', flags: MessageFlags.Ephemeral });
                } catch {
                    return;
                }
            }

            const session = getOrCreateVoiceSession(interaction.guild.id);
            session.volume = clampNumber(pct / 100, 0, 2);
            try {
                if (session.currentResource && session.currentResource.volume) {
                    session.currentResource.volume.setVolume(session.volume);
                }
            } catch {
                // ignore
            }

            try {
                return interaction.reply({ content: `تم ضبط الصوت إلى **${pct}%** 3:`, flags: MessageFlags.Ephemeral });
            } catch {
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            return;
        }
    } catch (error) {
        console.error(error);
        try {
            if (interaction && (interaction.deferred || interaction.replied)) {
                return await interaction.followUp({ content: 'اسفة بس لقيت مشكلة وانا محاول سوي اللي بدك ياه >:', flags: MessageFlags.Ephemeral });
            }
            return await interaction.reply({ content: 'اسفة بس لقيت مشكلة وانا محاول سوي اللي بدك ياه >:', flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    } finally {
        try {
            if (autoDeferTimer) clearTimeout(autoDeferTimer);
        } catch {
            // ignore
        }
    }
});

client.on('messageDelete', async (message) => {
    try {
        if (!message || !message.guild) return;
        if (message.author && message.author.bot) return;

        const { EmbedBuilder } = require('discord.js');
        const author = message.author ? `${message.author}` : 'غير معروف';
        const content = String(message.content || '').trim();

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🗑️ حذف رسالة')
            .setDescription(`الروم: <#${message.channel?.id || '0'}>\nالمرسل: ${author}`)
            .setTimestamp();

        if (content) {
            embed.addFields({ name: 'المحتوى', value: content.slice(0, 1024), inline: false });
        }

        const atts = message.attachments ? [...message.attachments.values()] : [];
        const urls = atts
            .map((a) => a && a.url ? String(a.url) : null)
            .filter(Boolean)
            .slice(0, 8);

        if (urls[0]) {
            embed.setImage(urls[0]);
        }

        const extra = urls.slice(1);
        const contentLinks = extra.length
            ? `||${extra.join('||\n||')}||`.slice(0, 1500)
            : undefined;

        const files = urls.slice(0, 3);

        await sendGuildLog(
            message.guild,
            { content: contentLinks, embeds: [embed], files: files.length ? files : undefined },
            { sourceChannelId: message.channel?.id || null, category: 'messages' }
        );
    } catch {
        // ignore
    }
});

client.on('messageUpdate', async (oldMsg, newMsg) => {
    try {
        const m = newMsg || oldMsg;
        if (!m || !m.guild) return;
        if (m.author && m.author.bot) return;

        const oldContent = String(oldMsg?.content || '').trim();
        const newContent = String(newMsg?.content || '').trim();
        if (oldContent === newContent) return;

        const { EmbedBuilder } = require('discord.js');
        const author = m.author ? `${m.author}` : 'غير معروف';
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('✏️ تعديل رسالة')
            .setDescription(`الروم: <#${m.channel?.id || '0'}>\nالمرسل: ${author}${m.url ? `\n\n🔗 ${m.url}` : ''}`)
            .addFields(
                { name: 'قبل', value: oldContent ? oldContent.slice(0, 1024) : '*فارغ*', inline: false },
                { name: 'بعد', value: newContent ? newContent.slice(0, 1024) : '*فارغ*', inline: false }
            )
            .setTimestamp();

        await sendGuildLog(m.guild, { embeds: [embed] }, { sourceChannelId: m.channel?.id || null, category: 'messages' });
    } catch {
        // ignore
    }
});

client.on('channelCreate', async (channel) => {
    try {
        if (!channel || !channel.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('📺 إنشاء روم')
            .setDescription(`الروم: <#${channel.id}> (${channel.type})` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(channel.guild, { embeds: [embed] }, { sourceChannelId: channel.id, category: 'channels' });
    } catch {
        // ignore
    }
});

client.on('channelDelete', async (channel) => {
    try {
        if (!channel || !channel.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🗑️ حذف روم')
            .setDescription(`الروم: #${channel.name || channel.id} (${channel.type})` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(channel.guild, { embeds: [embed] }, { sourceChannelId: channel.id, category: 'channels' });
    } catch {
        // ignore
    }
});

client.on('channelUpdate', async (oldCh, newCh) => {
    try {
        const ch = newCh || oldCh;
        if (!ch || !ch.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');

        const changes = [];
        if (oldCh && newCh) {
            if (String(oldCh.name || '') !== String(newCh.name || '')) changes.push(`الاسم: **${oldCh.name || '-'}** -> **${newCh.name || '-'}**`);
            if (String(oldCh.parentId || '') !== String(newCh.parentId || '')) changes.push(`التصنيف: <#${oldCh.parentId || '0'}> -> <#${newCh.parentId || '0'}>`);
            if (Number(oldCh.rateLimitPerUser || 0) !== Number(newCh.rateLimitPerUser || 0)) changes.push(`Slowmode: **${oldCh.rateLimitPerUser || 0}s** -> **${newCh.rateLimitPerUser || 0}s**`);

            const oldOw = oldCh.permissionOverwrites
                ? JSON.stringify(oldCh.permissionOverwrites.cache.map((o) => [o.id, o.allow?.bitfield || 0, o.deny?.bitfield || 0]))
                : '';
            const newOw = newCh.permissionOverwrites
                ? JSON.stringify(newCh.permissionOverwrites.cache.map((o) => [o.id, o.allow?.bitfield || 0, o.deny?.bitfield || 0]))
                : '';
            if (oldOw !== newOw) changes.push('الصلاحيات: **تم تغييرها**');
        }

        if (!changes.length) return;

        const executorTag = await tryGetAuditExecutorTag(ch.guild, AuditLogEvent.ChannelUpdate, ch.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('⚙️ تعديل روم')
            .setDescription(`الروم: <#${ch.id}> (${ch.type})` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .addFields({ name: 'التغييرات', value: changes.join('\n').slice(0, 1024), inline: false })
            .setTimestamp();
        await sendGuildLog(ch.guild, { embeds: [embed] }, { sourceChannelId: ch.id, category: 'channels' });

        try {
            const oldOws = oldCh && oldCh.permissionOverwrites && oldCh.permissionOverwrites.cache
                ? [...oldCh.permissionOverwrites.cache.values()]
                : [];
            const newOws = newCh && newCh.permissionOverwrites && newCh.permissionOverwrites.cache
                ? [...newCh.permissionOverwrites.cache.values()]
                : [];

            const oldMap = new Map(oldOws.map((o) => [String(o.id), o]));
            const newMap = new Map(newOws.map((o) => [String(o.id), o]));
            const touched = new Set([...oldMap.keys(), ...newMap.keys()]);
            const owChanges = [];

            for (const id of touched) {
                const a = oldMap.get(id);
                const b = newMap.get(id);
                const aAllow = a ? String(a.allow?.bitfield || '') : '';
                const aDeny = a ? String(a.deny?.bitfield || '') : '';
                const bAllow = b ? String(b.allow?.bitfield || '') : '';
                const bDeny = b ? String(b.deny?.bitfield || '') : '';
                if (!a && b) owChanges.push(`➕ overwrite جديد: <@&${id}>`);
                else if (a && !b) owChanges.push(`➖ overwrite انحذف: <@&${id}>`);
                else if (aAllow !== bAllow || aDeny !== bDeny) owChanges.push(`🔧 overwrite تغيّر: <@&${id}>`);
                if (owChanges.length >= 8) break;
            }

            if (owChanges.length) {
                const embedOw = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🔐 تعديل صلاحيات روم')
                    .setDescription(`الروم: <#${ch.id}>` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
                    .addFields({ name: 'ملخص', value: owChanges.join('\n').slice(0, 1024), inline: false })
                    .setTimestamp();
                await sendGuildLog(ch.guild, { embeds: [embedOw] }, { sourceChannelId: ch.id, category: 'channels' });
            }
        } catch {
            // ignore
        }
    } catch {
        // ignore
    }
});

client.on('userUpdate', async (oldUser, newUser) => {
    try {
        if (!oldUser || !newUser) return;
        if (String(oldUser.username || '') === String(newUser.username || '') && String(oldUser.avatar || '') === String(newUser.avatar || '')) return;

        const { EmbedBuilder } = require('discord.js');
        const changes = [];
        if (String(oldUser.username || '') !== String(newUser.username || '')) {
            changes.push(`الاسم: **${String(oldUser.username || '-').slice(0, 80)}** -> **${String(newUser.username || '-').slice(0, 80)}**`);
        }
        if (String(oldUser.avatar || '') !== String(newUser.avatar || '')) {
            changes.push('الصورة: **تم تغييرها**');
        }
        if (!changes.length) return;

        for (const [, guild] of client.guilds.cache) {
            try {
                const m = await guild.members.fetch(newUser.id).catch(() => null);
                if (!m) continue;
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('👤 تحديث حساب')
                    .setDescription(`العضو: ${newUser}`)
                    .addFields({ name: 'التغييرات', value: changes.join('\n').slice(0, 1024), inline: false })
                    .setTimestamp();
                await sendGuildLog(guild, { embeds: [embed] }, { category: 'guild' });
            } catch {
                // ignore
            }
        }
    } catch {
        // ignore
    }
});

client.on('roleCreate', async (role) => {
    try {
        if (!role || !role.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(role.guild, AuditLogEvent.RoleCreate, role.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🎭 إنشاء رتبة')
            .setDescription(`الرتبة: <@&${role.id}>` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(role.guild, { embeds: [embed] }, { category: 'roles' });
    } catch {
        // ignore
    }
});

client.on('roleDelete', async (role) => {
    try {
        if (!role || !role.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(role.guild, AuditLogEvent.RoleDelete, role.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🗑️ حذف رتبة')
            .setDescription(`الرتبة: ${role.name || role.id}` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(role.guild, { embeds: [embed] });
    } catch {
        // ignore
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    try {
        const r = newRole || oldRole;
        if (!r || !r.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const changes = [];
        if (oldRole && newRole) {
            if (String(oldRole.name || '') !== String(newRole.name || '')) changes.push(`الاسم: **${oldRole.name || '-'}** -> **${newRole.name || '-'}**`);
            if (String(oldRole.permissions?.bitfield || '') !== String(newRole.permissions?.bitfield || '')) changes.push('الصلاحيات: **تم تغييرها**');
            if (Boolean(oldRole.mentionable) !== Boolean(newRole.mentionable)) changes.push(`المنشن: **${oldRole.mentionable ? 'مفعل' : 'مقفل'}** -> **${newRole.mentionable ? 'مفعل' : 'مقفل'}**`);
            if (Number(oldRole.color) !== Number(newRole.color)) changes.push('اللون: **تم تغييره**');
        }

        if (!changes.length) return;

        try {
            const cfg = getGuildConfig(r.guild.id);
            const rgbId = cfg && cfg.rgbRole && typeof cfg.rgbRole === 'object' && cfg.rgbRole.roleId ? String(cfg.rgbRole.roleId) : null;
            const onlyColor = changes.length === 1 && changes[0].startsWith('اللون:');
            if (rgbId && String(r.id) === String(rgbId) && onlyColor) {
                return;
            }
        } catch {
            // ignore
        }

        const executorTag = await tryGetAuditExecutorTag(r.guild, AuditLogEvent.RoleUpdate, r.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('⚙️ تعديل رتبة')
            .setDescription(`الرتبة: <@&${r.id}>` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .addFields({ name: 'التغييرات', value: changes.join('\n').slice(0, 1024), inline: false })
            .setTimestamp();
        await sendGuildLog(r.guild, { embeds: [embed] }, { category: 'roles' });
    } catch {
        // ignore
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        if (!newMember || !newMember.guild) return;

        const { EmbedBuilder } = require('discord.js');
        const target = newMember.user ? `${newMember.user}` : `<@${newMember.id}>`;

        const oldTs = oldMember?.communicationDisabledUntilTimestamp || 0;
        const newTs = newMember?.communicationDisabledUntilTimestamp || 0;
        if (oldTs !== newTs) {
            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('⏳ تايم آوت')
                .setDescription(`العضو: ${target}`)
                .setTimestamp();

            if (newTs && (!oldTs || newTs > oldTs)) {
                embed.addFields({ name: 'الحالة', value: `تم وضع تايم آوت حتى: <t:${Math.floor(newTs / 1000)}:F>`, inline: false });
            } else {
                embed.addFields({ name: 'الحالة', value: 'تم إزالة التايم آوت ✅', inline: false });
            }

            await sendGuildLog(newMember.guild, { embeds: [embed] }, { category: 'moderation' });
        }

        const nickOld = oldMember ? (oldMember.nickname || oldMember.user?.username || '') : '';
        const nickNew = newMember.nickname || newMember.user?.username || '';
        if (String(nickOld || '') !== String(nickNew || '')) {
            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('📝 تغيير نك نيم')
                .setDescription(`العضو: ${target}`)
                .addFields({ name: 'التغيير', value: `**${String(nickOld || '-').slice(0, 80)}** -> **${String(nickNew || '-').slice(0, 80)}**`, inline: false })
                .setTimestamp();
            await sendGuildLog(newMember.guild, { embeds: [embed] }, { category: 'guild' });
        }

        try {
            const oldRoles = oldMember ? new Set((oldMember.roles?.cache ? [...oldMember.roles.cache.keys()] : []).map(String)) : new Set();
            const newRoles = new Set((newMember.roles?.cache ? [...newMember.roles.cache.keys()] : []).map(String));
            const added = [...newRoles].filter((id) => !oldRoles.has(id));
            const removed = [...oldRoles].filter((id) => !newRoles.has(id));
            const cleanAdded = added.filter((id) => id !== newMember.guild.id);
            const cleanRemoved = removed.filter((id) => id !== newMember.guild.id);
            if (cleanAdded.length || cleanRemoved.length) {
                const embed = new EmbedBuilder()
                    .setColor('#E7D3B0')
                    .setTitle('🎭 تغيير رولات عضو')
                    .setDescription(`العضو: ${target}`)
                    .setTimestamp();

                if (cleanAdded.length) embed.addFields({ name: 'تمت الإضافة', value: cleanAdded.slice(0, 15).map((id) => `<@&${id}>`).join(' '), inline: false });
                if (cleanRemoved.length) embed.addFields({ name: 'تمت الإزالة', value: cleanRemoved.slice(0, 15).map((id) => `<@&${id}>`).join(' '), inline: false });
                await sendGuildLog(newMember.guild, { embeds: [embed] }, { category: 'roles' });
            }
        } catch {
            // ignore
        }
    } catch {
        // ignore
    }
});

client.on('messageDeleteBulk', async (messages) => {
    try {
        const first = messages && messages.first ? messages.first() : null;
        const guild = first && first.guild ? first.guild : null;
        const channel = first && first.channel ? first.channel : null;
        if (!guild || !channel) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(guild, AuditLogEvent.MessageBulkDelete, channel.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🧹 حذف جماعي للرسائل')
            .setDescription(`الروم: <#${channel.id}>` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .addFields({ name: 'عدد الرسائل', value: `**${messages.size || 0}**`, inline: true })
            .setTimestamp();
        await sendGuildLog(guild, { embeds: [embed] }, { sourceChannelId: channel.id, category: 'messages' });
    } catch {
        // ignore
    }
});

client.on('inviteCreate', async (invite) => {
    try {
        const guild = invite && invite.guild ? invite.guild : null;
        if (!guild) return;
        try {
            const gId = String(guild.id);
            const m = inviteCache.get(gId) || new Map();
            if (invite && invite.code) {
                m.set(String(invite.code), {
                    uses: typeof invite.uses === 'number' ? invite.uses : 0,
                    inviterId: invite.inviter && invite.inviter.id ? String(invite.inviter.id) : null
                });
                inviteCache.set(gId, m);
            }
        } catch {
            // ignore
        }
        const { EmbedBuilder } = require('discord.js');
        const creator = invite.inviter ? `${invite.inviter}` : 'غير معروف';
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🔗 إنشاء إنفايت')
            .setDescription(`الروم: ${invite.channel ? `<#${invite.channel.id}>` : 'غير معروف'}\nبواسطة: ${creator}`)
            .addFields(
                { name: 'الكود', value: String(invite.code || '-').slice(0, 100), inline: true },
                { name: 'الحد الأقصى', value: invite.maxUses ? String(invite.maxUses) : '∞', inline: true }
            )
            .setTimestamp();
        await sendGuildLog(guild, { embeds: [embed] }, { category: 'guild' });
    } catch {
        // ignore
    }
});

client.on('inviteDelete', async (invite) => {
    try {
        const guild = invite && invite.guild ? invite.guild : null;
        if (!guild) return;
        try {
            const gId = String(guild.id);
            const m = inviteCache.get(gId) || new Map();
            if (invite && invite.code) {
                m.delete(String(invite.code));
                inviteCache.set(gId, m);
            }
        } catch {
            // ignore
        }
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🗑️ حذف إنفايت')
            .setDescription(`الكود: **${String(invite.code || '-').slice(0, 100)}**`)
            .setTimestamp();
        await sendGuildLog(guild, { embeds: [embed] }, { category: 'guild' });
    } catch {
        // ignore
    }
});

client.on('webhookUpdate', async (channel) => {
    try {
        if (!channel || !channel.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(channel.guild, AuditLogEvent.WebhookUpdate, channel.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🪝 تحديث ويبهوك')
            .setDescription(`الروم: <#${channel.id}>` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(channel.guild, { embeds: [embed] }, { sourceChannelId: channel.id, category: 'guild' });
    } catch {
        // ignore
    }
});

client.on('emojiCreate', async (emoji) => {
    try {
        if (!emoji || !emoji.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('😀 إنشاء ايموجي')
            .setDescription(`الاسم: **${emoji.name || emoji.id}**` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(emoji.guild, { embeds: [embed] }, { category: 'guild' });
    } catch {
        // ignore
    }
});

client.on('emojiDelete', async (emoji) => {
    try {
        if (!emoji || !emoji.guild) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🗑️ حذف ايموجي')
            .setDescription(`الاسم: **${emoji.name || emoji.id}**` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(emoji.guild, { embeds: [embed] }, { category: 'guild' });
    } catch {
        // ignore
    }
});

client.on('emojiUpdate', async (oldEmoji, newEmoji) => {
    try {
        const e = newEmoji || oldEmoji;
        if (!e || !e.guild) return;
        const oldName = oldEmoji ? oldEmoji.name : '';
        const newName = newEmoji ? newEmoji.name : '';
        if (String(oldName || '') === String(newName || '')) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(e.guild, AuditLogEvent.EmojiUpdate, e.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('✏️ تعديل ايموجي')
            .setDescription(`الايموجي: **${oldName || '-'}** -> **${newName || '-'}**` + (executorTag ? `\nبواسطة: ${executorTag}` : ''))
            .setTimestamp();
        await sendGuildLog(e.guild, { embeds: [embed] }, { category: 'guild' });
    } catch {
        // ignore
    }
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    try {
        const g = newGuild || oldGuild;
        if (!g) return;
        const changes = [];
        if (oldGuild && newGuild) {
            if (String(oldGuild.name || '') !== String(newGuild.name || '')) changes.push(`الاسم: **${oldGuild.name || '-'}** -> **${newGuild.name || '-'}**`);
        }
        if (!changes.length) return;
        const { AuditLogEvent, EmbedBuilder } = require('discord.js');
        const executorTag = await tryGetAuditExecutorTag(g, AuditLogEvent.GuildUpdate, g.id);
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🏠 تعديل إعدادات السيرفر')
            .setDescription(executorTag ? `بواسطة: ${executorTag}` : '')
            .addFields({ name: 'التغييرات', value: changes.join('\n').slice(0, 1024), inline: false })
            .setTimestamp();
        await sendGuildLog(g, { embeds: [embed] }, { category: 'guild' });
    } catch {
        // ignore
    }
});

client.on('guildBanAdd', async (ban) => {
    try {
        const guild = ban && ban.guild ? ban.guild : null;
        if (!guild) return;
        const user = ban.user;
        const reason = String(ban.reason || '').trim();

        let executorTag = null;
        try {
            const { AuditLogEvent, PermissionsBitField } = require('discord.js');
            const me = guild.members.me;
            const can = me && guild.members.me.permissions && guild.members.me.permissions.has
                ? guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)
                : (me ? me.permissions.has(PermissionsBitField.Flags.ViewAuditLog) : false);
            if (can) {
                const logs = await guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
                const entry = logs && logs.entries ? [...logs.entries.values()].find((e) => String(e.target?.id || '') === String(user?.id || '')) : null;
                if (entry && entry.executor) executorTag = `${entry.executor}`;
            }
        } catch {
            executorTag = null;
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('⛔ Ban')
            .setDescription(
                `تم حظر: ${user ? `${user}` : 'عضو غير معروف'}` +
                (executorTag ? `\nبواسطة: ${executorTag}` : '')
            )
            .setTimestamp();

        if (reason) {
            embed.addFields({ name: 'السبب', value: reason.slice(0, 1024), inline: false });
        }

        await sendGuildLog(guild, { embeds: [embed] }, { category: 'moderation' });
    } catch {
        // ignore
    }
});

client.on('guildBanRemove', async (ban) => {
    try {
        const guild = ban && ban.guild ? ban.guild : null;
        if (!guild) return;
        const user = ban.user;

        let executorTag = null;
        try {
            const { AuditLogEvent, PermissionsBitField } = require('discord.js');
            const me = guild.members.me;
            const can = me && guild.members.me.permissions && guild.members.me.permissions.has
                ? guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)
                : (me ? me.permissions.has(PermissionsBitField.Flags.ViewAuditLog) : false);
            if (can) {
                const logs = await guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberBanRemove }).catch(() => null);
                const entry = logs && logs.entries ? [...logs.entries.values()].find((e) => String(e.target?.id || '') === String(user?.id || '')) : null;
                if (entry && entry.executor) executorTag = `${entry.executor}`;
            }
        } catch {
            executorTag = null;
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('✅ Unban')
            .setDescription(
                `تم فك الحظر عن: ${user ? `${user}` : 'عضو غير معروف'}` +
                (executorTag ? `\nبواسطة: ${executorTag}` : '')
            )
            .setTimestamp();

        await sendGuildLog(guild, { embeds: [embed] });
    } catch {
        // ignore
    }
});

client.on('messageCreate', async message => {
    if (!message.guild) return;
    if (message.author.bot) return;

    // === MONITOR FORWARDING ===
    try {
        const { EmbedBuilder, PermissionsBitField } = require('discord.js');
        const monitors = getMonitors();
        for (const mon of monitors) {
            if (String(mon.sourceChannelId) === String(message.channel.id) &&
                String(mon.sourceGuildId) === String(message.guild.id)) {
                const targetChannel = client.channels.cache.get(mon.targetChannelId);
                if (!targetChannel || !targetChannel.isTextBased()) continue;

                // Check if bot can send to target
                const me = targetChannel.guild?.members?.me || (targetChannel.guild ? await targetChannel.guild.members.fetchMe().catch(() => null) : null);
                if (me) {
                    const perms = targetChannel.permissionsFor(me);
                    if (!perms || !perms.has(PermissionsBitField.Flags.SendMessages) || !perms.has(PermissionsBitField.Flags.ViewChannel)) continue;
                }

                const author = message.author;
                const avatar = author.displayAvatarURL({ size: 64, extension: 'png' });

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setAuthor({ name: author.tag, iconURL: avatar })
                    .setDescription(message.content || '(بدون نص)')
                    .addFields(
                        { name: '🔗 المصدر', value: `[${message.guild.name} > #${message.channel.name}](https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id})`, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'رسالة مراقبة' });

                // Attachments
                const files = [];
                if (message.attachments && message.attachments.size > 0) {
                    const attachList = [];
                    for (const [, att] of message.attachments) {
                        attachList.push(`[${att.name || 'ملف'}](${att.url})`);
                        if (att.contentType && att.contentType.startsWith('image/')) {
                            files.push({ attachment: att.url, name: att.name || 'image.png' });
                        }
                    }
                    if (attachList.length > 0) {
                        embed.addFields({ name: '📎 المرفقات', value: attachList.join('\n').slice(0, 1024), inline: false });
                    }
                }

                // Stickers
                if (message.stickers && message.stickers.size > 0) {
                    const stickerList = [];
                    for (const [, sticker] of message.stickers) {
                        stickerList.push('🖼️ ' + sticker.name);
                        const url = sticker.url;
                        if (url) files.push({ attachment: url, name: 'sticker.' + (url.endsWith('.gif') ? 'gif' : 'png') });
                    }
                    if (stickerList.length > 0) {
                        embed.addFields({ name: '🖼️ ملصقات', value: stickerList.join('\n').slice(0, 1024), inline: false });
                    }
                }

                const content = '📨 **رسالة جديدة من ' + author + '**';

                try {
                    if (files.length > 0) {
                        await targetChannel.send({ content, embeds: [embed], files: files.slice(0, 10) });
                    } else {
                        await targetChannel.send({ content, embeds: [embed] });
                    }
                } catch {
                    // Silently fail - target might not be accessible
                }
                break; // Only forward to one target per source
            }
        }
    } catch {
        // ignore monitor errors
    }

    const config = getGuildConfig(message.guild.id);

    // === SHORTCUTS EXECUTION ===
    try {
        const shortcuts = Array.isArray(config.shortcuts) ? config.shortcuts : [];
        if (shortcuts.length > 0) {
            const content = message.content.trim().toLowerCase();
            const parts = content.split(/\s+/);
            const trigger = normalizeShortcutTrigger(message.guild, parts[0]);
            
            const shortcut = shortcuts.find((s) => normalizeShortcutTrigger(message.guild, s && s.trigger) === trigger);
            if (shortcut) {
                const cmd = shortcut.command;
                const args = parts.slice(1).join(' ');
                
                // Execute the command
                const { EmbedBuilder } = require('discord.js');
                
                // Timeout command
                if (cmd === 'timeout') {
                    if (!message.member?.permissions?.has('ModerateMembers')) {
                        return;
                    } else {
                        const targetMatch = args.match(/<@!?(\d+)>/);
                        const targetId = targetMatch ? targetMatch[1] : null;
                        const duration = args.replace(/<@!?\d+>/, '').trim() || '10m';
                        
                        if (targetId) {
                            const target = await message.guild.members.fetch(targetId).catch(() => null);
                            if (target) {
                                const ms = parseDurationLike(duration) || 600000;
                                await target.timeout(ms, `Shortcut by ${message.author.tag}`).catch(() => null);
                                await message.reply(`⏱️ تم إعطاء ${target} تايم آوت لمدة ${duration}`).catch(() => {});
                            }
                        }
                    }
                }
                
                // Kick command
                else if (cmd === 'kick') {
                    if (!message.member?.permissions?.has('KickMembers')) {
                        return;
                    } else {
                        const targetMatch = args.match(/<@!?(\d+)>/);
                        const targetId = targetMatch ? targetMatch[1] : null;
                        const reason = args.replace(/<@!?\d+>/, '').trim() || 'No reason';
                        
                        if (targetId) {
                            const target = await message.guild.members.fetch(targetId).catch(() => null);
                            if (target && target.kickable) {
                                await target.kick(reason).catch(() => null);
                                await message.reply(`🦶 تم طرد ${target}`).catch(() => {});
                            }
                        }
                    }
                }
                
                // Ban command
                else if (cmd === 'ban') {
                    if (!message.member?.permissions?.has('BanMembers')) {
                        return;
                    } else {
                        const targetMatch = args.match(/<@!?(\d+)>/);
                        const targetId = targetMatch ? targetMatch[1] : null;
                        const reason = args.replace(/<@!?\d+>/, '').trim() || 'No reason';
                        
                        if (targetId) {
                            const target = await message.guild.members.fetch(targetId).catch(() => null);
                            if (target && target.bannable) {
                                await target.ban({ reason }).catch(() => null);
                                await message.reply(`🔨 تم حظر ${target}`).catch(() => {});
                            }
                        }
                    }
                }
                
                // Warn command
                else if (cmd === 'warn') {
                    if (!message.member?.permissions?.has('ModerateMembers')) {
                        return;
                    } else {
                        const targetMatch = args.match(/<@!?(\d+)>/);
                        const targetId = targetMatch ? targetMatch[1] : null;
                        const reason = args.replace(/<@!?\d+>/, '').trim() || 'No reason';
                        
                        if (targetId) {
                            const target = await message.guild.members.fetch(targetId).catch(() => null);
                            if (target) {
                                await target.send(`⚠️ تم تحذيرك في **${message.guild.name}**\nالسبب: ${reason}`).catch(() => {});
                                await message.reply(`⚠️ تم تحذير ${target}`).catch(() => {});
                            }
                        }
                    }
                }
                
                // Mute command
                else if (cmd === 'mute') {
                    if (!message.member?.permissions?.has('ModerateMembers')) {
                        return;
                    } else {
                        const targetMatch = args.match(/<@!?(\d+)>/);
                        const targetId = targetMatch ? targetMatch[1] : null;
                        
                        if (targetId) {
                            const target = await message.guild.members.fetch(targetId).catch(() => null);
                            if (target) {
                                await target.timeout(24 * 60 * 60 * 1000, `Mute by ${message.author.tag}`).catch(() => null);
                                await message.reply(`🔇 تم كتم ${target}`).catch(() => {});
                            }
                        }
                    }
                }
                
                // Unmute command
                else if (cmd === 'unmute') {
                    if (!message.member?.permissions?.has('ModerateMembers')) {
                        return;
                    } else {
                        const targetMatch = args.match(/<@!?(\d+)>/);
                        const targetId = targetMatch ? targetMatch[1] : null;
                        
                        if (targetId) {
                            const target = await message.guild.members.fetch(targetId).catch(() => null);
                            if (target) {
                                await target.timeout(null).catch(() => null);
                                await message.reply(`🔊 تم فك كتم ${target}`).catch(() => {});
                            }
                        }
                    }
                }
                
                // Clear command
                else if (cmd === 'clear') {
                    if (!message.member?.permissions?.has('ManageMessages')) {
                        return;
                    } else {
                        const count = parseInt(args) || 10;
                        const msgs = await message.channel.messages.fetch({ limit: Math.min(count + 1, 100) }).catch(() => null);
                        if (msgs) {
                            await message.channel.bulkDelete(msgs, true).catch(() => null);
                            await message.channel.send(`🧹 تم مسح ${count} رسالة`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000)).catch(() => {});
                        }
                    }
                }
                
                // Slowmode command
                else if (cmd === 'slowmode') {
                    if (!message.member?.permissions?.has('ManageChannels')) {
                        return;
                    } else {
                        const seconds = parseInt(args) || 0;
                        await message.channel.setRateLimitPerUser(seconds).catch(() => null);
                        await message.reply(`🐢 تم ضبط السلو مود: ${seconds} ثانية`).catch(() => {});
                    }
                }
                
                // Lock command
                else if (cmd === 'lock') {
                    if (!message.member?.permissions?.has('ManageChannels')) {
                        return;
                    } else {
                        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => null);
                        await message.reply('🔒 تم قفل الروم').catch(() => {});
                    }
                }
                
                // Unlock command
                else if (cmd === 'unlock') {
                    if (!message.member?.permissions?.has('ManageChannels')) {
                        return;
                    } else {
                        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => null);
                        await message.reply('🔓 تم فتح الروم').catch(() => {});
                    }
                }
                
                // Any other registered command → generic runner
                // (parses @mentions/numbers/text into the slash command's options)
                else {
                    await runShortcutCommand(client, message, cmd, args);
                }
                
                return; // Stop processing after shortcut execution
            }
        }
    } catch (err) {
        console.error('Shortcut execution error:', err);
    }

    // Channel auto-reply embed(s) — re-sent on each message, deduped by ID.
    try {
        const replyCfgs = [];
        if (Array.isArray(config.channelAutoReplies)) {
            for (const r of config.channelAutoReplies) {
                if (r && typeof r === 'object' && typeof r.channelId === 'string') replyCfgs.push(r);
            }
        }
        // Backward compatibility with the old single-embed config.
        if (
            replyCfgs.length === 0 &&
            config.channelAutoReply &&
            typeof config.channelAutoReply === 'object' &&
            config.channelAutoReply.channelId
        ) {
            replyCfgs.push({
                id: 'legacy',
                channelId: String(config.channelAutoReply.channelId),
                embed: config.channelAutoReply.embed || {},
                lastMessageIds: []
            });
        }

        const mine = replyCfgs.filter(
            (r) => message.channel && String(message.channel.id) === String(r.channelId)
        );

        // One re-post at a time per channel, otherwise concurrent messages race.
        if (mine.length && !channelAutoReplyBusy.has(message.channel.id)) {
            channelAutoReplyBusy.add(message.channel.id);
            try {
                const { EmbedBuilder } = require('discord.js');
                const dirty = [];

                for (const r of mine) {
                    const e = r.embed && typeof r.embed === 'object' ? r.embed : {};
                    const title = typeof e.title === 'string' ? e.title.trim() : '';
                    const description = typeof e.description === 'string' ? e.description : '';
                    const color = typeof e.color === 'string' ? e.color : '#E7D3B0';
                    if (!title && !(description && description.trim())) continue;

                    // Delete every copy we know about — persisted, so a restart
                    // no longer orphans yesterday's embeds.
                    const prev = Array.isArray(r.lastMessageIds) ? r.lastMessageIds.slice() : [];
                    for (const id of prev) {
                        await message.channel.messages.delete(String(id)).catch(() => null);
                    }

                    const embed = new EmbedBuilder().setColor(color).setTimestamp();
                    if (title) embed.setTitle(title.slice(0, 256));
                    if (description && description.trim()) embed.setDescription(description.slice(0, 4000));

                    const sent = await message.channel.send({ embeds: [embed] }).catch(() => null);
                    r.lastMessageIds = sent && sent.id ? [String(sent.id)] : [];
                    dirty.push(r);
                }

                if (dirty.length) {
                    updateGuildConfig(message.guild.id, (c) => {
                        const list = Array.isArray(c.channelAutoReplies)
                            ? c.channelAutoReplies.map((x) => ({ ...x }))
                            : [];
                        for (const d of dirty) {
                            const idx = list.findIndex((x) => x && x.id === d.id);
                            if (idx >= 0) list[idx] = { ...list[idx], lastMessageIds: d.lastMessageIds };
                            else list.push({ ...d });
                        }
                        return { ...c, channelAutoReplies: list };
                    });
                }
            } finally {
                channelAutoReplyBusy.delete(message.channel.id);
            }
        }
    } catch {
        // ignore
    }

    try {
        const ch = message.channel;
        if (ch && ch.isTextBased && ch.isTextBased()) {
            const meta = getTicketMetaFromChannel(ch);
            if (meta && !meta.closed) {
                const staffRoleIds = Array.isArray(meta.staffRoleIds) ? meta.staffRoleIds.map(String).filter(Boolean) : [];
                const staffOk = isStaff(message.member, config, staffRoleIds);

                const now = Date.now();
                if (staffOk) {
                    meta.lastStaffMsgAt = now;
                    meta.noResponseWarnedAt = 0;
                } else {
                    meta.lastUserMsgAt = now;
                    meta.noResponseWarnedAt = 0;
                }
                await setTicketMetaForChannel(ch, meta);
            }
        }
    } catch {
    }

    try {
        const a = config && config.automod && typeof config.automod === 'object' ? config.automod : null;
        if (a && a.enabled === true) {
            let skipAutomod = false;
            const ignoredChannelIds = Array.isArray(a.ignoredChannelIds) ? a.ignoredChannelIds.map(String) : [];
            if (message.channel && ignoredChannelIds.includes(String(message.channel.id))) {
                skipAutomod = true;
            }

            const ignoredRoleIds = Array.isArray(a.ignoredRoleIds) ? a.ignoredRoleIds.map(String) : [];
            const hasIgnoredRole = ignoredRoleIds.length && message.member && message.member.roles && message.member.roles.cache
                ? message.member.roles.cache.some((r) => ignoredRoleIds.includes(String(r.id)))
                : false;
            if (hasIgnoredRole) skipAutomod = true;

            const ignoreAdmins = a.ignoreAdmins !== false;
            if (ignoreAdmins && message.member && message.member.permissions && message.member.permissions.has) {
                try {
                    if (
                        message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                        message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
                        message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
                    ) {
                        skipAutomod = true;
                    }
                } catch {
                    skipAutomod = true;
                }
            }

            if (!skipAutomod) {
                const windowMs = Math.max(1000, Math.min(60_000, Math.floor(Number(a.windowMs) || 10_000)));
                const maxMessages = Math.max(1, Math.min(50, Math.floor(Number(a.maxMessages) || 12)));
                const maxLinks = Math.max(0, Math.min(20, Math.floor(Number(a.maxLinks) || 3)));
                const action = ['log', 'delete', 'timeout', 'delete_timeout'].includes(String(a.action || 'log')) ? String(a.action || 'log') : 'log';
                const timeoutSeconds = Math.max(0, Math.min(60 * 60 * 24 * 7, Math.floor(Number(a.timeoutSeconds) || 60)));

                const now = Date.now();
                const key = `${message.guild.id}:${message.author.id}`;
                const w = spamRate.get(key) || { t0: now, count: 0, links: 0 };
                if (now - w.t0 > windowMs) {
                    w.t0 = now;
                    w.count = 0;
                    w.links = 0;
                }
                w.count += 1;
                const text = String(message.content || '');
                if (/https?:\/\//i.test(text) || /discord\.gg\//i.test(text)) w.links += 1;
                spamRate.set(key, w);

                const tooFast = maxMessages > 0 && w.count >= maxMessages;
                const tooManyLinks = maxLinks > 0 && w.links >= maxLinks;

                // Rule engine checks
                let ruleViolation = null;
                const rc = a.rulesConfig && typeof a.rulesConfig === 'object' ? a.rulesConfig : {};

                // Mention spam check
                const maxMentions = Math.max(0, Math.floor(Number(rc.maxMentions) || 0));
                if (!ruleViolation && maxMentions > 0) {
                    const mentionCount = (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0);
                    if (mentionCount >= maxMentions) {
                        ruleViolation = `منشنات كثيرة (${mentionCount})`;
                    }
                }

                // Caps spam check
                const maxCapsPercent = Math.max(0, Math.min(100, Math.floor(Number(rc.maxCapsPercent) || 0)));
                if (!ruleViolation && maxCapsPercent > 0 && text.length >= 5) {
                    const capsCount = (text.match(/[A-Z]/g) || []).length;
                    const lettersCount = (text.match(/[A-Za-z]/g) || []).length;
                    if (lettersCount > 0 && (capsCount / lettersCount) * 100 >= maxCapsPercent) {
                        ruleViolation = `حروف كبتلة (${Math.round((capsCount / lettersCount) * 100)}%)`;
                    }
                }

                // Repeat spam check
                const maxRepeats = Math.max(0, Math.floor(Number(rc.maxRepeats) || 0));
                const repeatWindowMs = Math.max(1000, Math.floor(Number(rc.repeatWindowMs) || 30000));
                if (!ruleViolation && maxRepeats > 0) {
                    const repeatKey = `${message.guild.id}:${message.author.id}:repeat`;
                    const repeatData = repeatSpamMap.get(repeatKey) || { msgs: [], lastClean: now };
                    if (now - repeatData.lastClean > repeatWindowMs) {
                        repeatData.msgs = [];
                        repeatData.lastClean = now;
                    }
                    const normalizedMsg = text.toLowerCase().trim().slice(0, 200);
                    repeatData.msgs.push({ txt: normalizedMsg, ts: now });
                    repeatData.msgs = repeatData.msgs.filter((m) => now - m.ts < repeatWindowMs);
                    repeatSpamMap.set(repeatKey, repeatData);
                    const sameCount = repeatData.msgs.filter((m) => m.txt === normalizedMsg).length;
                    if (sameCount >= maxRepeats) {
                        ruleViolation = `تكرار نفس الرسالة (${sameCount}x)`;
                    }
                }

                // Link whitelist check
                const linkWhitelist = Array.isArray(rc.linkWhitelist) ? rc.linkWhitelist.map((s) => s.toLowerCase()) : [];
                if (!ruleViolation && linkWhitelist.length > 0 && /https?:\/\/[^\s]+/i.test(text)) {
                    const links = text.match(/https?:\/\/[^\s]+/gi) || [];
                    for (const link of links) {
                        const domain = (() => { try { return new URL(link).hostname.toLowerCase(); } catch { return ''; } })();
                        if (!linkWhitelist.some((w) => domain === w || domain.endsWith('.' + w))) {
                            ruleViolation = `رابط غير مسموح: ${domain}`;
                            break;
                        }
                    }
                }

                if (tooFast || tooManyLinks || ruleViolation) {
                    const lastLog = spamLastLog.get(key) || 0;
                    const reason = ruleViolation || (tooManyLinks ? 'روابط كثيرة' : 'سرعة رسائل عالية');

                    if ((action === 'delete' || action === 'delete_timeout') && message.deletable) {
                        try { await message.delete(); } catch { }
                    }

                    if ((action === 'timeout' || action === 'delete_timeout') && timeoutSeconds > 0) {
                        try {
                            if (message.member && message.member.moderatable) {
                                await message.member.timeout(timeoutSeconds * 1000, `AutoMod: ${reason}`);
                            }
                        } catch {
                        }
                    }

                    if (now - lastLog > 60_000) {
                        spamLastLog.set(key, now);
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setColor('#E7D3B0')
                            .setTitle('🚨 AutoMod رصد سبام')
                            .setDescription(`العضو: ${message.author}\nالروم: <#${message.channel.id}>`)
                            .addFields(
                                { name: 'السبب', value: reason, inline: false },
                                { name: 'الإجراء', value: String(action), inline: false }
                            )
                            .setTimestamp();
                        await sendGuildLog(message.guild, { embeds: [embed] }, { sourceChannelId: message.channel.id, category: 'moderation' });
                    }
                }
            }
        }
    } catch {
        // ignore
    }

    // AI Moderation - detect profanity, slurs, hate speech, raid behavior
    try {
        const aiModConfig = config && config.aiMod && typeof config.aiMod === 'object' ? config.aiMod : {};
        const aiModDebug = String(process.env.DEBUG_AIMOD || '').trim() === '1';
        if (aiModDebug) console.log('AI Mod check - enabled:', aiModConfig.enabled, 'content length:', message.content?.length);
        if (aiModConfig.enabled === true && message.content && message.content.length >= 3) {
            const aimod = require('./aimod');
            const modCfg = aimod.getAiModConfig(message.guild.id);
            if (aiModDebug) console.log('AI Mod config:', JSON.stringify(modCfg));
            
            if (!aimod.shouldSkip(message, modCfg)) {
                const ai = config.ai && typeof config.ai === 'object' ? config.ai : {};
                const baseUrl = (typeof ai.baseUrl === 'string' && ai.baseUrl.trim())
                    ? ai.baseUrl.trim().replace(/\/$/, '')
                    : String(process.env.OLLAMA_BASE_URL || '').trim().replace(/\/$/, '');
                const model = (typeof ai.model === 'string' && ai.model.trim())
                    ? ai.model.trim()
                    : String(process.env.OLLAMA_MODEL || 'phi3:mini').trim();
                
                if (aiModDebug) console.log('AI Mod - baseUrl:', baseUrl, 'model:', model);
                
                if (baseUrl) {
                    if (aiModDebug) console.log('AI Mod - analyzing:', message.content.slice(0, 50));
                    const analysis = await aimod.analyzeContent(message.content, baseUrl, model);
                    if (aiModDebug) console.log('AI Mod - analysis result:', JSON.stringify(analysis));
                    
                    if (aimod.shouldAct(analysis, modCfg)) {
                        const action = aimod.determineAction(analysis, modCfg);
                        const reason = `AI Mod: ${analysis.type} (${analysis.severity})`;
                        const originalContent = String(message.content || '');
                        if (aiModDebug) console.log('AI Mod - taking action:', action, 'reason:', reason);

                        let didDelete = false;
                        let didTimeout = false;
                        let didBan = false;
                        let timeoutMs = 0;

                        try {
                            if (action === 'delete' || action === 'timeout' || action === 'ban') {
                                await message.delete().then(() => { didDelete = true; }).catch(() => null);
                            }

                            if (action === 'timeout' && message.member) {
                                timeoutMs = (modCfg.timeoutMinutes || 10) * 60 * 1000;
                                await message.member.timeout(timeoutMs, reason).then(() => { didTimeout = true; }).catch(() => null);
                            }

                            if (action === 'ban' && message.member) {
                                await message.member.ban({ reason }).then(() => { didBan = true; }).catch(() => null);
                            }
                        } catch {
                            // ignore
                        }

                        // Log the action (always try, even if channel not cached)
                        const logChannelId = modCfg.logChannelId || config.logsChannelId;
                        if (logChannelId) {
                            try {
                                const logChannel =
                                    message.guild.channels.cache.get(String(logChannelId)) ||
                                    (await message.guild.channels.fetch(String(logChannelId)).catch(() => null));

                                if (!logChannel || !logChannel.isTextBased || !logChannel.isTextBased()) {
                                    console.error('AI Mod - log channel not found or not text-based:', logChannelId);
                                } else {
                                    const { EmbedBuilder } = require('discord.js');
                                    const actionText = action === 'timeout'
                                        ? `timeout (${Math.round(timeoutMs / 60000)}m)`
                                        : action;

                                    const outcomeText = [
                                        didDelete ? 'deleted' : null,
                                        didTimeout ? 'timed_out' : null,
                                        didBan ? 'banned' : null
                                    ].filter(Boolean).join(', ') || 'attempted';

                                    const logEmbed = new EmbedBuilder()
                                        .setColor('#E7D3B0')
                                        .setTitle('🤖 AI Moderation')
                                        .setDescription(`العضو: ${message.author} (\`${message.author.id}\`)\nالروم: <#${message.channel.id}>`)
                                        .addFields(
                                            { name: 'النوع', value: analysis.type, inline: true },
                                            { name: 'الشدة', value: analysis.severity, inline: true },
                                            { name: 'الإجراء', value: actionText, inline: true },
                                            { name: 'النتيجة', value: outcomeText, inline: true },
                                            { name: 'السبب', value: reason, inline: false },
                                            { name: 'الرسالة', value: originalContent.slice(0, 500) || '—', inline: false }
                                        )
                                        .setTimestamp();

                                    await logChannel.send({ embeds: [logEmbed] });
                                }
                            } catch (err) {
                                console.error('AI Mod - failed to log action:', err);
                            }
                        } else {
                            if (aiModDebug) console.log('AI Mod - no logChannelId configured');
                        }
                    } else {
                        if (aiModDebug) console.log('AI Mod - shouldAct returned false');
                    }
                } else {
                    if (aiModDebug) console.log('AI Mod - no baseUrl configured');
                }
            } else {
                if (aiModDebug) console.log('AI Mod - shouldSkip returned true');
            }
        }
    } catch (err) {
        console.error('AI Mod error:', err);
    }

    if (config && config.ai && typeof config.ai === 'object' && config.ai.enabled) {
        await handleAIChat(message, config);
    }

    if (config && config.autoReactions && typeof config.autoReactions === 'object') {
        const ar = config.autoReactions;
        const chId = typeof ar.channelId === 'string' ? ar.channelId : null;
        const emojis = Array.isArray(ar.emojis) ? ar.emojis : [];
        const excludedRoles = Array.isArray(ar.excludedRoles) ? ar.excludedRoles : [];
        if (chId && message.channel.id === chId && emojis.length) {
            // Check if user has excluded role
            const hasExcludedRole = excludedRoles.length > 0 && message.member?.roles?.cache
                ? message.member.roles.cache.some(r => excludedRoles.includes(r.id))
                : false;
            if (!hasExcludedRole) {
                for (const e of emojis.slice(0, 10)) {
                    try {
                        await message.react(e);
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    if (config && typeof config.whispersChannelId === 'string' && config.whispersChannelId === message.channel.id) {
        // A gateway reconnect can redeliver the same message; never post it twice.
        if (!markOnce(processedWhisperMessageIds, String(message.id), 60_000)) return;

        const key = `${message.guild.id}:${message.author.id}`;
        const now = Date.now();
        const last = whispersRate.get(key) || 0;

        // Quick successive *plain text* may be spam, but never swallow media or
        // links: those were being deleted without ever being re-posted.
        const rawContent = String(message.content || '');
        const protects = (message.attachments && message.attachments.size > 0)
            || /https?:\/\/\S+/i.test(rawContent)
            || (Array.isArray(message.embeds) && message.embeds.some((e) => e && (e.image || e.thumbnail || e.url)));
        if (!protects && now - last < 2500) {
            try {
                await message.delete();
            } catch {
                // ignore
            }
            return;
        }
        whispersRate.set(key, now);

        const content = String(message.content || '').trim();
        const atts = message.attachments && message.attachments.size
            ? [...message.attachments.values()].slice(0, 10)
            : [];
        const files = atts.map((a) => a.url).filter(Boolean).slice(0, 10);

        // Re-download the attachments BEFORE deleting the original message.
        // Sending the old CDN link afterwards only produces a filename chip —
        // the actual bytes have to be uploaded again for Discord to preview it.
        const uploadFiles = [];
        let embedImageName = null;
        try {
            const { AttachmentBuilder } = require('discord.js');
            const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|avif)$/i;
            const entries = atts.slice(0, 5);
            for (let i = 0; i < entries.length; i++) {
                const a = entries[i];
                try {
                    if (a.size && a.size > 8 * 1024 * 1024) continue;
                    const res = await fetch(a.url, { signal: AbortSignal.timeout(15_000) });
                    if (!res || !res.ok) throw new Error(`HTTP ${res && res.status}`);
                    const buf = Buffer.from(await res.arrayBuffer());
                    if (!buf.length) continue;

                    const isImage = String(a.contentType || '').toLowerCase().startsWith('image/')
                        || IMG_EXT_RE.test(String(a.name || ''));
                    let name;
                    if (isImage) {
                        const ext = (String(a.name || '').match(/\.[a-z0-9]{1,5}$/i) || [''])[0] || '.png';
                        name = `whisper_${Date.now()}_${i}${ext}`;
                        if (!embedImageName) embedImageName = name;
                    } else {
                        name = String(a.name || `file_${i}`).slice(0, 80);
                    }
                    uploadFiles.push(new AttachmentBuilder(buf, { name }));
                } catch (err) {
                    console.error('whisper attachment fetch failed:', err && err.message ? err.message : err);
                }
            }
        } catch {
            // ignore
        }

        try {
            await message.delete();
        } catch {
            // ignore
        }

        try {
            const { EmbedBuilder } = require('discord.js');
            const logEmbed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('🕯️ همسة (لوق إداري)')
                .setDescription(
                    `المرسل: ${message.author}\n` +
                    `الروم: <#${message.channel.id}>\n\n` +
                    `${content ? content.slice(0, 3500) : '*بدون نص*'}`
                )
                .setTimestamp();
            if (files && files.length) {
                logEmbed.addFields({ name: 'مرفقات', value: files.map((u) => `- ${u}`).join('\n').slice(0, 1024), inline: false });
            }
            await sendGuildLog(message.guild, { embeds: [logEmbed] });
        } catch {
            // ignore
        }

        try {
            const { EmbedBuilder } = require('discord.js');
            const urlRe = /https?:\/\/[^\s<>()]+/gi;
            const urls = [...new Set((rawContent.match(urlRe) || []))];

            // Images go INSIDE the embed: uploaded files via attachment://<name>,
            // direct image links via setImage(url). Other links stay outside
            // the embed as plain content so Discord can unfurl them.
            const IMG_LINK_RE = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;
            const imageLink = urls.find((u) => IMG_LINK_RE.test(u)) || null;

            // Discord often unfurls GIF links in the ORIGINAL message before we
            // delete it. Reuse that media instead of fetching klipy/tenor pages
            // ourselves — those sites frequently block the server (403).
            const sourceMedia = [];
            const sourceEmbeds = Array.isArray(message.embeds) ? message.embeds : [];
            for (const e of sourceEmbeds) {
                if (!e) continue;
                if (e.image && e.image.url) sourceMedia.push({ kind: 'image', url: String(e.image.url) });
                else if (e.thumbnail && e.thumbnail.url) sourceMedia.push({ kind: 'image', url: String(e.thumbnail.url) });
                else if (e.video && e.video.url) sourceMedia.push({ kind: 'video', url: String(e.video.url) });
            }
            if (sourceEmbeds.length) {
                console.log('whisper source embeds:', JSON.stringify(sourceEmbeds.map((e) => ({
                    type: e.type,
                    image: e.image && e.image.url,
                    video: e.video && e.video.url,
                    thumb: e.thumbnail && e.thumbnail.url
                }))));
            }

            let copiedImageUrl = null;
            let copiedVideoFile = null;
            let videoBuf = null;
            const firstImage = sourceMedia.find((m) => m.kind === 'image');
            const firstVideo = sourceMedia.find((m) => m.kind === 'video');
            if (firstImage && !firstVideo) {
                copiedImageUrl = firstImage.url;
            } else if (firstVideo) {
                // Bots can't set an embed video field. Convert the clip to an
                // animated GIF and reference it with attachment:// instead,
                // so the animation appears INSIDE the whisper embed.
                try {
                    const { AttachmentBuilder } = require('discord.js');
                    const res = await fetch(firstVideo.url, { signal: AbortSignal.timeout(15_000) });
                    if (res && res.ok) {
                        const buf = Buffer.from(await res.arrayBuffer());
                        if (buf.length && buf.length < 20 * 1024 * 1024) {
                            videoBuf = buf;
                            const fs = require('fs');
                            const os = require('os');
                            const path = require('path');
                            const crypto = require('crypto');
                            const { execFile } = require('child_process');
                            const { promisify } = require('util');
                            const run = promisify(execFile);
                            const id = crypto.randomUUID();
                            const inFile = path.join(os.tmpdir(), `whisper_${id}.mp4`);
                            const outFile = path.join(os.tmpdir(), `whisper_${id}.gif`);
                            try {
                                await fs.promises.writeFile(inFile, buf);
                                const ffmpeg = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg');
                                await run(ffmpeg, [
                                    '-y', '-loglevel', 'error', '-i', inFile,
                                    '-t', '6', '-vf', 'fps=12,scale=480:-1:flags=lanczos',
                                    '-loop', '0', outFile
                                ], { timeout: 25_000, maxBuffer: 1024 * 1024 });
                                const gif = await fs.promises.readFile(outFile);
                                if (gif.length) {
                                    const name = `whisper_${Date.now()}.gif`;
                                    copiedVideoFile = new AttachmentBuilder(gif, { name });
                                    if (!embedImageName) embedImageName = name;
                                }
                            } finally {
                                await fs.promises.rm(inFile, { force: true }).catch(() => {});
                                await fs.promises.rm(outFile, { force: true }).catch(() => {});
                            }
                            // Fallback if ffmpeg failed: still send the raw clip.
                            if (!copiedVideoFile && videoBuf) {
                                copiedVideoFile = new AttachmentBuilder(videoBuf, { name: `whisper_${Date.now()}.mp4` });
                            }
                        }
                    }
                } catch (err) {
                    console.error('whisper video->gif failed:', err && err.message ? err.message : err);
                    if (videoBuf) {
                        try {
                            const { AttachmentBuilder } = require('discord.js');
                            copiedVideoFile = new AttachmentBuilder(videoBuf, { name: `whisper_${Date.now()}.mp4` });
                        } catch { /* ignore */ }
                    }
                }
            } else if (firstImage) {
                copiedImageUrl = firstImage.url;
            }

            const outside = [];
            for (const u of urls) {
                if (!u || u === imageLink || outside.includes(u)) continue;
                outside.push(u);
                if (outside.length >= 8) break;
            }
            const outsideText = outside.join('\n').slice(0, 1900);

            const textOnly = rawContent
                .replace(urlRe, '')
                .replace(/\s+/g, ' ')
                .trim();
            const hasAnything = !!(textOnly || outside.length || imageLink || embedImageName);

            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('شخصٌ ما هَمَسَ هَمْسَةً')
                .setDescription(
                    (textOnly
                        ? textOnly.slice(0, 3900)
                        : hasAnything
                            ? '*بدون نص*'
                            : '*…صمت لطيف*') +
                    '\n\n*— المُرسِلُ مَجْهُولٌ.*'
                )
                .setTimestamp();

            if (embedImageName) {
                // References the file we re-uploaded with this very message.
                embed.setImage(`attachment://${embedImageName}`);
            } else if (copiedImageUrl) {
                // Media copied from Discord's own unfurl of the original link.
                embed.setImage(copiedImageUrl.slice(0, 2000));
            } else if (imageLink) {
                embed.setImage(imageLink.slice(0, 2000));
            }

            try {
                const userIds = message.mentions && message.mentions.users && message.mentions.users.size
                    ? [...message.mentions.users.keys()].map(String)
                    : [];
                const roleIds = message.mentions && message.mentions.roles && message.mentions.roles.size
                    ? [...message.mentions.roles.keys()].map(String)
                    : [];
                const uniqueUsers = [...new Set(userIds)].slice(0, 15);
                const uniqueRoles = [...new Set(roleIds)].slice(0, 10);

                // Avoid @everyone/@here pings; only explicit user/role mentions.
                const mentionText = [
                    ...uniqueUsers.map((id) => `<@${id}>`),
                    ...uniqueRoles.map((id) => `<@&${id}>`)
                ].join(' ').trim();

                if (mentionText) {
                    await message.channel.send({ content: `هَمْسَةٌ لِـ ${mentionText}` });
                }
            } catch {
                // ignore
            }

            const finalFiles = copiedVideoFile ? [...uploadFiles, copiedVideoFile] : uploadFiles;
            await message.channel.send({
                content: outsideText || undefined,
                embeds: [embed],
                files: finalFiles.length ? finalFiles : undefined,
                allowedMentions: { parse: [] }
            });
        } catch (err) {
            console.error('whispers messageCreate error:', err);
        }
        return;
    }

    if (config && typeof config.suggestionsChannelId === 'string' && config.suggestionsChannelId === message.channel.id) {
        // Prevent duplicates if this message is observed twice for any reason.
        if (!markOnce(processedSuggestionMessageIds, String(message.id), 60_000)) {
            return;
        }
        try {
            const { PermissionFlagsBits } = require('discord.js');
            if (message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
                return;
            }
        } catch {
            // ignore
        }

        try {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const content = String(message.content || '').trim();
            const attachmentUrls = message.attachments && message.attachments.size > 0
                ? [...message.attachments.values()].slice(0, 5).map((a) => a && a.url).filter(Boolean)
                : [];

            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('💡 اقتراح جديد')
                .setThumbnail(message.author.displayAvatarURL({ size: 128 }))
                .setDescription(content ? content.slice(0, 4000) : '*بدون نص*')
                .addFields(
                    { name: 'المرسل', value: `${message.author}`, inline: true },
                    { name: 'الحالة', value: 'قيد المراجعة ⏳', inline: true }
                )
                .setTimestamp();

            if (attachmentUrls.length) {
                embed.addFields({ name: 'مرفقات', value: attachmentUrls.map((u) => `- ${u}`).join('\n').slice(0, 1024), inline: false });
            }

            // Admin row (approve/reject)
            const adminRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`suggestions:approve:${message.id}`)
                    .setLabel('موافقة')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`suggestions:reject:${message.id}`)
                    .setLabel('رفض')
                    .setStyle(ButtonStyle.Danger)
            );

            // Owner row (edit/delete)
            const ownerRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`suggestions:edit:${message.author.id}:${message.id}`)
                    .setLabel('تعديل')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️'),
                new ButtonBuilder()
                    .setCustomId(`suggestions:delete:${message.author.id}:${message.id}`)
                    .setLabel('حذف')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );

            const suggestionMessage = await message.channel.send({
                embeds: [embed],
                components: [adminRow, ownerRow]
            });

            // Add voting reactions (thumbs up/down)
            try {
                await suggestionMessage.react('👍');
                await suggestionMessage.react('👎');
            } catch {
                // ignore reaction errors
            }
        } catch {
            // ignore
        }

        try {
            await message.delete();
        } catch {
            // ignore
        }
        return;
    }

    // ===== Honeypot: any message here gets the author banned =====
    if (Array.isArray(config.honeypotChannelIds) && config.honeypotChannelIds.includes(message.channel.id)) {
        try {
            const isAdmin = message.member && message.member.permissions
                ? message.member.permissions.has(PermissionsBitField.Flags.Administrator)
                : false;
            if (!isAdmin && !message.author.bot) {
                await message.delete().catch(() => {});
                await message.member.ban({ reason: 'Honeypot channel' }).catch(() => {});
                await sendGuildLog(message.guild, {
                    embeds: [
                        {
                            color: 0xED4245,
                            title: '🍯 هوني بوت',
                            description: `تم حظر ${message.author} لإرساله رسالة في <#${message.channel.id}>.`,
                            timestamp: new Date().toISOString()
                        }
                    ]
                }).catch(() => {});
            }
        } catch {
            // ignore
        }
        return;
    }

    if (Array.isArray(config.noMsgChannels) && config.noMsgChannels.includes(message.channel.id)) {
        // Keep anything that carries media or a link: only plain chatter is removed.
        const hasAttachment = !!(message.attachments && message.attachments.size > 0);
        const hasMediaEmbed = Array.isArray(message.embeds)
            && message.embeds.some((e) => e && (e.image || e.thumbnail || e.url || e.video));
        const hasLink = /https?:\/\/\S+/i.test(message.content || '');
        if (!hasAttachment && !hasMediaEmbed && !hasLink) {
            try {
                await message.delete();
            } catch {
                // Ignore if missing perms
            }
            return;
        }
    }

    if (Array.isArray(config.noImageChannels) && config.noImageChannels.includes(message.channel.id)) {
        const hasImageAttachment = message.attachments && message.attachments.size > 0
            ? message.attachments.some((att) => {
                const ct = (att.contentType || '').toLowerCase();
                if (ct.startsWith('image/')) return true;
                const name = (att.name || '').toLowerCase();
                return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.webp');
            })
            : false;

        const hasImageEmbed = Array.isArray(message.embeds) && message.embeds.some((e) => e && (e.image || e.thumbnail));

        if (hasImageAttachment || hasImageEmbed) {
            try {
                await message.delete();
            } catch {
                // Ignore if missing perms
            }

            await sendTempReply(message, 'اسفة بس الصور ممنوعة بهالقناة 3:');
            return;
        }
    }

    let gainedXpForDaily = 0;
    let leveledUpForDaily = 0;

    if (config.levelingEnabled !== false) {

    const xpKey = `${message.guild.id}:${message.author.id}`;
    const last = lastXpGain.get(xpKey) || 0;
    if (Date.now() - last >= xpCooldownMs) {
        lastXpGain.set(xpKey, Date.now());

        const baseXp = 15 + Math.floor(Math.random() * 11);
        const inv = getUserInventory(message.guild.id, message.author.id);
        const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
        const equippedRuneIds = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
        const equippedRunes = allRunes.filter((r) => r && equippedRuneIds.includes(r.id));
        const memberRoles = message.member ? [...message.member.roles.cache.keys()] : [];
        const roleBoosts = Array.isArray(config.roleBoosts) ? config.roleBoosts : [];
        const mult = getActiveXpMultiplier(inv) * getRoleBoostMultiplier(memberRoles, roleBoosts, 'xp_boost') * getEquippedRuneMultiplier(equippedRunes, 'xp_boost');
        const gainedXp = Math.max(1, Math.floor(baseXp * mult));
        gainedXpForDaily = gainedXp;
        const lunaMult = getActiveLunaMultiplier(inv) * getRoleBoostMultiplier(memberRoles, roleBoosts, 'luna_boost') * getEquippedRuneMultiplier(equippedRunes, 'luna_boost');
        const levelUpRewardMult = getActiveLevelUpRewardMultiplier(inv) * getRoleBoostMultiplier(memberRoles, roleBoosts, 'levelup_reward_boost') * getEquippedRuneMultiplier(equippedRunes, 'levelup_reward_boost');

        // Shared level-up pipeline: XP -> level-ups -> Luna + level rewards
        // + milestones + rune drops (with pity). Same path as /daily, /grantxp.
        const xpResult = processXpGain(message.guild.id, message.author.id, gainedXp, {
            lunaMult,
            levelUpRewardMult
        });

        const after = xpResult.after;
        const leveledUp = xpResult.levelsGained > 0;
        const newLevel = after.level;
        const lunaReward = xpResult.lunaGained;
        if (leveledUp) {
            leveledUpForDaily = xpResult.levelsGained;
        }

        if (leveledUp) {
            try {
                const displayed = getDisplayedTitle(inv);
                const title = displayed ? ` 🎭 ${displayed}` : '';

                const allBonusLines = [
                    ...xpResult.milestoneLines,
                    ...xpResult.rewardLines,
                    ...xpResult.runeLines
                ];
                const rewardSuffix = allBonusLines.length > 0 ? '\n\n' + allBonusLines.join('\n') : '';
                const nextMs = nextMilestone(newLevel);
                const nextMsLine = nextMs ? `\n\n🏁 الوجهة القادمة: **${nextMs.label}**` : '';
                const variants = [
                    (u, t, lvl, reward) =>
                        `🌙 هلااا ${u}${t}! وصلت **المستوى ${lvl}** 🔥\n` +
                        `خذ مكافأتك: **${reward}** Luna Points ✨${rewardSuffix}${nextMsLine}`,
                    (u, t, lvl, reward) =>
                        `✨ كفو ${u}${t}! الحين أنت **المستوى ${lvl}** 🤍\n` +
                        `+ **${reward}** Luna Points${rewardSuffix}${nextMsLine}`,
                    (u, t, lvl, reward) =>
                        `📈 يا سلام ${u}${t}! ترقيت للـ **المستوى ${lvl}** 😎\n` +
                        `وانضاف لك **${reward}** Luna Points${rewardSuffix}${nextMsLine}`,
                    (u, t, lvl, reward) =>
                        `🏅 مستوى جديد! ${u}${t} صار **المستوى ${lvl}** 🚀\n` +
                        `مكافأتك: **${reward}** Luna Points${rewardSuffix}${nextMsLine}\n` +
                        `عاش 🔥`
                ];

                const build = pickOne(variants) || variants[0];

                let outChannel = message.channel;
                const configuredId = config && typeof config.levelUpChannelId === 'string' ? config.levelUpChannelId : null;
                if (configuredId) {
                    let ch = message.guild.channels.cache.get(configuredId) || null;
                    if (!ch) {
                        try {
                            ch = await message.guild.channels.fetch(configuredId);
                        } catch {
                            ch = null;
                        }
                    }

                    const botMember = message.guild.members.me;
                    const permsOk = ch && botMember
                        ? ch.permissionsFor(botMember).has(PermissionsBitField.Flags.ViewChannel) && ch.permissionsFor(botMember).has(PermissionsBitField.Flags.SendMessages)
                        : false;

                    if (ch && ch.isTextBased && typeof ch.isTextBased === 'function' && ch.isTextBased() && permsOk) {
                        outChannel = ch;
                    }
                }

                await outChannel.send(build(message.author, title, newLevel, lunaReward));
            } catch {
                // ignore
            }
        }
    }

    }

    try {
        const dailyCmd = client.commands.get('daily');
        if (dailyCmd && typeof dailyCmd.dayKeyUtc === 'function') {
            const { getDailyTasksEntry, setDailyTasksEntry } = require('./db');
            const dk = dailyCmd.dayKeyUtc();
            const entry = getDailyTasksEntry(message.guild.id, message.author.id, dk);
            const progress = entry && entry.progress && typeof entry.progress === 'object' ? entry.progress : {};
            const next = { ...progress };

            next.msg_50 = Math.max(0, Math.floor(Number(next.msg_50) || 0)) + 1;

            const mentionCount = message.mentions && message.mentions.users && message.mentions.users.size
                ? message.mentions.users.size
                : 0;
            if (mentionCount > 0 && mentionCount <= 2) {
                next.mentions_3 = Math.max(0, Math.floor(Number(next.mentions_3) || 0)) + 1;
            }

            if (message.reference && message.reference.messageId) {
                next.replies_5 = Math.max(0, Math.floor(Number(next.replies_5) || 0)) + 1;
            }

            if (gainedXpForDaily > 0) {
                next.xp_200 = Math.max(0, Math.floor(Number(next.xp_200) || 0)) + Math.floor(gainedXpForDaily);
            }

            if (leveledUpForDaily > 0) {
                next.levelup_1 = Math.max(0, Math.floor(Number(next.levelup_1) || 0)) + Math.floor(leveledUpForDaily);
            }

            const mediaChId = config && config.dailyTasks && typeof config.dailyTasks === 'object' && typeof config.dailyTasks.mediaChannelId === 'string'
                ? config.dailyTasks.mediaChannelId
                : null;
            if (mediaChId && String(message.channel.id) === String(mediaChId)) {
                const hasAnyAttachment = message.attachments && message.attachments.size > 0;
                if (hasAnyAttachment) {
                    next.media_3 = Math.max(0, Math.floor(Number(next.media_3) || 0)) + 1;
                }
            }

            const suggestionsChId = config && typeof config.suggestionsChannelId === 'string' ? config.suggestionsChannelId : null;
            if (suggestionsChId && String(message.channel.id) === String(suggestionsChId)) {
                const text = String(message.content || '').trim();
                if (text && text.length >= 25) {
                    next.suggest_1 = Math.max(0, Math.floor(Number(next.suggest_1) || 0)) + 1;
                }
            }

            setDailyTasksEntry(message.guild.id, message.author.id, dk, {
                progress: next,
                claimedAt: entry && entry.claimedAt ? entry.claimedAt : 0,
                updatedAt: Date.now()
            });
        }
    } catch {
        // ignore
    }

    if (!Array.isArray(config.autoReplies) || config.autoReplies.length === 0) return;

    // One auto-reply per message, even if the gateway dispatches it twice.
    if (!markOnce(processedAutoReplyMessageIds, String(message.id), 60_000)) return;

    const content = (message.content || '').toLowerCase();
    for (const rule of config.autoReplies) {
        if (!rule || typeof rule.trigger !== 'string' || typeof rule.response !== 'string') continue;
        if (!canUseAutoReply(rule, message)) continue;
        const trigger = rule.trigger.toLowerCase();
        if (!trigger) continue;

        if (rule.mode === 'includes') {
            if (content.includes(trigger)) {
                await message.reply(rule.response).catch(() => {});
                return;
            }
        } else {
            if (content === trigger) {
                await message.reply(rule.response).catch(() => {});
                return;
            }
        }
    }
});

async function applyReactionRole(reaction, user, add) {
    if (!reaction.message.guild) return;
    if (user.bot) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch {
            return;
        }
    }

    const guild = reaction.message.guild;
    const config = getGuildConfig(guild.id);
    if (!Array.isArray(config.reactionRoles) || config.reactionRoles.length === 0) return;

    const emojiKey = emojiKeyFromReaction(reaction);
    const msgId = reaction.message.id;

    const mapping = config.reactionRoles.find(rr => rr && rr.messageId === msgId && rr.emoji === emojiKey);
    if (!mapping) return;

    let member;
    try {
        member = await guild.members.fetch(user.id);
    } catch {
        return;
    }

    try {
        if (add) {
            await member.roles.add(mapping.roleId);
        } else {
            await member.roles.remove(mapping.roleId);
        }
    } catch {
        // Ignore if missing perms / role hierarchy issues
    }
}

async function logReactionChange(reaction, user, add) {
    try {
        if (!reaction || !reaction.message || !reaction.message.guild) return;
        if (!user || user.bot) return;

        const guild = reaction.message.guild;
        const { EmbedBuilder } = require('discord.js');

        const emojiTxt = reaction.emoji
            ? (reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : `${reaction.emoji.name}`)
            : '؟';

        const msgUrl = reaction.message.url;
        const chId = reaction.message.channelId;

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle(add ? '➕ Reaction' : '➖ Reaction')
            .setDescription(
                `العضو: ${user}\n` +
                `الروم: <#${chId}>\n` +
                `الإيموجي: ${emojiTxt}\n` +
                (msgUrl ? `الرسالة: ${msgUrl}` : '')
            )
            .setTimestamp();

        await sendGuildLog(guild, { embeds: [embed] }, { sourceChannelId: String(chId || '') });
    } catch {
        // ignore
    }
}

client.on('messageReactionAdd', async (reaction, user) => {
    await applyReactionRole(reaction, user, true);
    await logReactionChange(reaction, user, true);
});

client.on('messageReactionRemove', async (reaction, user) => {
    await applyReactionRole(reaction, user, false);
    await logReactionChange(reaction, user, false);
});

// Login to Discord
async function loginWithRetry() {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('DISCORD_TOKEN غير موجود في ملف .env');
        process.exit(1);
    }

    let attempt = 0;
    while (true) {
        try {
            attempt += 1;
            await client.login(token);
            return;
        } catch (err) {
            const waitMs = Math.min(120000, 5000 * attempt);
            console.error(`فشل الاتصال بـDiscord (محاولة ${attempt}). سأحاول مرة ثانية بعد ${Math.ceil(waitMs / 1000)} ثانية...`, err);
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
}

loginWithRetry();

