const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('فحص سرعة استجابة البوت'),
    async execute(interaction) {
        const sent = await interaction.reply({ content: 'لحظة… أتأكد من الاستجابة ⏳', fetchReply: true, flags: MessageFlags.Ephemeral });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;

        await interaction.editReply({
            content: null,
            embeds: [
                UI.embed({
                    color: UI.COLORS.primary,
                    title: '🏓 بونغ!',
                    description:
                        `> ⏳ سرعة الاستجابة: **${UI.fmtNum(latency)}ms**\n` +
                        `> 📡 اتصال البوابة: **${UI.fmtNum(interaction.client.ws.ping)}ms**`
                })
            ]
        });
    },
};
