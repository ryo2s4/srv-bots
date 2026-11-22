const fs = require('fs');
const path = require('path');
const { getDb, paths: dbPaths } = require('./db');
const { GAME_KEYS: EVENT_GAME_KEYS } = require('./eventGames');

function defaultEventTypes() {
    return Object.fromEntries(EVENT_GAME_KEYS.map((k) => [k, true]));
}

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'guildConfig.json');

const guildConfigCache = new Map();
const guildConfigCacheTtlMs = 2000;

let migrated = false;

function defaultGuildConfig() {
    return {
        staffRoleIds: [],
        shortcuts: [],
        features: {
            events: true,
            forum: true,
            music: true,
            tickets: true,
            automod: true,
            replies: true,
            punishLog: true
        },
        reactionRoles: [],
        autoReplies: [],
        channelAutoReply: {
            channelId: null,
            embed: {
                title: '',
                description: '',
                color: '#E7D3B0'
            }
        },
        noMsgChannels: [],
        noImageChannels: [],
        levelingEnabled: true,
        levelUpChannelId: null,
        logs: {
            enabled: true,
            categories: {
                messages: true,
                moderation: true,
                roles: true,
                channels: true,
                guild: true,
                economy: true,
                tickets: true,
                suggestions: true
            }
        },
        logsChannelId: null,
        logsExcludeChannelId: null,
        suggestionsChannelId: null,
        suggestionsApprovedChannelId: null,
        renameForumChannelId: null,
        tickets: {
            panelChannelId: null,
            categoryId: null,
            archiveChannelId: null,
            types: [],
            activeChannelIds: [],
            noResponseWarnMs: 0,
            noResponseCloseMs: 0,
            inactivityCloseMs: 0
        },
        whispersChannelId: null,
        // Welcome messages for new members
        welcome: {
            enabled: false,
            channelId: null,
            title: 'أهلاً بك في السيرفر! 🌙',
            message: 'مرحباً {mention} 👋\nنورت السيرفر! اقرأ القوانين واستمتع بوقتك ✨',
            imageUrl: null,
            embed: true,
            ping: false,
            leaveEnabled: false,
            leaveChannelId: null,
            leaveTitle: 'ودّعنا السيرفر 👋',
            leaveMessage: 'ودّعنا {user} 🌙\nكان وجودك شرف، بالتوفيق دايمًا ✨',
            leaveImageUrl: null
        },
        // Multiple channel auto-reply embeds (each: { id, channelId, embed, lastMessageIds })
        channelAutoReplies: [],
        // Channels where *any* message gets the author banned (honeypot)
        honeypotChannelIds: [],
        // Daily random events + giveaways (V11.6)
        funEvents: {
            enabled: false,
            channelId: null,
            giveawayChannelId: null,
            roleId: null,
            intervalHours: 24,
            minEvents: 2,
            maxEvents: 5,
            nextAt: 0,
            prizePoints: 100,
            giveawayMinutes: 5,
            gifts: []
        },
        // Very rare spontaneous replies from Luna in one channel
        randomReply: {
            enabled: false,
            channelId: null,
            chancePct: 1,
            texts: []
        },
        // Channel where the public /mechanics panel lives (null = reply in place)
        mechanicsChannelId: null,
        rgbRole: {
            roleId: null,
            intervalMs: 0,
            nextAt: 0,
            hue: 0
        },
        ai: {
            enabled: false,
            allowedChannelId: null,
            baseUrl: 'http://192.168.10.165:11434',
            model: null,
            cooldownMs: 15000,
            memoryEnabled: false,
            memoryTtlMs: 2 * 60 * 60 * 1000
        },
        autoReactions: {
            channelId: null,
            emojis: []
        },
        lootboxes: {
            channelId: null,
            intervalMs: 0,
            durationMs: 0,
            nextAt: 0,
            activeMessageId: null,
            activeUntil: 0,
            openedBy: null
        },
        dailyTasks: {
            mediaChannelId: null,
            voiceChannelId: null
        },
        automod: {
            enabled: false,
            windowMs: 10_000,
            maxMessages: 12,
            maxLinks: 3,
            action: 'log',
            timeoutSeconds: 60,
            ignoreAdmins: true,
            ignoredRoleIds: [],
            ignoredChannelIds: [],
            joinInviteLogChannelId: null,
            rules: [],
            // Rule engine defaults
            rulesConfig: {
                linkWhitelist: [],
                maxMentions: 5,
                maxCapsPercent: 70,
                maxRepeats: 3,
                repeatWindowMs: 30000
            }
        },
        antiRaid: {
            enabled: false,
            verifyEnabled: false,
            retroMinutes: 5,
            joinWindowMs: 60_000,
            joinThreshold: 6,
            lockdownMs: 20 * 60_000,
            lockdownUntil: 0,
            verifyRoleId: null,
            verifyChannelId: null
        },
        events: {
            enabled: false,
            channelId: null,
            intervalMs: 0,
            durationMs: 0,
            rewardMin: 10,
            rewardMax: 50,
            winnersCount: 1,
            typesEnabled: defaultEventTypes(),
            nextAt: 0,
            active: null
        },
        shop: {
            announceEnabled: false,
            announceChannelId: null
        },
        backup: {
            dailyEnabled: false,
            retentionDays: 30
        },
        adminReport: {
            enabled: false,
            formChannelId: null,
            reportChannelId: null,
            reminderHour: -1,
            adminRoleIds: []
        },
        aiMod: {
            enabled: false,
            action: 'delete', // delete, timeout, ban
            timeoutMinutes: 10,
            threshold: 'medium', // low, medium, high
            logChannelId: null,
            ignoreChannelIds: [],
            ignoreRoleIds: []
        },
        punishLog: {
            enabled: false,
            forumChannelId: null,
            logChannelId: null,
            warningRoles: [],
            maxWarnings: 3,
            autoBanEnabled: false,
            banReason: 'تجاوز حد التحذيرات'
        },
        levelRewards: [],
        roleBoosts: []
    };
}

function normalizeConfig(cfg) {
    const out = (cfg && typeof cfg === 'object') ? { ...cfg } : defaultGuildConfig();
    let changed = false;

    if (!Array.isArray(out.staffRoleIds)) { out.staffRoleIds = []; changed = true; }
    if (!Array.isArray(out.shortcuts)) { out.shortcuts = []; changed = true; }
    out.shortcuts = out.shortcuts
        .filter((s) => s && typeof s === 'object' && !Array.isArray(s))
        .map((s) => ({
            trigger: typeof s.trigger === 'string' ? s.trigger.trim().toLowerCase() : '',
            command: typeof s.command === 'string' ? s.command.trim().toLowerCase() : ''
        }))
        .filter((s) => s.trigger && s.command)
        .slice(0, 100);

    out.staffRoleIds = out.staffRoleIds
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => /^\d+$/.test(s))
        .slice(0, 50);

    if (!out.features || typeof out.features !== 'object') {
        out.features = { ...defaultGuildConfig().features };
        changed = true;
    }
    for (const k of Object.keys(defaultGuildConfig().features)) {
        if (typeof out.features[k] !== 'boolean') {
            out.features[k] = true;
            changed = true;
        }
    }

    if (!Array.isArray(out.reactionRoles)) { out.reactionRoles = []; changed = true; }
    if (!Array.isArray(out.autoReplies)) { out.autoReplies = []; changed = true; }
    out.autoReplies = out.autoReplies
        .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
        .map((r) => {
            const trigger = typeof r.trigger === 'string' ? r.trigger.trim() : '';
            const response = typeof r.response === 'string' ? r.response : '';
            const mode = String(r.mode || '').trim().toLowerCase() === 'includes' ? 'includes' : 'exact';
            const allowUserIds = Array.isArray(r.allowUserIds) ? r.allowUserIds : (Array.isArray(r.allowedUserIds) ? r.allowedUserIds : []);
            const allowRoleIds = Array.isArray(r.allowRoleIds) ? r.allowRoleIds : (Array.isArray(r.allowedRoleIds) ? r.allowedRoleIds : []);
            return {
                trigger,
                response,
                mode,
                allowUserIds: allowUserIds.map(String).map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).slice(0, 50),
                allowRoleIds: allowRoleIds.map(String).map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).slice(0, 50)
            };
        })
        .filter((r) => r.trigger && typeof r.response === 'string')
        .slice(0, 200);

    if (!out.channelAutoReply || typeof out.channelAutoReply !== 'object') {
        out.channelAutoReply = defaultGuildConfig().channelAutoReply;
        changed = true;
    }
    if (typeof out.channelAutoReply.channelId !== 'string' && out.channelAutoReply.channelId !== null) {
        out.channelAutoReply.channelId = null;
        changed = true;
    }
    if (!out.channelAutoReply.embed || typeof out.channelAutoReply.embed !== 'object') {
        out.channelAutoReply.embed = defaultGuildConfig().channelAutoReply.embed;
        changed = true;
    }
    if (typeof out.channelAutoReply.embed.title !== 'string') { out.channelAutoReply.embed.title = ''; changed = true; }
    if (typeof out.channelAutoReply.embed.description !== 'string') { out.channelAutoReply.embed.description = ''; changed = true; }
    if (typeof out.channelAutoReply.embed.color !== 'string') { out.channelAutoReply.embed.color = '#E7D3B0'; changed = true; }
    if (!Array.isArray(out.noMsgChannels)) { out.noMsgChannels = []; changed = true; }
    if (!Array.isArray(out.noImageChannels)) { out.noImageChannels = []; changed = true; }
    if (typeof out.levelingEnabled !== 'boolean') { out.levelingEnabled = true; changed = true; }
    if (typeof out.levelUpChannelId !== 'string' && out.levelUpChannelId !== null) { out.levelUpChannelId = null; changed = true; }
    if (typeof out.logsChannelId !== 'string' && out.logsChannelId !== null) { out.logsChannelId = null; changed = true; }
    if (typeof out.logsExcludeChannelId !== 'string' && out.logsExcludeChannelId !== null) { out.logsExcludeChannelId = null; changed = true; }

    if (!out.logs || typeof out.logs !== 'object') {
        out.logs = defaultGuildConfig().logs;
        changed = true;
    }
    if (typeof out.logs.enabled !== 'boolean') {
        out.logs.enabled = true;
        changed = true;
    }
    if (!out.logs.categories || typeof out.logs.categories !== 'object') {
        out.logs.categories = { ...defaultGuildConfig().logs.categories };
        changed = true;
    }
    for (const k of Object.keys(defaultGuildConfig().logs.categories)) {
        if (typeof out.logs.categories[k] !== 'boolean') {
            out.logs.categories[k] = true;
            changed = true;
        }
    }

    if (out.logsChannelId && out.logs && typeof out.logs.enabled === 'boolean') {
        // Keep backward compatibility: if logs channel is set but logs.enabled is false (from older configs), re-enable.
        if (out.logs.enabled === false) {
            out.logs.enabled = true;
            changed = true;
        }
    }
    if (typeof out.suggestionsChannelId !== 'string' && out.suggestionsChannelId !== null) { out.suggestionsChannelId = null; changed = true; }
    if (typeof out.suggestionsApprovedChannelId !== 'string' && out.suggestionsApprovedChannelId !== null) { out.suggestionsApprovedChannelId = null; changed = true; }
    if (typeof out.renameForumChannelId !== 'string' && out.renameForumChannelId !== null) { out.renameForumChannelId = null; changed = true; }

    if (typeof out.whispersChannelId !== 'string' && out.whispersChannelId !== null) { out.whispersChannelId = null; changed = true; }

    // Welcome system — keep every field typed so the join handler never throws.
    {
        const base = defaultGuildConfig().welcome;
        const w = out.welcome && typeof out.welcome === 'object' && !Array.isArray(out.welcome)
            ? { ...out.welcome }
            : { ...base };
        if (typeof w.enabled !== 'boolean') { w.enabled = base.enabled; changed = true; }
        if (typeof w.channelId !== 'string' && w.channelId !== null) { w.channelId = null; changed = true; }
        if (typeof w.title !== 'string') { w.title = base.title; changed = true; }
        if (typeof w.message !== 'string') { w.message = base.message; changed = true; }
        if (typeof w.imageUrl !== 'string' && w.imageUrl !== null) { w.imageUrl = null; changed = true; }
        if (typeof w.embed !== 'boolean') { w.embed = base.embed; changed = true; }
        if (typeof w.ping !== 'boolean') { w.ping = base.ping; changed = true; }
        if (typeof w.leaveEnabled !== 'boolean') { w.leaveEnabled = base.leaveEnabled; changed = true; }
        if (typeof w.leaveChannelId !== 'string' && w.leaveChannelId !== null) { w.leaveChannelId = null; changed = true; }
        if (typeof w.leaveTitle !== 'string') { w.leaveTitle = base.leaveTitle; changed = true; }
        if (typeof w.leaveMessage !== 'string') { w.leaveMessage = base.leaveMessage; changed = true; }
        if (typeof w.leaveImageUrl !== 'string' && w.leaveImageUrl !== null) { w.leaveImageUrl = null; changed = true; }
        out.welcome = w;
    }

    // Multiple channel auto-replies. The legacy single `channelAutoReply` is
    // folded into the list so old configs keep working without a manual step.
    if (!Array.isArray(out.channelAutoReplies)) {
        out.channelAutoReplies = [];
        changed = true;
    } else {
        const before = out.channelAutoReplies.length;
        out.channelAutoReplies = out.channelAutoReplies.filter(
            (r) => r && typeof r === 'object' && typeof r.channelId === 'string' && /^\d{15,20}$/.test(r.channelId)
        );
        if (out.channelAutoReplies.length !== before) changed = true;
        for (const r of out.channelAutoReplies) {
            if (typeof r.id !== 'string' || !r.id) {
                r.id = `car_${Math.random().toString(36).slice(2, 10)}`;
                changed = true;
            }
            if (!r.embed || typeof r.embed !== 'object') { r.embed = {}; changed = true; }
            if (!Array.isArray(r.lastMessageIds)) { r.lastMessageIds = []; changed = true; }
        }
    }

    if (!Array.isArray(out.honeypotChannelIds)) { out.honeypotChannelIds = []; changed = true; }
    if (typeof out.mechanicsChannelId !== 'string' && out.mechanicsChannelId !== null) { out.mechanicsChannelId = null; changed = true; }

    {
        const base = defaultGuildConfig().funEvents;
        const f = out.funEvents && typeof out.funEvents === 'object' && !Array.isArray(out.funEvents)
            ? { ...out.funEvents }
            : { ...base };
        for (const k of ['channelId', 'giveawayChannelId', 'roleId']) {
            if (typeof f[k] !== 'string' && f[k] !== null) { f[k] = null; changed = true; }
        }
        if (typeof f.enabled !== 'boolean') { f.enabled = base.enabled; changed = true; }
        if (typeof f.intervalHours !== 'number' || Number.isNaN(f.intervalHours)) { f.intervalHours = base.intervalHours; changed = true; }
        if (typeof f.minEvents !== 'number' || Number.isNaN(f.minEvents)) { f.minEvents = base.minEvents; changed = true; }
        if (typeof f.maxEvents !== 'number' || Number.isNaN(f.maxEvents)) { f.maxEvents = base.maxEvents; changed = true; }
        if (typeof f.nextAt !== 'number' || Number.isNaN(f.nextAt)) { f.nextAt = 0; changed = true; }
        if (typeof f.prizePoints !== 'number' || Number.isNaN(f.prizePoints)) { f.prizePoints = base.prizePoints; changed = true; }
        if (typeof f.giveawayMinutes !== 'number' || Number.isNaN(f.giveawayMinutes)) { f.giveawayMinutes = base.giveawayMinutes; changed = true; }
        const giftKeys = ['xp_potion', 'points_potion', 'levelup_potion', 'points', 'coupon', 'generous_xp', 'rune'];
        if (!Array.isArray(f.gifts)) { f.gifts = []; changed = true; }
        const normalizedGifts = [];
        for (const g of f.gifts) {
            let key = typeof g === 'string' ? g : (g && (g.key || g.name));
            if (giftKeys.includes(key) && !normalizedGifts.includes(key)) normalizedGifts.push(key);
        }
        if (normalizedGifts.length !== f.gifts.length) changed = true;
        f.gifts = normalizedGifts;
        out.funEvents = f;
    }

    {
        const base = defaultGuildConfig().randomReply;
        const r = out.randomReply && typeof out.randomReply === 'object' && !Array.isArray(out.randomReply)
            ? { ...out.randomReply }
            : { ...base };
        if (typeof r.enabled !== 'boolean') { r.enabled = base.enabled; changed = true; }
        if (typeof r.channelId !== 'string' && r.channelId !== null) { r.channelId = null; changed = true; }
        if (typeof r.chancePct !== 'number' || Number.isNaN(r.chancePct)) { r.chancePct = base.chancePct; changed = true; }
        if (!Array.isArray(r.texts)) { r.texts = []; changed = true; }
        out.randomReply = r;
    }

    // Fold the legacy single channel auto-reply into the list (once).
    const legacyCar = out.channelAutoReply;
    if (
        out.channelAutoReplies.length === 0 &&
        legacyCar && typeof legacyCar === 'object' &&
        typeof legacyCar.channelId === 'string' && /^\d{15,20}$/.test(legacyCar.channelId)
    ) {
        out.channelAutoReplies.push({
            id: `car_${Math.random().toString(36).slice(2, 10)}`,
            channelId: legacyCar.channelId,
            embed: legacyCar.embed && typeof legacyCar.embed === 'object' ? { ...legacyCar.embed } : {},
            lastMessageIds: []
        });
        changed = true;
    }

    if (!out.rgbRole || typeof out.rgbRole !== 'object') {
        out.rgbRole = { roleId: null, intervalMs: 0, nextAt: 0, hue: 0 };
        changed = true;
    }
    if (typeof out.rgbRole.roleId !== 'string' && out.rgbRole.roleId !== null) { out.rgbRole.roleId = null; changed = true; }
    if (typeof out.rgbRole.intervalMs !== 'number' || Number.isNaN(out.rgbRole.intervalMs)) { out.rgbRole.intervalMs = 0; changed = true; }
    if (typeof out.rgbRole.nextAt !== 'number' || Number.isNaN(out.rgbRole.nextAt)) { out.rgbRole.nextAt = 0; changed = true; }
    if (typeof out.rgbRole.hue !== 'number' || Number.isNaN(out.rgbRole.hue)) { out.rgbRole.hue = 0; changed = true; }

    if (!out.ai || typeof out.ai !== 'object') {
        out.ai = { enabled: false, allowedChannelId: null, baseUrl: null, model: null, cooldownMs: 15000, memoryEnabled: false, memoryTtlMs: 2 * 60 * 60 * 1000 };
        changed = true;
    }
    if (typeof out.ai.enabled !== 'boolean') { out.ai.enabled = false; changed = true; }
    if (typeof out.ai.allowedChannelId !== 'string' && out.ai.allowedChannelId !== null) { out.ai.allowedChannelId = null; changed = true; }
    if (typeof out.ai.baseUrl !== 'string' && out.ai.baseUrl !== null) { out.ai.baseUrl = null; changed = true; }
    if (typeof out.ai.model !== 'string' && out.ai.model !== null) { out.ai.model = null; changed = true; }
    if (typeof out.ai.cooldownMs !== 'number' || Number.isNaN(out.ai.cooldownMs)) { out.ai.cooldownMs = 15000; changed = true; }
    if (typeof out.ai.memoryEnabled !== 'boolean') { out.ai.memoryEnabled = false; changed = true; }
    if (typeof out.ai.memoryTtlMs !== 'number' || Number.isNaN(out.ai.memoryTtlMs)) { out.ai.memoryTtlMs = 2 * 60 * 60 * 1000; changed = true; }
    out.ai.memoryTtlMs = Math.max(0, Math.floor(out.ai.memoryTtlMs || 0));

    if (!out.autoReactions || typeof out.autoReactions !== 'object') {
        out.autoReactions = { channelId: null, emojis: [] };
        changed = true;
    }
    if (typeof out.autoReactions.channelId !== 'string' && out.autoReactions.channelId !== null) { out.autoReactions.channelId = null; changed = true; }
    if (!Array.isArray(out.autoReactions.emojis)) { out.autoReactions.emojis = []; changed = true; }
    out.autoReactions.emojis = out.autoReactions.emojis.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 10);

    if (!out.lootboxes || typeof out.lootboxes !== 'object') {
        out.lootboxes = { channelId: null, intervalMs: 0, durationMs: 0, nextAt: 0, activeMessageId: null, activeUntil: 0, openedBy: null };
        changed = true;
    }
    if (typeof out.lootboxes.channelId !== 'string' && out.lootboxes.channelId !== null) { out.lootboxes.channelId = null; changed = true; }
    if (typeof out.lootboxes.intervalMs !== 'number' || Number.isNaN(out.lootboxes.intervalMs)) { out.lootboxes.intervalMs = 0; changed = true; }
    if (typeof out.lootboxes.durationMs !== 'number' || Number.isNaN(out.lootboxes.durationMs)) { out.lootboxes.durationMs = 0; changed = true; }
    if (typeof out.lootboxes.nextAt !== 'number' || Number.isNaN(out.lootboxes.nextAt)) { out.lootboxes.nextAt = 0; changed = true; }
    if (typeof out.lootboxes.activeMessageId !== 'string' && out.lootboxes.activeMessageId !== null) { out.lootboxes.activeMessageId = null; changed = true; }
    if (typeof out.lootboxes.activeUntil !== 'number' || Number.isNaN(out.lootboxes.activeUntil)) { out.lootboxes.activeUntil = 0; changed = true; }
    if (typeof out.lootboxes.openedBy !== 'string' && out.lootboxes.openedBy !== null) { out.lootboxes.openedBy = null; changed = true; }

    if (!out.dailyTasks || typeof out.dailyTasks !== 'object') {
        out.dailyTasks = { mediaChannelId: null, voiceChannelId: null };
        changed = true;
    }
    if (typeof out.dailyTasks.mediaChannelId !== 'string' && out.dailyTasks.mediaChannelId !== null) { out.dailyTasks.mediaChannelId = null; changed = true; }
    if (typeof out.dailyTasks.voiceChannelId !== 'string' && out.dailyTasks.voiceChannelId !== null) { out.dailyTasks.voiceChannelId = null; changed = true; }

    if (!out.automod || typeof out.automod !== 'object') {
        out.automod = defaultGuildConfig().automod;
        changed = true;
    }
    if (typeof out.automod.enabled !== 'boolean') { out.automod.enabled = false; changed = true; }
    if (typeof out.automod.windowMs !== 'number' || Number.isNaN(out.automod.windowMs)) { out.automod.windowMs = 10_000; changed = true; }
    if (typeof out.automod.maxMessages !== 'number' || Number.isNaN(out.automod.maxMessages)) { out.automod.maxMessages = 12; changed = true; }
    if (typeof out.automod.maxLinks !== 'number' || Number.isNaN(out.automod.maxLinks)) { out.automod.maxLinks = 3; changed = true; }
    if (typeof out.automod.action !== 'string') { out.automod.action = 'log'; changed = true; }
    if (typeof out.automod.timeoutSeconds !== 'number' || Number.isNaN(out.automod.timeoutSeconds)) { out.automod.timeoutSeconds = 60; changed = true; }
    if (typeof out.automod.ignoreAdmins !== 'boolean') { out.automod.ignoreAdmins = true; changed = true; }
    if (!Array.isArray(out.automod.ignoredRoleIds)) { out.automod.ignoredRoleIds = []; changed = true; }
    if (!Array.isArray(out.automod.ignoredChannelIds)) { out.automod.ignoredChannelIds = []; changed = true; }
    if (typeof out.automod.joinInviteLogChannelId !== 'string' && out.automod.joinInviteLogChannelId !== null) {
        out.automod.joinInviteLogChannelId = null;
        changed = true;
    }
    if (!Array.isArray(out.automod.rules)) { out.automod.rules = []; changed = true; }

    out.automod.windowMs = Math.max(1000, Math.min(60_000, Math.floor(out.automod.windowMs || 0)));
    out.automod.maxMessages = Math.max(1, Math.min(50, Math.floor(out.automod.maxMessages || 0)));
    out.automod.maxLinks = Math.max(0, Math.min(20, Math.floor(out.automod.maxLinks || 0)));
    out.automod.timeoutSeconds = Math.max(0, Math.min(60 * 60 * 24 * 7, Math.floor(out.automod.timeoutSeconds || 0)));
    out.automod.ignoredRoleIds = out.automod.ignoredRoleIds.map(String).map((s) => s.trim()).filter(Boolean).filter((s) => /^\d+$/.test(s)).slice(0, 30);
    out.automod.ignoredChannelIds = out.automod.ignoredChannelIds.map(String).map((s) => s.trim()).filter(Boolean).filter((s) => /^\d+$/.test(s)).slice(0, 30);
    out.automod.rules = out.automod.rules
        .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
        .slice(0, 50);

    // Normalize rulesConfig
    if (!out.automod.rulesConfig || typeof out.automod.rulesConfig !== 'object') {
        out.automod.rulesConfig = defaultGuildConfig().automod.rulesConfig;
        changed = true;
    }
    const rc = out.automod.rulesConfig;
    if (!Array.isArray(rc.linkWhitelist)) {
        rc.linkWhitelist = [];
        changed = true;
    }
    rc.linkWhitelist = rc.linkWhitelist.filter((s) => typeof s === 'string' && s.length > 0).slice(0, 50);
    if (typeof rc.maxMentions !== 'number' || rc.maxMentions < 0) {
        rc.maxMentions = 5;
        changed = true;
    }
    if (typeof rc.maxCapsPercent !== 'number' || rc.maxCapsPercent < 0 || rc.maxCapsPercent > 100) {
        rc.maxCapsPercent = 70;
        changed = true;
    }
    if (typeof rc.maxRepeats !== 'number' || rc.maxRepeats < 0) {
        rc.maxRepeats = 3;
        changed = true;
    }
    if (typeof rc.repeatWindowMs !== 'number' || rc.repeatWindowMs < 1000) {
        rc.repeatWindowMs = 30000;
        changed = true;
    }

    // Normalize adminReport settings
    if (!out.adminReport || typeof out.adminReport !== 'object') {
        out.adminReport = { enabled: false, formChannelId: null, reportChannelId: null, reminderHour: -1 };
        changed = true;
    }
    if (typeof out.adminReport.enabled !== 'boolean') {
        out.adminReport.enabled = false;
        changed = true;
    }
    if (typeof out.adminReport.formChannelId !== 'string' && out.adminReport.formChannelId !== null) {
        out.adminReport.formChannelId = null;
        changed = true;
    }
    if (typeof out.adminReport.reportChannelId !== 'string' && out.adminReport.reportChannelId !== null) {
        out.adminReport.reportChannelId = null;
        changed = true;
    }
    if (typeof out.adminReport.reminderHour !== 'number') {
        out.adminReport.reminderHour = -1;
        changed = true;
    }
    out.adminReport.reminderHour = Math.max(-1, Math.min(23, Math.floor(out.adminReport.reminderHour)));
    if (!Array.isArray(out.adminReport.adminRoleIds)) { out.adminReport.adminRoleIds = []; changed = true; }
    out.adminReport.adminRoleIds = out.adminReport.adminRoleIds.map(String).filter(s => /^\d+$/.test(s)).slice(0, 20);

    // Normalize aiMod settings
    if (!out.aiMod || typeof out.aiMod !== 'object') {
        out.aiMod = { enabled: false, action: 'delete', timeoutMinutes: 10, threshold: 'medium', logChannelId: null, ignoreChannelIds: [], ignoreRoleIds: [] };
        changed = true;
    }
    if (typeof out.aiMod.enabled !== 'boolean') { out.aiMod.enabled = false; changed = true; }
    if (!['delete', 'timeout', 'ban'].includes(out.aiMod.action)) { out.aiMod.action = 'delete'; changed = true; }
    if (typeof out.aiMod.timeoutMinutes !== 'number' || out.aiMod.timeoutMinutes < 1) { out.aiMod.timeoutMinutes = 10; changed = true; }
    if (!['low', 'medium', 'high'].includes(out.aiMod.threshold)) { out.aiMod.threshold = 'medium'; changed = true; }
    if (typeof out.aiMod.logChannelId !== 'string' && out.aiMod.logChannelId !== null) { out.aiMod.logChannelId = null; changed = true; }
    if (!Array.isArray(out.aiMod.ignoreChannelIds)) { out.aiMod.ignoreChannelIds = []; changed = true; }
    if (!Array.isArray(out.aiMod.ignoreRoleIds)) { out.aiMod.ignoreRoleIds = []; changed = true; }

    if (!['log', 'delete', 'timeout', 'delete_timeout'].includes(out.automod.action)) {
        out.automod.action = 'log';
        changed = true;
    }

    if (!out.antiRaid || typeof out.antiRaid !== 'object') {
        out.antiRaid = defaultGuildConfig().antiRaid;
        changed = true;
    }
    if (typeof out.antiRaid.enabled !== 'boolean') { out.antiRaid.enabled = false; changed = true; }
    if (typeof out.antiRaid.verifyEnabled !== 'boolean') { out.antiRaid.verifyEnabled = false; changed = true; }
    if (typeof out.antiRaid.retroMinutes !== 'number' || Number.isNaN(out.antiRaid.retroMinutes)) { out.antiRaid.retroMinutes = 5; changed = true; }
    if (typeof out.antiRaid.joinWindowMs !== 'number' || Number.isNaN(out.antiRaid.joinWindowMs)) { out.antiRaid.joinWindowMs = 60_000; changed = true; }
    if (typeof out.antiRaid.joinThreshold !== 'number' || Number.isNaN(out.antiRaid.joinThreshold)) { out.antiRaid.joinThreshold = 6; changed = true; }
    if (typeof out.antiRaid.lockdownMs !== 'number' || Number.isNaN(out.antiRaid.lockdownMs)) { out.antiRaid.lockdownMs = 20 * 60_000; changed = true; }
    if (typeof out.antiRaid.lockdownUntil !== 'number' || Number.isNaN(out.antiRaid.lockdownUntil)) { out.antiRaid.lockdownUntil = 0; changed = true; }
    if (typeof out.antiRaid.verifyRoleId !== 'string' && out.antiRaid.verifyRoleId !== null) { out.antiRaid.verifyRoleId = null; changed = true; }
    if (typeof out.antiRaid.verifyChannelId !== 'string' && out.antiRaid.verifyChannelId !== null) { out.antiRaid.verifyChannelId = null; changed = true; }

    out.antiRaid.joinWindowMs = Math.max(10_000, Math.min(10 * 60_000, Math.floor(out.antiRaid.joinWindowMs || 0)));
    out.antiRaid.joinThreshold = Math.max(2, Math.min(50, Math.floor(out.antiRaid.joinThreshold || 0)));
    out.antiRaid.lockdownMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Math.floor(out.antiRaid.lockdownMs || 0)));
    out.antiRaid.lockdownUntil = Math.max(0, Math.floor(out.antiRaid.lockdownUntil || 0));
    out.antiRaid.retroMinutes = Math.max(0, Math.min(120, Math.floor(out.antiRaid.retroMinutes || 0)));

    // Normalize punishLog settings
    if (!out.punishLog || typeof out.punishLog !== 'object') {
        out.punishLog = { enabled: false, forumChannelId: null, logChannelId: null, warningRoles: [], maxWarnings: 3, autoBanEnabled: false, banReason: 'تجاوز حد التحذيرات' };
        changed = true;
    }
    if (typeof out.punishLog.enabled !== 'boolean') { out.punishLog.enabled = false; changed = true; }
    if (typeof out.punishLog.forumChannelId !== 'string' && out.punishLog.forumChannelId !== null) { out.punishLog.forumChannelId = null; changed = true; }
    if (typeof out.punishLog.logChannelId !== 'string' && out.punishLog.logChannelId !== null) { out.punishLog.logChannelId = null; changed = true; }
    if (!Array.isArray(out.punishLog.warningRoles)) {
        // Convert old warningRoleIds to new format
        const oldRoleIds = Array.isArray(out.punishLog.warningRoleIds) ? out.punishLog.warningRoleIds : [];
        out.punishLog.warningRoles = oldRoleIds.map(roleId => ({ roleId: String(roleId), durationMs: 0 }));
        changed = true;
    }
    if (typeof out.punishLog.maxWarnings !== 'number' || out.punishLog.maxWarnings < 0) { out.punishLog.maxWarnings = 3; changed = true; }
    if (typeof out.punishLog.autoBanEnabled !== 'boolean') { out.punishLog.autoBanEnabled = false; changed = true; }
    if (typeof out.punishLog.banReason !== 'string' || !out.punishLog.banReason.trim()) { out.punishLog.banReason = 'تجاوز حد التحذيرات'; changed = true; }
    // Normalize warningRoles array
    out.punishLog.warningRoles = out.punishLog.warningRoles.filter(r => r && typeof r === 'object' && r.roleId).map(r => ({
        roleId: String(r.roleId).trim(),
        durationMs: Math.max(0, Math.floor(Number(r.durationMs) || 0))
    })).slice(0, 10);
    out.punishLog.maxWarnings = Math.max(0, Math.min(100, Math.floor(out.punishLog.maxWarnings)));

    if (!out.events || typeof out.events !== 'object') {
        out.events = defaultGuildConfig().events;
        changed = true;
    }
    if (typeof out.events.enabled !== 'boolean') { out.events.enabled = false; changed = true; }
    if (typeof out.events.channelId !== 'string' && out.events.channelId !== null) { out.events.channelId = null; changed = true; }
    if (typeof out.events.intervalMs !== 'number' || Number.isNaN(out.events.intervalMs)) { out.events.intervalMs = 0; changed = true; }
    if (typeof out.events.durationMs !== 'number' || Number.isNaN(out.events.durationMs)) { out.events.durationMs = 0; changed = true; }
    if (typeof out.events.rewardMin !== 'number' || Number.isNaN(out.events.rewardMin)) { out.events.rewardMin = 10; changed = true; }
    if (typeof out.events.rewardMax !== 'number' || Number.isNaN(out.events.rewardMax)) { out.events.rewardMax = 50; changed = true; }
    if (typeof out.events.winnersCount !== 'number' || Number.isNaN(out.events.winnersCount)) { out.events.winnersCount = 1; changed = true; }
    if (!out.events.typesEnabled || typeof out.events.typesEnabled !== 'object') {
        out.events.typesEnabled = defaultEventTypes();
        changed = true;
    }
    for (const k of EVENT_GAME_KEYS) {
        if (typeof out.events.typesEnabled[k] !== 'boolean') { out.events.typesEnabled[k] = true; changed = true; }
    }
    if (typeof out.events.nextAt !== 'number' || Number.isNaN(out.events.nextAt)) { out.events.nextAt = 0; changed = true; }
    if (out.events.active !== null && (typeof out.events.active !== 'object' || Array.isArray(out.events.active))) { out.events.active = null; changed = true; }

    out.events.intervalMs = Math.max(0, Math.floor(out.events.intervalMs || 0));
    out.events.durationMs = Math.max(0, Math.floor(out.events.durationMs || 0));
    out.events.rewardMin = Math.max(0, Math.floor(out.events.rewardMin || 0));
    out.events.rewardMax = Math.max(out.events.rewardMin, Math.floor(out.events.rewardMax || 0));
    out.events.winnersCount = Math.max(1, Math.min(20, Math.floor(out.events.winnersCount || 1)));

    if (!out.tickets || typeof out.tickets !== 'object') {
        out.tickets = { panelChannelId: null, categoryId: null, archiveChannelId: null, types: [], activeChannelIds: [], noResponseWarnMs: 0, noResponseCloseMs: 0, inactivityCloseMs: 0 };
        changed = true;
    }
    if (typeof out.tickets.panelChannelId !== 'string' && out.tickets.panelChannelId !== null) { out.tickets.panelChannelId = null; changed = true; }
    if (typeof out.tickets.categoryId !== 'string' && out.tickets.categoryId !== null) { out.tickets.categoryId = null; changed = true; }
    if (typeof out.tickets.archiveChannelId !== 'string' && out.tickets.archiveChannelId !== null) { out.tickets.archiveChannelId = null; changed = true; }
    if (!Array.isArray(out.tickets.types)) { out.tickets.types = []; changed = true; }

    if (!Array.isArray(out.tickets.activeChannelIds)) { out.tickets.activeChannelIds = []; changed = true; }
    if (typeof out.tickets.noResponseWarnMs !== 'number' || Number.isNaN(out.tickets.noResponseWarnMs)) { out.tickets.noResponseWarnMs = 0; changed = true; }
    if (typeof out.tickets.noResponseCloseMs !== 'number' || Number.isNaN(out.tickets.noResponseCloseMs)) { out.tickets.noResponseCloseMs = 0; changed = true; }
    if (typeof out.tickets.inactivityCloseMs !== 'number' || Number.isNaN(out.tickets.inactivityCloseMs)) { out.tickets.inactivityCloseMs = 0; changed = true; }

    out.tickets.activeChannelIds = out.tickets.activeChannelIds
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => /^\d+$/.test(s))
        .slice(0, 500);
    out.tickets.noResponseWarnMs = Math.max(0, Math.floor(out.tickets.noResponseWarnMs || 0));
    out.tickets.noResponseCloseMs = Math.max(0, Math.floor(out.tickets.noResponseCloseMs || 0));
    out.tickets.inactivityCloseMs = Math.max(0, Math.floor(out.tickets.inactivityCloseMs || 0));

    // Normalize shop announcements
    if (!out.shop || typeof out.shop !== 'object') {
        out.shop = { announceEnabled: false, announceChannelId: null };
        changed = true;
    }
    if (typeof out.shop.announceEnabled !== 'boolean') {
        out.shop.announceEnabled = false;
        changed = true;
    }
    if (out.shop.announceChannelId !== null && typeof out.shop.announceChannelId !== 'string') {
        out.shop.announceChannelId = null;
        changed = true;
    }
    if (out.shop.announceChannelId && !/^\d{17,20}$/.test(String(out.shop.announceChannelId))) {
        out.shop.announceChannelId = null;
        changed = true;
    }

    // Normalize backup settings
    if (!out.backup || typeof out.backup !== 'object') {
        out.backup = { dailyEnabled: false, retentionDays: 30 };
        changed = true;
    }
    if (typeof out.backup.dailyEnabled !== 'boolean') {
        out.backup.dailyEnabled = false;
        changed = true;
    }
    if (typeof out.backup.retentionDays !== 'number' || out.backup.retentionDays < 0) {
        out.backup.retentionDays = 30;
        changed = true;
    }

    if (!Array.isArray(out.levelRewards)) { out.levelRewards = []; changed = true; }
    out.levelRewards = out.levelRewards
        .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
        .map((r) => ({
            id: typeof r.id === 'string' ? r.id : String(Math.random().toString(36).slice(2, 10)),
            level: Math.max(1, Math.floor(Number(r.level) || 0)),
            type: String(r.type || 'luna_points').trim(),
            multiplier: Math.max(1, Number(r.multiplier) || 1.25),
            value: typeof r.value === 'string' ? r.value.trim() : '',
            label: typeof r.label === 'string' ? r.label.trim().slice(0, 100) : '',
            durationMs: Math.max(0, Math.floor(Number(r.durationMs) || 0))
        }))
        .filter((r) => r.level > 0 && r.type && r.label)
        .slice(0, 50);

    if (!Array.isArray(out.roleBoosts)) { out.roleBoosts = []; changed = true; }
    out.roleBoosts = out.roleBoosts
        .filter((r) => r && typeof r === 'object' && !Array.isArray(r) && r.roleId && r.type)
        .map((r) => ({
            roleId: String(r.roleId).trim(),
            type: String(r.type || 'xp_boost').trim(),
            multiplier: Math.max(1, Number(r.multiplier) || 1.25)
        }))
        .filter((r) => r.roleId && r.type && r.multiplier > 1);

    return { cfg: out, changed };
}

function migrateFromJsonIfNeeded() {
    if (migrated) return;

    const db = getDb();

    let hasAny = false;
    try {
        const row = db.prepare('SELECT 1 FROM guild_config LIMIT 1').get();
        hasAny = !!row;
    } catch {
        hasAny = false;
    }
    if (hasAny) {
        migrated = true;
        return;
    }

    if (!fs.existsSync(dataFile)) {
        migrated = true;
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    } catch (err) {
        console.error('[guildConfig] Failed to read/parse guildConfig.json for migration, will retry later:', err);
        return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.guilds || typeof parsed.guilds !== 'object') {
        migrated = true;
        return;
    }

    const now = Date.now();
    const insert = db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, value_json, updated_at) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
        for (const [guildId, cfg] of Object.entries(parsed.guilds)) {
            const normalized = normalizeConfig(cfg).cfg;
            insert.run(String(guildId), JSON.stringify(normalized), now);
        }
    });
    try {
        tx();
        migrated = true;
    } catch (err) {
        // Leave migrated = false so a later call retries; the transaction rolled back.
        console.error('[guildConfig] JSON→SQLite migration failed, will retry later:', err);
    }
}

function getGuildConfig(guildId) {
    migrateFromJsonIfNeeded();

    const id = String(guildId);
    const cached = guildConfigCache.get(id);
    if (cached && cached.expiresAt && Date.now() < cached.expiresAt && cached.value) {
        return cached.value;
    }

    const db = getDb();

    const row = db.prepare('SELECT value_json FROM guild_config WHERE guild_id = ?').get(id);
    if (!row) {
        const base = defaultGuildConfig();
        db.prepare('INSERT INTO guild_config (guild_id, value_json, updated_at) VALUES (?, ?, ?)')
            .run(id, JSON.stringify(base), Date.now());
        guildConfigCache.set(id, { value: base, expiresAt: Date.now() + guildConfigCacheTtlMs });
        return base;
    }

    let parsed;
    try {
        parsed = JSON.parse(row.value_json);
    } catch {
        parsed = defaultGuildConfig();
    }

    const normalized = normalizeConfig(parsed);
    if (normalized.changed) {
        db.prepare('UPDATE guild_config SET value_json = ?, updated_at = ? WHERE guild_id = ?')
            .run(JSON.stringify(normalized.cfg), Date.now(), id);
    }
    guildConfigCache.set(id, { value: normalized.cfg, expiresAt: Date.now() + guildConfigCacheTtlMs });
    return normalized.cfg;
}

function updateGuildConfig(guildId, updater) {
    migrateFromJsonIfNeeded();

    const db = getDb();
    const id = String(guildId);

    const current = getGuildConfig(id);
    const nextRaw = updater({ ...current }) || current;
    const normalized = normalizeConfig(nextRaw).cfg;

    db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, value_json, updated_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(normalized), Date.now());

    guildConfigCache.set(id, { value: normalized, expiresAt: Date.now() + guildConfigCacheTtlMs });
    return normalized;
}

function emojiKeyFromString(input) {
    const trimmed = (input || '').trim();
    const customMatch = trimmed.match(/^(?:<a?:\w+:(\d+)>|:(\w+):(\d+))$/);
    if (customMatch) {
        return customMatch[1] || customMatch[3];
    }

    if (/^\d+$/.test(trimmed)) return trimmed;
    return trimmed;
}

function emojiKeyFromReaction(reaction) {
    if (reaction.emoji && reaction.emoji.id) return reaction.emoji.id;
    return reaction.emoji && reaction.emoji.name ? reaction.emoji.name : '';
}

function getAllGuildConfigs() {
    migrateFromJsonIfNeeded();

    const db = getDb();
    const rows = db.prepare('SELECT guild_id, value_json FROM guild_config').all();
    const result = {};
    for (const row of rows) {
        let parsed;
        try {
            parsed = JSON.parse(row.value_json);
        } catch {
            parsed = defaultGuildConfig();
        }
        result[row.guild_id] = normalizeConfig(parsed).cfg;
    }
    return result;
}

module.exports = {
    getGuildConfig,
    updateGuildConfig,
    getAllGuildConfigs,
    emojiKeyFromString,
    emojiKeyFromReaction,
    _paths: { dataFile, dbFile: dbPaths.dbFile }
};
