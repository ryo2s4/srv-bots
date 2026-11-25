const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getProfileWebUrl } = require('../web/profileWeb');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('يعرض رابط صفحة البروفايل')
        .setDMPermission(false)
        .addUserOption((opt) =>
            opt
                .setName('user')
                .setDescription('عضو آخر لعرض ملفه')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'هالأمر يشتغل بالسيرفر بس.', flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const profileUrl = getProfileWebUrl(interaction.guild.id, targetUser.id);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('فتح صفحة البروفايل 🌐')
                .setStyle(ButtonStyle.Link)
                .setURL(profileUrl)
        );

        return interaction.reply({ content: profileUrl, components: [row], flags: MessageFlags.Ephemeral });
    }
};
