const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('عرض الأغنية الحالية مع أزرار التحكم'),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });

        const { embed, components } = interaction.client.music.buildNowPlayingEmbed(interaction.guild.id);
        return interaction.reply({ embeds: [embed], components });
    }
};
