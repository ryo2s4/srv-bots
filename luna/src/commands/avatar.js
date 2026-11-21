const { SlashCommandBuilder, MessageFlags, ButtonStyle } = require('discord.js');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('عرض صورة المستخدم')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('المستخدم المراد عرض صورته')
                .setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('target') || interaction.user;

        const embed = UI.embed({
            color: UI.COLORS.primary,
            title: `🖼️ صورة ${user.username}`,
            image: user.displayAvatarURL({ dynamic: true, size: 4096 })
        });

        const row = UI.row(
            UI.btn(null, 'PNG', { style: ButtonStyle.Link, url: user.displayAvatarURL({ extension: 'png', size: 4096 }) }),
            UI.btn(null, 'JPG', { style: ButtonStyle.Link, url: user.displayAvatarURL({ extension: 'jpg', size: 4096 }) }),
            UI.btn(null, 'WEBP', { style: ButtonStyle.Link, url: user.displayAvatarURL({ extension: 'webp', size: 4096 }) })
        );

        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    },
};
