const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const { getUserStats, getGuildUsers } = require('../levelsStore');
const { getUserInventory } = require('../shopStore');
const { xpForNextLevel, totalXpOfStats } = require('../xpCurve');
const { nextMilestone, runeDropChance, RUNE_PITY_MAX } = require('../levelUpService');
const { getBoostNameAr, formatRemainingAr, getTotalBoostSummary } = require('../boostMeta');
const { TIERS, getRuneBoosts, fmtPct, getTotalRuneSummary, getRuneStars } = require('../runes');

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function computeRank(guildId, userId) {
    const users = getGuildUsers(guildId);
    const entries = Object.entries(users)
        .map(([id, s]) => ({ id, total: totalXpOfStats(s) }))
        .sort((a, b) => b.total - a.total);
    const idx = entries.findIndex((e) => e.id === userId);
    return { rank: idx >= 0 ? idx + 1 : entries.length, total: entries.length };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('عرض مستواك و Luna Points')
        .addUserOption(opt =>
            opt.setName('target')
                .setDescription('عرض مستوى شخص آخر')
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر يشتغل بالسيرفر بس 3:')], flags: MessageFlags.Ephemeral });
        }

        const target = interaction.options.getUser('target') || interaction.user;
        const stats = getUserStats(interaction.guild.id, target.id);
        const inv = getUserInventory(interaction.guild.id, target.id);

        const needed = xpForNextLevel(stats.level);
        const pct = needed <= 0 ? 0 : stats.xp / needed;
        const totalXp = totalXpOfStats(stats);
        const { rank, total } = computeRank(interaction.guild.id, target.id);

        // Equipped runes
        const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
        const equippedIds = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
        const equippedRunes = allRunes.filter((r) => r && equippedIds.includes(r.id));
        const runeSummary = getTotalRuneSummary(equippedRunes);

        // Active boosts
        const now = Date.now();
        const activeBoosts = (Array.isArray(inv.activeBoosts) ? inv.activeBoosts : [])
            .filter((b) => b && (!b.expiresAt || b.expiresAt > now));
        const boostSummary = getTotalBoostSummary(inv.activeBoosts);

        // Rune drop odds + pity
        const dropPct = Math.round(runeDropChance(stats.level) * 100);
        const pity = Math.max(0, Math.floor(Number(inv.runePity) || 0));
        const pityLine = pity > 0
            ? `🍀 ضمان الحظ السيء: ${pity}/${RUNE_PITY_MAX} (الرنة الجاية مضمونة لو ما نزلت)`
            : `🍀 فرصة نزول رونة بالترقية الجاية: **${dropPct}%**`;

        const nextMs = nextMilestone(stats.level);
        const nextMsLine = nextMs
            ? `🏁 **${nextMs.label}** — مكافأة: **${nextMs.luna}** Luna Points${nextMs.runeTier ? ` + رونة **${(TIERS[nextMs.runeTier] || {}).label || nextMs.runeTier}** مضمونة` : ''}`
            : '🏁 وصلت أعلى معلم! 🏆';

        const equippedLines = equippedRunes.length > 0
            ? equippedRunes.map((r) => {
                const t = TIERS[r.tier] || TIERS.common;
                const stars = getRuneStars(r);
                return `${t.emoji} **${t.label}**${stars > 0 ? ` ⭐${stars}` : ''} — ${getRuneBoosts(r).map((b) => fmtPct(b.multiplier)).join(' + ')}`;
            }).join('\n')
            : 'لا يوجد';

        const boostLines = activeBoosts.length > 0
            ? activeBoosts.map((b) => {
                const name = getBoostNameAr(b.type);
                const left = b.expiresAt ? ` (${formatRemainingAr(b.expiresAt)})` : ' (دائم)';
                return `• ${name}${left}`;
            }).join('\n')
            : 'لا يوجد';

        const multParts = [];
        if (boostSummary.xp.active) multParts.push(`XP ×${boostSummary.xp.multiplier.toFixed(2)}`);
        if (boostSummary.luna.active) multParts.push(`Luna ×${boostSummary.luna.multiplier.toFixed(2)}`);
        if (runeSummary.xp.active) multParts.push(`رونة XP ${fmtPct(runeSummary.xp.multiplier)}`);
        if (runeSummary.luna.active) multParts.push(`رونة Luna ${fmtPct(runeSummary.luna.multiplier)}`);
        if (runeSummary.levelup.active) multParts.push(`رونة ترقية ${fmtPct(runeSummary.levelup.multiplier)}`);

        const rankMedal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';

        const embed = UI.embed({
            color: UI.COLORS.levels,
            title: `🌙 مستوى ${target.username}`,
            thumbnail: target.displayAvatarURL({ dynamic: true }),
            footerText: 'لونا قاعدة تتابع تقدمك خطوة بخطوة 🫶',
            description:
                `> 🎖️ المستوى: **${UI.fmtNum(stats.level)}**\n` +
                `> ✨ XP داخل المستوى: **${UI.fmtNum(stats.xp)} / ${UI.fmtNum(needed)}**\n` +
                `> 🌙 Luna Points: **${UI.fmtNum(stats.lunaPoints)}**\n` +
                `> ${rankMedal} الترتيب بالسيرفر: **#${UI.fmtNum(rank)}** من ${UI.fmtNum(total)}\n\n` +
                `${UI.progressBar(stats.xp, needed, 12)} \`${UI.fmtNum(stats.xp)} / ${UI.fmtNum(needed)}\` (${Math.floor(clamp(pct, 0, 1) * 100)}%)`,
            fields: [
                { name: '📊 إجمالي XP', value: `**${UI.fmtNum(totalXp)}**`, inline: true },
                { name: '🎭 لقبك (داخل البوت)', value: inv.activeTitle ? `**${inv.activeTitle}**` : 'لا يوجد', inline: true },
                { name: '🔮 الرونات المجهزة', value: equippedLines, inline: true },
                { name: '⚡ التعزيزات النشطة', value: boostLines, inline: true },
                { name: '🎯 المكافآت المتراكمة', value: multParts.length > 0 ? multParts.join('\n') : 'لا يوجد', inline: false },
                { name: '🏁 الوجهة القادمة', value: nextMsLine, inline: false },
                { name: '🍀 حظ الرونات', value: pityLine, inline: false }
            ]
        });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
