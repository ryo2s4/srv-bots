const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('specialchannels')
        .setDescription('إدارة القنوات الخاصة (منع رسائل / صور)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🚫 إدارة القنوات الخاصة')
            .setDescription(
                'اختار نوع القناة اللي تبي تديرها من الأزرار بالأسفل 👇\n\n' +
                '🚫 **منع الرسائل** — قنوات يتم حذف الرسائل منها تلقائيا (الرسائل فيها صور/روابط تُترك)\n' +
                '🖼️ **منع الصور** — قنوات يتم حذف الصور منها تلقائيا\n' +
                '🍯 **هوني بوت** — أي رسالة في القناة تسوّي بان فوري لصاحبها'
            )
            .setFooter({ text: `طلبه: ${interaction.user.tag}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`specialchannels:nomsg:menu:${interaction.user.id}`)
                .setLabel('🚫 منع الرسائل')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`specialchannels:noimages:menu:${interaction.user.id}`)
                .setLabel('🖼️ منع الصور')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`specialchannels:list:all:${interaction.user.id}`)
                .setLabel('📋 عرض القائمة')
                .setStyle(ButtonStyle.Secondary)
        );

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`specialchannels:honeypot:menu:${interaction.user.id}`)
                .setLabel('🍯 هوني بوت')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};
