// V11.6 — daily random fun events, competitive trivia and giveaways.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('./guildConfig');
const { addLunaPoints, updateUserStats } = require('./levelsStore');
const { getUserInventory, updateUserInventory } = require('./shopStore');
const { getGuildShop, updateGuildShop } = require('./shopStore');
const { processXpGain } = require('./levelUpService');
const { generateRuneDrop } = require('./runes');
const { getTriviaPool, BACCALAUREATE_MATH_BANK } = require('./eventGames');

const active = new Map(); // eventId -> state
const roundLocks = new Set(); // guild ids with a round in progress
let schedulerStarted = false;

const TRIVIA = [
    { q: 'كم عدد الكواكب في المجموعة الشمسية؟', a: ['8', '9'], wrong: ['7', '10'] },
    { q: 'ما هو أكبر محيط في العالم؟', a: ['المحيط الهادئ'], wrong: ['الأطلسي', 'الهندي'] },
    { q: 'كم لون في قوس قزح؟', a: ['7'], wrong: ['5', '9'] },
    { q: 'ما أسرع حيوان على اليابسة؟', a: ['الفهد'], wrong: ['الأسد', 'الغزال'] }
];

const GIFT_TYPES = {
    xp_potion:       { name: '⚡ بوست خبرة +25% (ساعة)', rarity: 'uncommon' },
    points_potion:   { name: '💰 بوست نقاط لونا +25% (ساعة)', rarity: 'uncommon' },
    levelup_potion:  { name: '🏅 بوست مكافأة ترفيع +50% (ساعة)', rarity: 'rare' },
    points:          { name: '🌙 نقاط لونا', rarity: 'common' },
    coupon:          { name: '🎟️ كوبون خصم 15% بالمتجر', rarity: 'rare' },
    generous_xp:     { name: '✨ خبرة سخية', rarity: 'rare' },
    rune:            { name: '🔮 رونة عشوائية', rarity: 'epic' }
};
const RARITY_WEIGHT = { common: 60, uncommon: 30, rare: 10, epic: 4, legendary: 1 };

function pickWeighted(gifts) {
    const list = (Array.isArray(gifts) ? gifts : []).map((k) => (typeof k === 'string' ? k : (k && (k.key || k.name))));
    const keys = list.filter((k) => GIFT_TYPES[k]);
    if (!keys.length) return null;
    const pool = [];
    for (const key of keys) {
        const w = RARITY_WEIGHT[GIFT_TYPES[key].rarity] || 10;
        for (let i = 0; i < w; i++) pool.push(key);
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
}

// Actually grant the chosen gift. Returns a short human-readable line.
async function applyGift(guildId, userId, key, prize) {
    const info = GIFT_TYPES[key];
    if (!info) return '';
    const now = Date.now();
    if (key === 'xp_potion' || key === 'points_potion' || key === 'levelup_potion') {
        const type = key === 'xp_potion' ? 'xp_boost_25_1h'
            : key === 'points_potion' ? 'luna_boost_25_1h' : 'levelup_reward_boost_50_1h';
        updateUserInventory(guildId, userId, (inv) => {
            const next = { ...inv };
            next.activeBoosts = Array.isArray(next.activeBoosts) ? [...next.activeBoosts] : [];
            next.activeBoosts.push({ type, acquiredAt: now, expiresAt: now + 60 * 60 * 1000 });
            return next;
        });
        return info.name;
    }
    if (key === 'points') {
        addLunaPoints(guildId, userId, Number(prize) || 100);
        return `${info.name} (${Number(prize) || 100})`;
    }
    if (key === 'coupon') {
        const code = `FUN${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        updateGuildShop(guildId, (s) => {
            const next = { ...s };
            next.coupons = next.coupons && typeof next.coupons === 'object' ? { ...next.coupons } : {};
            next.coupons[code] = { percent: 15, maxUses: 1, used: 0, createdAt: now, expiresAt: now + 7 * 86400000 };
            return next;
        });
        return `🎟️ كود **${code}** — خصم 15% لمرة واحدة`;
    }
    if (key === 'generous_xp') {
        const amount = Math.max(100, Number(prize) || 100) * 5;
        try { processXpGain(guildId, userId, amount); } catch { /* ignore */ }
        return `${info.name} (+${amount} XP)`;
    }
    if (key === 'rune') {
        const runes = generateRuneDrop(1);
        updateUserInventory(guildId, userId, (inv) => {
            const next = { ...inv };
            next.runes = Array.isArray(next.runes) ? [...next.runes] : [];
            next.runes.push(...runes);
            return next;
        });
        return `${info.name} ×${runes.length}`;
    }
    return '';
}

function buildEventEmbed(state) {
    const e = new EmbedBuilder()
        .setColor('#B28DDE')
        .setTitle(state.type === 'giveaway' ? '🎉 جيف أواي!' : '🧠 تحدّي لونا')
        .setDescription(state.description)
        .setFooter({
            text: state.roundTotal
                ? `الفعالية ${state.roundIndex}/${state.roundTotal} • ${state.type === 'giveaway' ? 'اضغط مشاركة' : 'أول إجابة صحيحة تفوز'}`
                : (state.type === 'giveaway' ? 'اضغط مشاركة' : 'أول إجابة صحيحة تفوز')
        })
        .setTimestamp();
    if (state.gift && GIFT_TYPES[state.gift]) {
        const gi = GIFT_TYPES[state.gift];
        e.addFields({ name: '🎁 الهدية', value: `${gi.name} (${gi.rarity})`, inline: false });
    }
    if (state.type === 'giveaway') e.addFields({ name: '👥 المشاركون', value: String(state.entrants.size), inline: true });
    return e;
}

async function award(guildId, userId, state) {
    // Points are always awarded. Gifts are an extra random bonus on top.
    const base = Number(state.prize) || 0;
    try { addLunaPoints(guildId, userId, base); } catch { /* ignore */ }
    const giftLine = state.gift ? await applyGift(guildId, userId, state.gift, base) : '';
    return [`${base} Luna Points`, giftLine].filter(Boolean).join(' + ');
}

async function finish(state, winnerId) {
    if (!state || state.finished) return;
    state.finished = true;
    active.delete(state.id);
    if (typeof state._resolveDone === 'function') state._resolveDone();
    try {
        let desc = winnerId
            ? `🏆 الفائز: <@${winnerId}> — حصل على **${await award(state.guildId, winnerId, state)}**`
            : '😢 ما شارك أحد هذه المرة.';
        if (state.type === 'giveaway') desc = winnerId
            ? `🎉 الفائز بالجيف أواي: <@${winnerId}> — **${await award(state.guildId, winnerId, state)}**`
            : '😢 ما شارك أحد بالجيف أواي.';
        const embed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle(state.type === 'giveaway' ? '🎉 انتهى الجيف أواي' : '🏆 انتهى التحدي')
            .setDescription(desc)
            .setTimestamp();
        const ch = state.channel;
        if (ch && typeof ch.messages?.fetch === 'function') {
            const msg = await ch.messages.fetch(state.messageId).catch(() => null);
            if (msg) await msg.edit({ content: null, embeds: [embed], components: [] }).catch(() => null);
            else await ch.send({ embeds: [embed] }).catch(() => null);
        }
    } catch { /* ignore */ }
}

async function runEventNow(guildId, client, forcedType = null, roundIndex = 0, roundTotal = 0) {
    const cfg = getGuildConfig(guildId);
    const c = cfg.funEvents || {};
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) return { ok: false, error: 'guild not found' };
    const type = forcedType || (Math.random() < 0.5 ? 'trivia' : 'giveaway');

    // Giveaways go to their own channel; games/trivia stay in the events
    // channel. Fall back to the other one only if a channel isn't configured.
    const channelId = type === 'giveaway'
        ? (c.giveawayChannelId || c.channelId)
        : (c.channelId || c.giveawayChannelId);
    const channel = channelId ? guild.channels.cache.get(String(channelId)) : null;
    if (!channel || typeof channel.send !== 'function') return { ok: false, error: 'no event channel' };

    // Embeds don't ping on their own — Discord needs explicit allowed_mentions.
    // Strip any leftover <@&...> wrapper and validate before sending.
    const roleId = String(c.roleId == null ? '' : c.roleId)
        .trim().replace(/^<@&?(!?\d+)>$/, '$1').trim();
    const validRole = /^\d{15,20}$/.test(roleId) ? roleId : null;
    const allowedMentions = validRole ? { parse: [], roles: [validRole] } : { parse: [] };
    const pingContent = validRole ? `<@&${validRole}>` : undefined;

    // Gifts are a bonus drop, not a guaranteed reward.
    const chance = Math.max(0, Math.min(100, Number(c.giftChancePct) || 0));
    const gift = Math.random() * 100 < chance ? pickWeighted(c.gifts) : null;
    const id = `fun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let state;

    if (type === 'trivia' || type === 'baccalaureate') {
        let t;
        let titlePrefix = '🧠 **تحدٍ صعب**';
        if (type === 'baccalaureate') {
            const bank = Array.isArray(BACCALAUREATE_MATH_BANK) && BACCALAUREATE_MATH_BANK.length
                ? BACCALAUREATE_MATH_BANK
                : [];
            const picked = bank.length ? bank[Math.floor(Math.random() * bank.length)] : null;
            t = picked
                ? { q: picked.q, correct: picked.a, opts: Array.isArray(picked.opts) ? picked.opts : [picked.a] }
                : { q: '📘 اسئلة دورات بكلوريا سوريا — اختر الاجابة الصحيحة:\nإذا كان f(x)=x²، فإن f\'(3) يساوي:', correct: '6', opts: ['6', '9', '3', '12'] };
            titlePrefix = '📘 **بكلوريا — اسئلة دورات**';
        } else {
            // Reuse the harder /events question banks (general knowledge, English,
            // riddles) so competitive events are genuinely difficult.
            const pool = getTriviaPool(c.mathChancePct, c.baccalaureateChancePct);
            t = pool.length
                ? pool[Math.floor(Math.random() * pool.length)]
                : { q: 'كم عدد الكواكب في المجموعة الشمسية؟', correct: '8', opts: ['8', '9', '7', '10'] };
        }
        const options = Array.isArray(t.opts) && t.opts.length >= 2
            ? [...t.opts.slice(0, 4)].sort(() => Math.random() - 0.5)
            : [t.correct, 'إجابة أخرى'];
        const eventType = type === 'baccalaureate' ? 'baccalaureate' : 'trivia';
        state = {
            id, guildId: String(guildId), type: eventType, channel,
            roundIndex, roundTotal, done, _resolveDone: resolveDone,
            messageId: null, prize: Number(c.prizePoints) || 100, gift,
            description: `${t.q}\n\n${titlePrefix} — أول إجابة صحيحة تفوز!`,
            correct: t.correct, entrants: new Set(), attempted: new Set(), finished: false, endsAt: Date.now() + 90_000
        };
        const row = new ActionRowBuilder().addComponents(
            ...options.map((opt, i) => new ButtonBuilder()
                .setCustomId(`fun:trivia:${id}:${i}`)
                .setLabel(String(opt).slice(0, 60))
                .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Success))
        );
        state.options = options;
        const msg = await channel.send({
            content: pingContent,
            embeds: [buildEventEmbed(state)],
            components: [row],
            allowedMentions
        }).catch(() => null);
        state.messageId = msg && msg.id;
    } else {
        state = {
            id, guildId: String(guildId), type: 'giveaway', channel,
            roundIndex, roundTotal, done, _resolveDone: resolveDone,
            messageId: null, prize: Number(c.prizePoints) || 100, gift,
            description: 'جيف أواي جديد! اضغط المشاركة قبل انتهاء الوقت.',
            entrants: new Set(), finished: false, endsAt: Date.now() + Math.max(1, Number(c.giveawayMinutes) || 5) * 60_000
        };
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`fun:giveaway:${id}:join`).setLabel('🎁 مشاركة').setStyle(ButtonStyle.Success)
        );
        const msg = await channel.send({
            content: pingContent,
            embeds: [buildEventEmbed(state)],
            components: [row],
            allowedMentions
        }).catch(() => null);
        state.messageId = msg && msg.id;
    }

    if (!state.messageId) return { ok: false, error: 'could not post event' };
    active.set(id, state);
    setTimeout(() => finish(state, state.type === 'giveaway'
        ? [...state.entrants][Math.floor(Math.random() * state.entrants.size)]
        : null), Math.max(5_000, state.endsAt - Date.now()));
    return { ok: true, type, id, state };
}

// One trigger = a round of several events, played one after another. Each
// event waits for a winner or its timer before the next one starts.
async function runRound(guildId, client) {
    const cfg = getGuildConfig(guildId).funEvents || {};
    const lo = Math.max(1, Math.min(10, Number(cfg.minEvents) || 2));
    const hi = Math.max(lo, Math.min(10, Number(cfg.maxEvents) || 5));
    const total = lo + Math.floor(Math.random() * (hi - lo + 1));

    // Every round starts with exactly one giveaway (in the giveaway channel),
    // followed by the remaining events as trivia/games in the events channel.
    const types = ['giveaway'];
    for (let i = 1; i < total; i++) types.push('trivia');

    let started = 0;
    let lastError = null;
    for (let i = 1; i <= total; i++) {
        const res = await runEventNow(guildId, client, types[i - 1], i, total)
            .catch((e) => ({ ok: false, error: e && e.message ? e.message : String(e) }));
        if (!res.ok) {
            lastError = res.error || 'could not post event';
            console.warn(`funEvents: event ${i}/${total} failed: ${lastError}`);
            break;
        }
        started += 1;
        // Wait until someone wins / joins-and-time-ends before continuing.
        await Promise.race([
            res.state.done,
            new Promise((r) => setTimeout(r, Math.max(10_000, res.state.endsAt - Date.now()) + 2000))
        ]);
    }
    if (started === 0) return { ok: false, error: lastError || 'no event channel' };
    return { ok: true, count: total, started };
}

async function handleFunButton(interaction) {
    if (!interaction.customId || !interaction.customId.startsWith('fun:')) return false;
    const parts = interaction.customId.split(':');
    const state = active.get(parts[2]);
    if (!state || state.finished) {
        return interaction.reply({ content: 'انتهى هذا الحدث 3:', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (state.type === 'giveaway') {
        state.entrants.add(interaction.user.id);
        const embed = buildEventEmbed(state);
        try {
            await interaction.update({ embeds: [embed], components: interaction.message.components });
        } catch { /* ignore */ }
        return true;
    }
    // trivia / baccalaureate
    const uid = String(interaction.user.id);
    const attempted = state.attempted instanceof Set ? state.attempted : (state.attempted = new Set());
    if (attempted.has(uid)) {
        return interaction.reply({ content: '⚠️ جربت بالفعل — لكل عضو محاولة وحدة بس 3:', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    attempted.add(uid);
    const choice = state.options[Number(parts[3]) || 0];
    if (choice === state.correct) {
        state.entrants.add(uid);
        await finish(state, uid);
        try { await interaction.reply({ content: '✅ إجابة صحيحة — مبروك!', flags: MessageFlags.Ephemeral }); } catch { /* ignore */ }
    } else {
        try { await interaction.reply({ content: '❌ غلط! كانت عندك محاولة وحدة بس.', flags: MessageFlags.Ephemeral }); } catch { /* ignore */ }
    }
    return true;
}

// Single entry point for both the scheduler and the manual "run now" button.
// The lock stops a second round from starting while one is still in progress.
async function runRoundLocked(guildId, client) {
    const key = String(guildId);
    if (roundLocks.has(key)) return { ok: false, error: 'round already running' };
    roundLocks.add(key);
    try {
        return await runRound(guildId, client);
    } finally {
        roundLocks.delete(key);
    }
}

function startFunScheduler(client) {
    if (schedulerStarted) return;
    schedulerStarted = true;
    setInterval(async () => {
        const now = Date.now();
        for (const [gid, cfg] of Object.entries(getGuildConfig ? getAllGuildConfigsSafe() : {})) {
            const c = cfg && cfg.funEvents;
            if (!c || !c.enabled || !c.channelId) continue;
            if (roundLocks.has(gid)) continue;
            if (c.nextAt && now < c.nextAt) continue;
            const iv = Math.max(1, Number(c.intervalHours) || 24) * 3600_000;
            const jitter = 0.8 + Math.random() * 0.4;
            updateGuildConfig(gid, (g) => ({ ...g, funEvents: { ...c, nextAt: now + Math.floor(iv * jitter) } }));
            try { await runRoundLocked(gid, client); } catch { /* ignore */ }
        }
    }, 60_000);
}

// getAllGuildConfigs is imported lazily to avoid a circular require at load.
function getAllGuildConfigsSafe() {
    try { return require('./guildConfig').getAllGuildConfigs(); } catch { return {}; }
}

module.exports = { startFunScheduler, runEventNow, runRound, runRoundLocked, handleFunButton, GIFT_TYPES };
