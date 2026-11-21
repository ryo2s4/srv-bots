const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('user')
        .setDescription('عرض معلومات مستخدم')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('المستخدم المراد عرض معلوماته')
                .setRequired(true)),
    async execute(interaction) {
        const user = interaction.options.getUser('target');
        const member = interaction.guild.members.cache.get(user.id);

        const roles = member ? member.roles.cache.map(r => r).join(' ') : 'غير متاح';
        const joinedAt = member && member.joinedAt ? UI.fmtRelative(member.joinedAt.getTime()) : 'غير متاح';

        const embed = UI.embed({
            color: UI.COLORS.primary,
            title: `👤 معلومات المستخدم: ${user.username}`,
            thumbnail: user.displayAvatarURL({ dynamic: true }),
            fields: [
                { name: '🏷️ الاسم', value: user.tag, inline: true },
                { name: '🆔 ID', value: `\`${user.id}\``, inline: true },
                { name: '📅 تاريخ إنشاء الحساب', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '📥 تاريخ الانضمام للخادم', value: joinedAt, inline: true },
                { name: '🎭 الأدوار', value: roles.length > 1024 ? roles.slice(0, 1020) + '…' : roles }
            ]
        });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
};
