const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('تشغيل اناشيد/موسيقى حلال/قران/شعر من ملفات السيرفر')
        .setDMPermission(false),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('تشغيل صوتيات')
            .setDescription(
                'هلاا~ أنا لونا 3:\n\n' +
                'أقدر أشغل لك **أناشيد** أو **موسيقى حلال** أو **قرآن** أو **شعر** من الملفات اللي بالسيرفر.\n' +
                'بس اختار من الخيارات تحت وش تبغاني أشغّل لك 3:'
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('playcat:anashid').setLabel('اناشيد').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('playcat:halal').setLabel('موسيقى حلال').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('playcat:quran').setLabel('قران').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('playcat:shiir').setLabel('شعر').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`playsettings:${interaction.user.id}`).setLabel('إعدادات التشغيل').setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
    }
};
