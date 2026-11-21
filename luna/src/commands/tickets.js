const {
    SlashCommandBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');

const { getGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

function fmtMs(ms) {
    const n = Math.max(0, Math.floor(Number(ms) || 0));
    if (!n) return 'مقفلة';
    return UI.fmtDuration(n);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tickets')
        .setDescription('إدارة نظام التكتات (Admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'آسف بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const tcfg = cfg.tickets && typeof cfg.tickets === 'object' ? cfg.tickets : {};
        const types = Array.isArray(tcfg.types) ? tcfg.types : [];
        const panelChannelId = typeof tcfg.panelChannelId === 'string' ? tcfg.panelChannelId : null;
        const categoryId = typeof tcfg.categoryId === 'string' ? tcfg.categoryId : null;
        const noResponseWarnMs = Number(tcfg.noResponseWarnMs) || 0;
        const noResponseCloseMs = Number(tcfg.noResponseCloseMs) || 0;
        const inactivityCloseMs = Number(tcfg.inactivityCloseMs) || 0;

        const typesTxt = types.length
            ? types.slice(0, 10).map((t) => `- ${t.emoji ? `${t.emoji} ` : ''}**${t.name || t.id}**`).join('\n')
            : 'لا يوجد';

        const embed = UI.embed({
            title: '🎫 إدارة التكتات',
            color: UI.COLORS.tickets,
            footerText: `طلبه: ${interaction.user.tag}`,
            description:
                'تحكم بأنواع التكتات والبانل والكاتيجوري من الأزرار تحت 👇\n\n' +
                `> **قناة البانل:** ${panelChannelId ? `<#${panelChannelId}>` : '**غير محددة**'}\n` +
                `> **Category التكتات:** ${categoryId ? `<#${categoryId}>` : '**غير محددة**'}\n` +
                `> **تنبيه عدم الرد:** ${fmtMs(noResponseWarnMs)}\n` +
                `> **إغلاق بعد عدم الرد:** ${fmtMs(noResponseCloseMs)}\n` +
                `> **إغلاق بعد عدم النشاط:** ${fmtMs(inactivityCloseMs)}\n\n` +
                `**🎫 أنواع التكتات (${UI.fmtNum(types.length)}):**\n${typesTxt}`
        });

        const row1 = UI.row(
            UI.btn('ticketsui:add', '➕ إضافة نوع تكت', { style: ButtonStyle.Primary }),
            UI.btn('ticketsui:edit', '✏️ تعديل نوع', { style: ButtonStyle.Secondary }),
            UI.btn('ticketsui:remove', '🗑️ حذف نوع', { style: ButtonStyle.Danger }),
            UI.btn('ticketsui:edit_panel', '🎛️ تعديل بانل', { style: ButtonStyle.Secondary })
        );

        const row2 = UI.row(
            UI.btn('ticketsui:set_channel', '📍 تحديد قناة البانل', { style: ButtonStyle.Secondary }),
            UI.btn('ticketsui:set_category', '📁 تحديد Category', { style: ButtonStyle.Secondary }),
            UI.btn('ticketsui:publish', '🚀 نشر البانل', { style: ButtonStyle.Primary }),
            UI.btn('ticketsui:timers', '⏱️ إعدادات التايمر', { style: ButtonStyle.Secondary })
        );

        return interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
    }
};
