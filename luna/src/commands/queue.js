const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('عرض قائمة انتظار الموسيقى'),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });

        const state = interaction.client.music.getState(interaction.guild.id);
        const cur = state.current;

        const embed = new EmbedBuilder().setColor(0x7c4dff).setTitle('Queue');

        if (cur) {
            const title = cur.info && cur.info.title ? cur.info.title : 'Track';
            const uri = cur.info && cur.info.uri ? cur.info.uri : null;
            embed.addFields({ name: 'Now Playing', value: uri ? `[${title}](${uri})` : title });
        } else {
            embed.addFields({ name: 'Now Playing', value: 'لا يوجد شيء قيد التشغيل 3:' });
        }

        const lines = interaction.client.music.getQueueLines(interaction.guild.id, 10);
        embed.addFields({ name: 'Up Next', value: lines.length ? lines.join('\n') : '—' });

        return interaction.reply({ embeds: [embed] });
    }
};
