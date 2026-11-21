const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('تخطي الأغنية الحالية'),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });

        const res = await interaction.client.music.skip(interaction.guild.id);
        if (!res.ok) return interaction.reply({ content: `اسفة بس ${res.error || 'ما قدرت أتخطى.'} 3:`, ephemeral: true });

        const { embed, components } = interaction.client.music.buildNowPlayingEmbed(interaction.guild.id);
        return interaction.reply({ content: 'تم التخطي 3=', embeds: [embed], components });
    }
};
