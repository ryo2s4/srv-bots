const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('music')
        .setDescription('لوحة تشغيل الصوتيات: تشغيل/قائمة/تخطي/إيقاف/إعدادات')
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'آسف بس هذا الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
            return;
        }

        // Defer immediately to avoid Unknown interaction timeout
        await interaction.deferReply();

        // Every /music run starts with the source chooser.
        const session = interaction.client.music.__getSession(interaction.guild.id);
        session.viewMode = 'choose';

        const built = interaction.client.music.buildChooserView(interaction.guild.id, interaction.user.id);
        const embed = built && built.embed;
        const rows = built && built.components;

        const msg = await interaction.editReply({ embeds: [embed], components: rows });
        try {
            const session = interaction.client.music.__getSession(interaction.guild.id);
            session.musicPanel = {
                channelId: interaction.channelId,
                messageId: msg && msg.id ? msg.id : null,
                ownerId: interaction.user.id
            };
            session.lastPanelOwnerId = interaction.user.id;
        } catch {
            // ignore
        }
        return msg;
    }
};
