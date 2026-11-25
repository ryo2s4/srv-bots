const {
    SlashCommandBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shopadminui')
        .setDescription('لوحة إدارة متجر لونا (واجهة)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '⚙️ لوحة إدارة متجر لونا',
            description: [
                'اختار إجراء من الأزرار بالأسفل 👇',
                '',
                '> ➕ **إضافة رتبة**: Role ID + السعر + الندرة + وصف (اختياري)',
                '> ➕ **إضافة لقب**: نص اللقب + السعر + الندرة + وصف (اختياري)',
                '> 📝 **تعديل وصف**: اختيار عنصر وتغيير وصفه',
                '> 🗑️ **حذف عنصر**: اختيار من قائمة',
                '> 🏆 **تفعيل/إيقاف المزاد**',
                '> 🎖️ **تعيين رتبة المزاد الأسطوري**',
                '> 🎟️ **كود خصم**: إنشاء كود خصم (1-20%)',
                '> ♻️ **تصفير كوبون**: إعادة استخدام كوبون خلصت استخداماته'
            ].join('\n'),
            footerText: `طلبه: ${interaction.user.tag}`
        });

        const row1 = UI.row(
            UI.btn('shopadminui:add_role', 'إضافة رتبة 🎨', { style: ButtonStyle.Primary }),
            UI.btn('shopadminui:add_title', 'إضافة لقب 🎭', { style: ButtonStyle.Primary }),
            UI.btn('shopadminui:edit_desc', 'تعديل وصف 📝', { style: ButtonStyle.Secondary }),
            UI.btn('shopadminui:remove_item', 'حذف عنصر 🗑️', { style: ButtonStyle.Danger })
        );

        const row2 = UI.row(
            UI.btn('shopadminui:set_legendary', 'تحديد رتبة المزاد 🏆', { style: ButtonStyle.Secondary }),
            UI.btn('shopadminui:start_auction', 'بدء المزاد ⏳', { style: ButtonStyle.Primary }),
            UI.btn('shopadminui:end_auction', 'إنهاء المزاد ⛔', { style: ButtonStyle.Danger })
        );

        const row3 = UI.row(
            UI.btn('shopadminui:show', 'عرض الإعدادات ⚙️', { style: ButtonStyle.Secondary }),
            UI.btn('shopadminui:add_coupon', 'كود خصم 🎟️', { style: ButtonStyle.Secondary }),
            UI.btn('shopadminui:reset_coupon', 'تصفير كوبون ♻️', { style: ButtonStyle.Secondary })
        );

        const row4 = UI.row(
            UI.btn('shopadminui:announce', '⏯️ إعلانات العروض', { style: ButtonStyle.Primary }),
            UI.btn('shopadminui:announce_ch', '📍 روم الإعلانات', { style: ButtonStyle.Secondary }),
            UI.btn('shopadminui:announce_preview', '👁️ معاينة الإعلان', { style: ButtonStyle.Secondary })
        );

        await interaction.reply({ embeds: [embed], components: [row1, row2, row3, row4] });
    }
};
