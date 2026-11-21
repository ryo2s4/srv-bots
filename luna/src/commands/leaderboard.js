const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const { getGuildUsers } = require('../levelsStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('عرض لوحة الصدارة (نقاط / لفل)')
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('نوع لوحة الصدارة')
                .addChoices(
                    { name: 'نقاط لونا', value: 'points' },
                    { name: 'اللفلات', value: 'levels' },
                    { name: 'مدمج', value: 'combined' }
                )
                .setRequired(false))
        .addIntegerOption(opt =>
            opt.setName('limit')
                .setDescription('عدد الأعضاء المعروضين (حتى 10)')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر يشتغل بالسيرفر بس 3:')], flags: MessageFlags.Ephemeral });
        }

        const type = interaction.options.getString('type') || 'combined';
        const limit = interaction.options.getInteger('limit') || 10;
        const users = getGuildUsers(interaction.guild.id);
        const rows = Object.entries(users)
            .map(([userId, s]) => ({
                userId,
                level: typeof s.level === 'number' ? s.level : 0,
                lunaPoints: typeof s.lunaPoints === 'number' ? s.lunaPoints : 0,
                xp: typeof s.xp === 'number' ? s.xp : 0
            }))
            .sort((a, b) => {
                if (type === 'levels') return (b.level - a.level) || (b.xp - a.xp) || (b.lunaPoints - a.lunaPoints);
                if (type === 'points') return (b.lunaPoints - a.lunaPoints) || (b.level - a.level) || (b.xp - a.xp);
                return (b.level - a.level) || (b.xp - a.xp) || (b.lunaPoints - a.lunaPoints);
            })
            .slice(0, limit);

        if (rows.length === 0) {
            return interaction.reply({ embeds: [UI.warn('آسف بس، ما عندي بيانات كفاية عشان أطلع لوحة الصدارة الحين 3:')], flags: MessageFlags.Ephemeral });
        }

        const formatRow = (r, prefix) => {
            if (type === 'levels') {
                return `${prefix} <@${r.userId}> — لفل **${UI.fmtNum(r.level)}** | XP **${UI.fmtNum(r.xp)}**`;
            }
            if (type === 'points') {
                return `${prefix} <@${r.userId}> — **${UI.fmtNum(r.lunaPoints)}** نقطة | لفل **${UI.fmtNum(r.level)}**`;
            }
            return `${prefix} <@${r.userId}> — لفل **${UI.fmtNum(r.level)}** | XP **${UI.fmtNum(r.xp)}** | **${UI.fmtNum(r.lunaPoints)}** نقطة`;
        };

        const top = rows.slice(0, 3).map((r, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
            return formatRow(r, medal);
        });

        const rest = rows.slice(3).map((r, idx) => {
            const rank = idx + 4;
            return formatRow(r, `\`#${rank}\``);
        });

        const title = type === 'levels'
            ? '🏆 لوحة الصدارة — اللفلات'
            : type === 'points'
                ? '🏆 لوحة الصدارة — Luna Points'
                : '🏆 لوحة الصدارة — (مدمج)';

        const embed = UI.embed({
            color: UI.COLORS.levels,
            title,
            description: top.join('\n'),
            footerText: `سيرفر: ${interaction.guild.name}`,
            fields: rest.length > 0 ? [{ name: '🏅 باقي المراكز', value: rest.join('\n') }] : []
        });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
