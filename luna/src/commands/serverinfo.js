const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

const VERIFICATION_LEVELS_AR = ['بدون', 'منخفض', 'متوسط', 'عالي', 'عالي جدًا'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('عرض معلومات السيرفر'),
    async execute(interaction) {
        const guild = interaction.guild;

        const embed = UI.embed({
            color: UI.COLORS.primary,
            title: `🏠 ${guild.name}`,
            thumbnail: guild.iconURL({ dynamic: true, size: 512 }),
            footerText: `ID: ${guild.id}`,
            fields: [
                { name: '👑 المالك', value: `<@${guild.ownerId}>`, inline: true },
                { name: '👥 الأعضاء', value: UI.fmtNum(guild.memberCount), inline: true },
                { name: '💬 القنوات', value: UI.fmtNum(guild.channels.cache.size), inline: true },
                { name: '🎭 الرتب', value: UI.fmtNum(guild.roles.cache.size), inline: true },
                { name: '😀 الإيموجيات', value: UI.fmtNum(guild.emojis.cache.size), inline: true },
                { name: '🚀 تعزيزات السيرفر', value: UI.fmtNum(guild.premiumSubscriptionCount || 0), inline: true },
                { name: '📅 تاريخ الإنشاء', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🛡️ مستوى التحقق', value: VERIFICATION_LEVELS_AR[guild.verificationLevel] || guild.verificationLevel.toString(), inline: true }
            ]
        });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
