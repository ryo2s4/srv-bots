const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

function parseEmojis(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    const parts = text.split(/\s+/g).map((s) => s.trim()).filter(Boolean);
    return parts.slice(0, 10);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoreact')
        .setDescription('إعداد الرياكشن التلقائي')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: 'عذراً، هذا الأمر يعمل فقط داخل السيرفر.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: 'عذراً، تحتاج صلاحية Manage Messages لاستخدام هذا الأمر.',
                flags: MessageFlags.Ephemeral
            });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const ar = cfg.autoReactions && typeof cfg.autoReactions === 'object' ? cfg.autoReactions : {};
        const chId = ar.channelId || null;
        const emojis = Array.isArray(ar.emojis) ? ar.emojis : [];
        const excludedRoles = Array.isArray(ar.excludedRoles) ? ar.excludedRoles : [];
        const isEnabled = !!chId && emojis.length > 0;

        const embed = new EmbedBuilder()
            .setColor(isEnabled ? 0x57f287 : 0xed4245)
            .setTitle('⚡ الرياكشن التلقائي')
            .setDescription(isEnabled
                ? 'النظام مفعّل حالياً. يمكنك تعديل الإعدادات من الأسفل.'
                : 'النظام معطّل حالياً. اضغط "تفعيل" لبدء الإعداد.')
            .addFields(
                {
                    name: '📍 الروم المستهدف',
                    value: chId ? `<#${chId}>` : 'غير محدد',
                    inline: true
                },
                {
                    name: '🎭 الإيموجيات',
                    value: emojis.length ? emojis.join(' ') : 'غير محدد',
                    inline: true
                },
                {
                    name: '🚫 الرتب المستثناة',
                    value: excludedRoles.length
                        ? excludedRoles.map(r => `<@&${r}>`).join(', ')
                        : 'لا يوجد',
                    inline: false
                }
            )
            .setFooter({ text: 'Manage Messages مطلوب للتعديل' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('autoreact:setup')
                .setLabel(isEnabled ? 'تعديل الإعدادات' : 'تفعيل')
                .setStyle(isEnabled ? ButtonStyle.Primary : ButtonStyle.Success)
                .setEmoji(isEnabled ? '⚙️' : '✅'),
            new ButtonBuilder()
                .setCustomId('autoreact:exclude')
                .setLabel('استثناء رتب')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🚫'),
            new ButtonBuilder()
                .setCustomId('autoreact:toggle')
                .setLabel(isEnabled ? 'تعطيل' : 'تفعيل سريع')
                .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('autoreact:preview')
                .setLabel('معاينة الإعدادات')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('👁️'),
            new ButtonBuilder()
                .setCustomId('autoreact:clear')
                .setLabel('إعادة تعيين')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );

        return interaction.reply({
            embeds: [embed],
            components: [row1, row2],
            flags: MessageFlags.Ephemeral
        });
    }
};
