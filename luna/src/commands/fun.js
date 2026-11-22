const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getGuildConfig } = require('../guildConfig');

function panel(guildId, tag) {
    const c = getGuildConfig(guildId).funEvents || {};
    const embed = new EmbedBuilder()
        .setColor('#B28DDE')
        .setTitle('🎪 أوامر الفن والجيف أواي')
        .setDescription(
            `**الحالة:** ${c.enabled ? '🟢 مفعّل' : '🔴 معطّل'}\n` +
            `**قناة الأحداث:** ${c.channelId ? `<#${c.channelId}>` : '—'}\n` +
            `**قناة الجيف أواي:** ${c.giveawayChannelId ? `<#${c.giveawayChannelId}>` : '—'}\n` +
            `**الرتبة المستهدفة:** ${c.roleId ? `<@&${c.roleId}>` : '—'}\n` +
            `**التكرار:** كل ${c.intervalHours || 24} ساعة\n` +
            `**فعاليات كل جولة:** ${c.minEvents || 2} - ${c.maxEvents || 5}\n` +
            `**الجائزة:** ${c.prizePoints || 100} Luna Points\n` +
            `**مدة الجيف أواي:** ${c.giveawayMinutes || 5} دقائق\n` +
            `**الهدايا:** ${(c.gifts || []).length}`
        )
        .setFooter({ text: tag || 'Fun Events' });
    const rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('funui:channel').setLabel('قناة الأحداث').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('funui:giveaway').setLabel('قناة الجيف').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('funui:role').setLabel('الرتبة').setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('funui:interval').setLabel('التكرار').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('funui:prize').setLabel('الجائزة').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('funui:gifts').setLabel('الهدايا والندرة').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('funui:count').setLabel('عدد الفعاليات').setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('funui:toggle').setLabel(c.enabled ? '⛔ إيقاف' : '✅ تفعيل').setStyle(c.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder().setCustomId('funui:run').setLabel('▶️ شغّل الآن').setStyle(ButtonStyle.Success)
        )
    ];
    return { embed, components: rows };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fun')
        .setDescription('إعداد أحداث لونا today games والجيف أواي (إدارة)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    panel,
    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'بالسيرفر بس 3:', flags: MessageFlags.Ephemeral });
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'تحتاج Manage Server 3:', flags: MessageFlags.Ephemeral });
        }
        const p = panel(interaction.guild.id, interaction.user.tag);
        return interaction.reply({ embeds: [p.embed], components: p.components, flags: MessageFlags.Ephemeral });
    }
};
