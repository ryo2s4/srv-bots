const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder
} = require('discord.js');

const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const eventGames = require('../eventGames');
const UI = require('../utils/ui');

function clampInt(n, min, max) {
    const x = Math.floor(Number(n) || 0);
    return Math.max(min, Math.min(max, x));
}

function parseDurationSpec(input) {
    const raw = String(input || '').trim().toLowerCase();
    const m = raw.match(/^([0-9]+)\s*([smhd])$/);
    if (!m) return { ok: false, ms: 0, reason: 'صيغة المدة غير صحيحة. مثال: 30s أو 10m أو 2h أو 1d' };
    const n = Math.floor(Number(m[1]) || 0);
    if (!n || n < 1) return { ok: false, ms: 0, reason: 'المدة لازم تكون رقم أكبر من 0' };

    const unit = m[2];
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return { ok: true, ms: n * mult, reason: '' };
}

function getEventsCfg(guildId) {
    const cfg = getGuildConfig(guildId);
    const e = cfg.events && typeof cfg.events === 'object' ? cfg.events : null;
    const defaultTypes = Object.fromEntries(eventGames.GAME_KEYS.map((k) => [k, true]));
    return e || {
        enabled: false,
        channelId: null,
        intervalMs: 0,
        durationMs: 0,
        rewardMin: 10,
        rewardMax: 50,
        winnersCount: 1,
        typesEnabled: defaultTypes,
        nextAt: 0,
        active: null
    };
}

function buildEventsPanelEmbed(guildId) {
    const e = getEventsCfg(guildId);
    const enabled = !!e.enabled;
    const channel = e.channelId ? `<#${e.channelId}>` : 'غير محدد';
    const interval = e.intervalMs ? UI.fmtDuration(e.intervalMs) : 'غير محدد';
    const duration = e.durationMs ? UI.fmtDuration(e.durationMs) : 'غير محدد';
    const reward = `${UI.fmtNum(clampInt(e.rewardMin, 0, 1_000_000))} - ${UI.fmtNum(clampInt(e.rewardMax, 0, 1_000_000))}`;
    const t = e.typesEnabled && typeof e.typesEnabled === 'object' ? e.typesEnabled : {};
    const types = eventGames.GAME_KEYS
        .filter((k) => t[k] !== false)
        .map((k) => eventGames.GAMES[k].label);

    return UI.embed({
        title: '🎉 نظام الفعاليات الموحد',
        color: UI.COLORS.events,
        description:
            `> **الحالة:** ${enabled ? 'شغال ✅' : 'مقفل ⛔'}\n` +
            `> **الروم:** ${channel}\n` +
            `> **كل:** ${interval}\n` +
            `> **مدة الفعالية:** ${duration}\n` +
            `> **المكافأة (Luna Points):** ${reward}\n` +
            `> **الأنواع:** ${types.length ? types.join(' + ') : 'ولا شي'}\n\n` +
            '🧠 **القانون:** أول جواب صح يفوز وتفتح الفعالية فورًا · الغلط = خروج بدون إعادة · الألعاب كلها تحتاج تفكير.'
    });
}

function buildEventsPanelRows(ownerId) {
    const row1 = UI.row(
        UI.btn(`eventspanel:toggle:${ownerId}`, '⏯️ تشغيل/إيقاف', { style: ButtonStyle.Primary }),
        UI.btn(`eventspanel:channel:${ownerId}`, '📍 تحديد الروم', { style: ButtonStyle.Secondary }),
        UI.btn(`eventspanel:settings:${ownerId}`, '⏱️ الوقت/المدة/المكافأة', { style: ButtonStyle.Secondary }),
        UI.btn(`eventspanel:types:${ownerId}`, '🎲 أنواع الفعاليات', { style: ButtonStyle.Secondary }),
        UI.btn(`eventspanel:refresh:${ownerId}`, '🔄 تحديث', { style: ButtonStyle.Secondary })
    );

    const row2 = UI.row(
        UI.btn(`eventspanel:run:${ownerId}`, '🚀 تشغيل الآن (اختبار)', { style: ButtonStyle.Primary }),
        UI.btn(`eventspanel:history:${ownerId}`, '📜 السجل', { style: ButtonStyle.Secondary })
    );

    const row3 = UI.row(
        UI.btn(`eventspanel:stats:${ownerId}`, '📊 الإحصائيات', { style: ButtonStyle.Secondary }),
        UI.btn(`eventspanel:runspecific:${ownerId}`, '🎯 شغّل لعبة محددة', { style: ButtonStyle.Success })
    );

    return [row1, row2, row3];
}

// إحصائيات الفعاليات: أفضل الفائزين + محصولك + أكثر الألعاب
function buildEventsStatsEmbed(guildId, requesterId) {
    const UI2 = require('../utils/ui');
    const { getEventStats, getUserEventWins } = require('../db');
    const eventGames = require('../eventGames');

    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let stats = { totalEvents: 0, totalReward: 0, byUser: new Map(), byType: new Map() };
    let mine = { total: 0, today: 0, week: 0, favorite: null };
    try {
        stats = getEventStats(guildId, { sinceTs: since });
    } catch {
    }
    if (requesterId) {
        try {
            mine = getUserEventWins(guildId, requesterId);
        } catch {
        }
    }

    const top = [...stats.byUser.entries()].sort((a, b) => b[1].wins - a[1].wins).slice(0, 5);
    const topLines = top.map(([id, v], i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || '🏅';
        return `${medal} <@${id}> — **${UI2.fmtNum(v.wins)}** فوز · ${UI2.fmtNum(v.reward)} 🌙`;
    });

    const topTypes = [...stats.byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const typeLines = topTypes.map(([type, count]) => {
        const label = eventGames.GAMES[type] ? eventGames.GAMES[type].label : type;
        return `> ${label} — **${UI2.fmtNum(count)}** مرة`;
    });

    const fields = [
        { name: '📈 آخر 7 أيام', value: `فعاليات: **${UI2.fmtNum(stats.totalEvents)}**\nجوائز موزعة: **${UI2.fmtNum(stats.totalReward)}** 🌙`, inline: true },
        {
            name: '👤 محصولك أنت',
            value: `اليوم: **${UI2.fmtNum(mine.today)}**\nهالأسبوع: **${UI2.fmtNum(mine.week)}**\nالإجمالي: **${UI2.fmtNum(mine.total)}**${mine.favorite && eventGames.GAMES[mine.favorite] ? `\nلعبتك المفضلة: **${eventGames.GAMES[mine.favorite].label}**` : ''}`,
            inline: true
        }
    ];
    if (topLines.length) fields.push({ name: '🏆 أفضل الفائزين', value: topLines.join('\n').slice(0, 1024), inline: false });
    if (typeLines.length) fields.push({ name: '🎲 أكثر الألعاب', value: typeLines.join('\n').slice(0, 1024), inline: false });

    return UI2.embed({
        title: '📊 إحصائيات الفعاليات',
        description: 'كل الأرقام من آخر **7 أيام** ✨',
        color: UI2.COLORS.events,
        fields
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('events')
        .setDescription('لوحة إعداد الفعاليات الموحدة (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const ownerId = String(interaction.user.id);
        const embed = buildEventsPanelEmbed(interaction.guild.id);
        const components = buildEventsPanelRows(ownerId);

        try {
            return await interaction.reply({ embeds: [embed], components, ephemeral: true });
        } catch {
            return;
        }
    },

    buildEventsPanelEmbed,
    buildEventsPanelRows,
    buildEventsStatsEmbed,
    parseDurationSpec
};
