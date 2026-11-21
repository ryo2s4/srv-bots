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

        const built = interaction.client.music.buildNowPlayingEmbed(interaction.guild.id);
        const embed = built && built.embed
            ? built.embed
            : UI.embed({
                title: '🎧 لوحة الموسيقى',
                description: '🟣 **جاهزين للتشغيل**\n\n> 🎵 ما فيه شي شغال',
                color: UI.COLORS.music,
                footerText: 'لونا هنا عشان تخلي السهرة ألطف ✨'
            });

        const musicUI = require('../music/musicUI');
        const rows = musicUI.buildPanelRows(interaction.user.id, (built && built.state) || null, interaction.client.music.__getSession(interaction.guild.id));

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
