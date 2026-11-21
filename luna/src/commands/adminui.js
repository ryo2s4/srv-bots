const {
    SlashCommandBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');

const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminui')
        .setDescription('لوحة إدارة السيرفر (نسخ احتياطي، RGB، بوستات الرتب)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const embed = UI.embed({
            title: '⚙️ لوحة إدارة السيرفر',
            color: UI.COLORS.info,
            footerText: `طلبه: ${interaction.user.tag}`,
            description:
                'اختار القسم اللي تبي تديره من الأزرار بالأسفل 👇\n\n' +
                '> 💾 **النسخ الاحتياطي** — تصدير/استيراد/إعدادات\n' +
                '> 🌈 **رتبة RGB** — تفعيل/إيقاف ألوان متحركة\n' +
                '> ⚡ **بوستات الرتب** — إضافة/حذف مضاعفات للرتب'
        });

        const row = UI.row(
            UI.btn(`adminui:backup:menu:${interaction.user.id}`, '💾 النسخ الاحتياطي', { style: ButtonStyle.Secondary }),
            UI.btn(`adminui:rgb:menu:${interaction.user.id}`, '🌈 رتبة RGB', { style: ButtonStyle.Secondary }),
            UI.btn(`adminui:roleboost:menu:${interaction.user.id}`, '⚡ بوستات الرتب', { style: ButtonStyle.Secondary })
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
};
