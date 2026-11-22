const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');
const { getGuildConfig } = require('../guildConfig');

function channelLabel(guild, id) {
    const ch = guild && guild.channels && guild.channels.cache ? guild.channels.cache.get(String(id)) : null;
    return ch ? `#${ch.name}` : `#${id}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('replies')
        .setDescription('إدارة الردود التلقائية')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', flags: MessageFlags.Ephemeral });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const autoReplies = Array.isArray(cfg.autoReplies) ? cfg.autoReplies : [];
        const channelReplies = Array.isArray(cfg.channelAutoReplies) ? cfg.channelAutoReplies : [];
        const count = autoReplies.length;
        const embedCount = channelReplies.length;

        const statusEmoji = count > 0 || embedCount > 0 ? '🟢' : '🔴';

        const embedList = channelReplies.length
            ? channelReplies
                .slice(0, 15)
                .map((r) => {
                    const title = r.embed && typeof r.embed.title === 'string' && r.embed.title.trim()
                        ? r.embed.title.trim().slice(0, 60)
                        : 'بدون عنوان';
                    return `> ${channelLabel(interaction.guild, r.channelId)} — **${title}**`;
                })
                .join('\n')
            : '> ما في ردود روم مضافة بعد.';

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('💬 الردود التلقائية')
            .setDescription(
                `**الحالة:** ${statusEmoji}\n\n` +
                '💡 **الفكرة:** تكتب محفّز والبوت يرد تلقائياً!\n\n' +
                '**أمثلة:**\n' +
                '• المحفّز: `سلام` → الرد: `وعليكم السلام! 👋`\n' +
                '• المحفّز: `بوت` → الرد: `نعم؟ أنا هنا! 🤖`'
            )
            .addFields(
                {
                    name: '📊 الإحصائيات',
                    value: `📝 **ردود الكلمات:** ${count}\n📺 **ردود الروم (Embed):** ${embedCount}`,
                    inline: false
                },
                {
                    name: '📺 ردود الروم المضافة',
                    value: embedList.slice(0, 1024),
                    inline: false
                }
            )
            .setFooter({ text: '⚡ صلاحية Manage Server مطلوبة' })
            .setTimestamp();

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('replies:add')
                .setLabel('إضافة رد')
                .setStyle(ButtonStyle.Success)
                .setEmoji('➕'),
            new ButtonBuilder()
                .setCustomId('replies:edit')
                .setLabel('تعديل')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✏️')
                .setDisabled(count === 0),
            new ButtonBuilder()
                .setCustomId('replies:remove')
                .setLabel('حذف')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
                .setDisabled(count === 0)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('replies:list')
                .setLabel('عرض القائمة')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📋')
                .setDisabled(count === 0),
            new ButtonBuilder()
                .setCustomId('replies:clear')
                .setLabel('حذف الكل')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('⚠️')
                .setDisabled(count === 0)
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('replies:channel')
                .setLabel('إضافة رد روم (Embed)')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📺'),
            new ButtonBuilder()
                .setCustomId('replies:chanlist')
                .setLabel('إدارة ردود الروم')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🛠️')
                .setDisabled(embedCount === 0)
        );

        const row4 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('replies:random')
                .setLabel('رد عشوائي نادر')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🌌')
        );
        const components = [row1, row2, row3, row4];

        // One entry per channel embed; picking one opens its edit/delete card.
        if (channelReplies.length) {
            const options = channelReplies.slice(0, 25).map((r) => {
                const title = r.embed && typeof r.embed.title === 'string' && r.embed.title.trim()
                    ? r.embed.title.trim().slice(0, 70)
                    : 'بدون عنوان';
                return {
                    label: channelLabel(interaction.guild, r.channelId).slice(0, 100),
                    description: title.slice(0, 100),
                    value: String(r.id)
                };
            });
            components.push(
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('repliesSelect:chan')
                        .setPlaceholder('📺 اختار رد روم عشان تعدله أو تحذفه...')
                        .addOptions(options)
                )
            );
        }

        return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
};
