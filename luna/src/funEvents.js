// V11.6 — daily random fun events, competitive trivia and giveaways.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('./guildConfig');
const { addLunaPoints } = require('./levelsStore');

const active = new Map(); // eventId -> state
let schedulerStarted = false;

const TRIVIA = [
    { q: 'كم عدد الكواكب في المجموعة الشمسية؟', a: ['8', '9'], wrong: ['7', '10'] },
    { q: 'ما هو أكبر محيط في العالم؟', a: ['المحيط الهادئ'], wrong: ['الأطلسي', 'الهندي'] },
    { q: 'كم لون في قوس قزح؟', a: ['7'], wrong: ['5', '9'] },
    { q: 'ما أسرع حيوان على اليابسة؟', a: ['الفهد'], wrong: ['الأسد', 'الغزال'] }
];

function pickWeighted(gifts) {
    const list = (Array.isArray(gifts) ? gifts : []).filter((g) => g && typeof g === 'object' && g.name);
    if (!list.length) return null;
    const weight = { common: 60, uncommon: 30, rare: 10, epic: 4, legendary: 1 };
    const pool = [];
    for (const g of list) {
        const w = weight[String(g.rarity || 'common').toLowerCase()] || 10;
        for (let i = 0; i < w; i++) pool.push(g);
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
}

function buildEventEmbed(state) {
    const e = new EmbedBuilder()
        .setColor('#B28DDE')
        .setTitle(state.type === 'giveaway' ? '🎉 جيف أواي!' : '🧠 تحدّي لونا')
        .setDescription(state.description)
        .setFooter({ text: 'أول من يضغط الإجابة الصحيحة يفوز' })
        .setTimestamp();
    if (state.gift) e.addFields({ name: '🎁 الهدية', value: `${state.gift.name} (${state.gift.rarity || 'common'})`, inline: false });
    if (state.type === 'giveaway') e.addFields({ name: '👥 المشاركون', value: String(state.entrants.size), inline: true });
    return e;
}

async function award(guildId, userId, state) {
    try { addLunaPoints(guildId, userId, Number(state.prize) || 0); } catch { /* ignore */ }
    return state.gift ? `${state.gift.name} + ${state.prize} LP` : `${state.prize} Luna Points`;
}

async function finish(state, winnerId) {
    if (!state || state.finished) return;
    state.finished = true;
    active.delete(state.id);
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

async function runEventNow(guildId, client, forcedType = null) {
    const cfg = getGuildConfig(guildId);
    const c = cfg.funEvents || {};
    const guild = client.guilds.cache.get(String(guildId));
    if (!guild) return { ok: false, error: 'guild not found' };
    const channelId = c.giveawayChannelId || c.channelId;
    const channel = channelId ? guild.channels.cache.get(String(channelId)) : null;
    if (!channel || typeof channel.send !== 'function') return { ok: false, error: 'no event channel' };

    const type = forcedType || (Math.random() < 0.5 ? 'trivia' : 'giveaway');
    const gift = pickWeighted(c.gifts);
    const id = `fun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let state;

    if (type === 'trivia') {
        const t = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
        const correctIdx = Math.floor(Math.random() * 2);
        const correct = correctIdx === 0 ? t.a[0] : t.wrong[0];
        const wrong = correctIdx === 0 ? t.wrong[0] : t.a[0];
        const options = [correct, wrong].sort(() => Math.random() - 0.5);
        state = {
            id, guildId: String(guildId), type: 'trivia', channel,
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
        const msg = await channel.send({ embeds: [buildEventEmbed(state)], components: [row] }).catch(() => null);
        state.messageId = msg && msg.id;
    } else {
        state = {
            id, guildId: String(guildId), type: 'giveaway', channel,
            messageId: null, prize: Number(c.prizePoints) || 100, gift,
            description: `${c.roleId ? `<@&${c.roleId}> ` : ''}جيف أواي جديد! اضغط المشاركة قبل انتهاء الوقت.`,
            entrants: new Set(), finished: false, endsAt: Date.now() + Math.max(1, Number(c.giveawayMinutes) || 5) * 60_000
        };
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`fun:giveaway:${id}:join`).setLabel('🎁 مشاركة').setStyle(ButtonStyle.Success)
        );
        const msg = await channel.send({ embeds: [buildEventEmbed(state)], components: [row] }).catch(() => null);
        state.messageId = msg && msg.id;
    }

    if (!state.messageId) return { ok: false, error: 'could not post event' };
    active.set(id, state);
    setTimeout(() => finish(state, state.type === 'giveaway'
        ? [...state.entrants][Math.floor(Math.random() * state.entrants.size)]
        : null), Math.max(5_000, state.endsAt - Date.now()));
    return { ok: true, type, id };
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
            if (c.nextAt && now < c.nextAt) continue;
            const iv = Math.max(1, Number(c.intervalHours) || 24) * 3600_000;
            const jitter = 0.8 + Math.random() * 0.4;
            updateGuildConfig(gid, (g) => ({ ...g, funEvents: { ...c, nextAt: now + Math.floor(iv * jitter) } }));
            await runEventNow(gid, client).catch(() => null);
        }
    }, 60_000);
}

// getAllGuildConfigs is imported lazily to avoid a circular require at load.
function getAllGuildConfigsSafe() {
    try { return require('./guildConfig').getAllGuildConfigs(); } catch { return {}; }
}

module.exports = { startFunScheduler, runEventNow, handleFunButton };
