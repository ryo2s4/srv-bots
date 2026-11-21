const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ButtonStyle, ChannelType } = require('discord.js');
const UI = require('../utils/ui');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestions')
        .setDescription('نظام الاقتراحات')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر يشتغل بالسيرفر بس 3:')], flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ embeds: [UI.error('آسف بس، تحتاج صلاحية **Manage Channels** عشان تستخدم هالأمر 3:')], flags: MessageFlags.Ephemeral });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const chId = cfg.suggestionsChannelId || null;
        const approvedChId = cfg.suggestionsApprovedChannelId || null;
        const isEnabled = !!chId;

        const statusEmoji = isEnabled ? '🟢' : '🔴';
        const statusText = isEnabled ? 'مفعّل' : 'معطّل';

        const embed = UI.embed({
            color: isEnabled ? UI.COLORS.info : UI.COLORS.danger,
            title: '💡 نظام الاقتراحات',
            description: `**الحالة:** ${statusEmoji} ${statusText}\n\n${isEnabled
                ? 'الأعضاء يمكنهم إرسال اقتراحات وسيتم التصويت عليها تلقائياً.'
                : 'اضغط **تفعيل النظام** لتحديد روم الاقتراحات وبدء استقبال الاقتراحات.'}`,
            footerText: '⚡ صلاحية Manage Channels مطلوبة للتعديل',
            fields: [
                {
                    name: '⚙️ الإعدادات الحالية',
                    value: `📝 **روم الاقتراحات:** ${chId ? `<#${chId}>` : '`غير محدد`'}\n✅ **روم المقبولة:** ${approvedChId ? `<#${approvedChId}>` : '`غير محدد`'}`,
                    inline: false
                },
                {
                    name: '✨ المميزات المتاحة',
                    value: '✏️ أزرار تعديل/حذف لصاحب الاقتراح\n👍 👎 تصويت تلقائي على كل اقتراح\n✅ ❌ أزرار موافقة/رفض للإدارة',
                    inline: false
                }
            ]
        });

        // Row 1: Main actions
        const row1 = UI.row(
            UI.btn('suggestions:setup', isEnabled ? 'تعديل الروم' : 'تفعيل النظام', {
                style: isEnabled ? ButtonStyle.Primary : ButtonStyle.Success,
                emoji: isEnabled ? '⚙️' : '✅'
            }),
            UI.btn('suggestions:approved', 'روم المقبولة', {
                style: ButtonStyle.Secondary,
                emoji: '📥'
            }),
            UI.btn('suggestions:toggle', isEnabled ? 'تعطيل النظام' : 'تفعيل', {
                style: isEnabled ? ButtonStyle.Danger : ButtonStyle.Success,
                emoji: isEnabled ? '🔴' : '🟢'
            })
        );

        // Row 2: Secondary actions
        const row2 = UI.row(
            UI.btn('suggestions:preview', 'معاينة', {
                style: ButtonStyle.Secondary,
                emoji: '👁️'
            }),
            UI.btn('suggestions:clear', 'إعادة تعيين', {
                style: ButtonStyle.Danger,
                emoji: '🗑️'
            })
        );

        return interaction.reply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
    }
};
