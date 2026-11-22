// V11.6 — daily random fun events, competitive trivia and giveaways.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('./guildConfig');
const { addLunaPoints, updateUserStats } = require('./levelsStore');
const { getUserInventory, updateUserInventory } = require('./shopStore');
const { getGuildShop, updateGuildShop } = require('./shopStore');
const { processXpGain } = require('./levelUpService');
const { generateRuneDrop } = require('./runes');

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
    const giftLine = state.gift ? await applyGift(guildId, userId, state.gift, state.prize) : '';
    const pointsLine = state.gift === 'points' ? '' : `${Number(state.prize) || 0} Luna Points`;
    return [giftLine, pointsLine].filter(Boolean).join(' + ') || 'لا شيء';
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
            if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => null);
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
    const allowedMentions = c.roleId
        ? { parse: [], roles: [String(c.roleId)] }
        : { parse: [] };

    const gift = pickWeighted(c.gifts);
    const id = `fun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    let state;

    if (type === 'trivia') {
        const t = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
        const correctIdx = Math.floor(Math.random() * 2);
        const correct = correctIdx === 0 ? t.a[0] : t.wrong[0];
        const wrong = correctIdx === 0 ? t.wrong[0] : t.a[0];
        const options = [correct, wrong].sort(() => Math.random() - 0.5);
        state = {
            id, guildId: String(guildId), type: 'trivia', channel,
            roundIndex, roundTotal, done, _resolveDone: resolveDone,
            messageId: null, prize: Number(c.prizePoints) || 100, gift,
            description: `${c.roleId ? `<@&${c.roleId}> ` : ''}${t.q}\n\nأول إجابة صحيحة تفوز!`,
            correct, entrants: new Set(), finished: false, endsAt: Date.now() + 90_000
        };
        const row = new ActionRowBuilder().addComponents(
            ...options.map((opt, i) => new ButtonBuilder()
                .setCustomId(`fun:trivia:${id}:${i}`)
                .setLabel(String(opt).slice(0, 60))
                .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Success))
        );
        state.options = options;
        const msg = await channel.send({ embeds: [buildEventEmbed(state)], components: [row], allowedMentions }).catch(() => null);
        state.messageId = msg && msg.id;
    } else {
        state = {
            id, guildId: String(guildId), type: 'giveaway', channel,
            roundIndex, roundTotal, done, _resolveDone: resolveDone,
            messageId: null, prize: Number(c.prizePoints) || 100, gift,
            description: `${c.roleId ? `<@&${c.roleId}> ` : ''}جيف أواي جديد! اضغط المشاركة قبل انتهاء الوقت.`,
            entrants: new Set(), finished: false, endsAt: Date.now() + Math.max(1, Number(c.giveawayMinutes) || 5) * 60_000
        };
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`fun:giveaway:${id}:join`).setLabel('🎁 مشاركة').setStyle(ButtonStyle.Success)
        );
        const msg = await channel.send({ embeds: [buildEventEmbed(state)], components: [row], allowedMentions }).catch(() => null);
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
    const lo = Math.max(1, Math.min(5, Number(cfg.minEvents) || 2));
    const hi = Math.max(lo, Math.min(5, Number(cfg.maxEvents) || 5));
    const total = lo + Math.floor(Math.random() * (hi - lo + 1));

    // Always include at least one of each event type, then fill the rest
    // randomly and shuffle so a round is never all giveaways.
    const types = ['trivia', 'giveaway'];
    for (let i = 2; i < total; i++) types.push(Math.random() < 0.5 ? 'trivia' : 'giveaway');
    for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
    }

    for (let i = 1; i <= total; i++) {
        const res = await runEventNow(guildId, client, types[i - 1], i, total).catch(() => ({ ok: false }));
        if (!res.ok) break;
        // Wait until someone wins / joins-and-time-ends before continuing.
        await Promise.race([
            res.state.done,
            new Promise((r) => setTimeout(r, Math.max(10_000, res.state.endsAt - Date.now()) + 2000))
        ]);
    }
    return { ok: true, count: total };
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
    // trivia
    const choice = state.options[Number(parts[3]) || 0];
    if (state.entrants.size && state.entrants.has(interaction.user.id)) {
        return interaction.reply({ content: 'شاركت بالفعل 3:', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (choice === state.correct) {
        state.entrants.add(interaction.user.id);
        await finish(state, interaction.user.id);
        try { await interaction.reply({ content: '✅ إجابة صحيحة — مبروك!', flags: MessageFlags.Ephemeral }); } catch { /* ignore */ }
    } else {
        try { await interaction.reply({ content: '❌ غلط، جرّب حد ثاني!', flags: MessageFlags.Ephemeral }); } catch { /* ignore */ }
    }
    return true;
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
            roundLocks.add(gid);
            try { await runRound(gid, client); } catch { /* ignore */ }
            finally { roundLocks.delete(gid); }
        }
    }, 60_000);
}

// getAllGuildConfigs is imported lazily to avoid a circular require at load.
function getAllGuildConfigsSafe() {
    try { return require('./guildConfig').getAllGuildConfigs(); } catch { return {}; }
}

module.exports = { startFunScheduler, runEventNow, runRound, handleFunButton, GIFT_TYPES };
