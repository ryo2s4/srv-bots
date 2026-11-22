const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder
} = require('discord.js');

const forumUi = require('../forumUi');

function buildDraftPreviewEmbed(draft, requesterTag) {
    const color = forumUi.normalizeHexColor(draft.embed?.color);
    const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];
    const image = draft && draft.embed && typeof draft.embed.image === 'string' ? draft.embed.image.trim() : '';
    const thumbnail = draft && draft.embed && typeof draft.embed.thumbnail === 'string' ? draft.embed.thumbnail.trim() : '';

    const btnText = buttons.length
        ? buttons.map((b, i) => {
            const label = String(b.label || `زر ${i + 1}`).slice(0, 80);
            const style = String(b.style || 'Secondary');
            const opts = Array.isArray(b.options) ? b.options.length : 0;
            return `- ${i + 1}) **${label}** (${style}) | خيارات: ${opts}`;
        }).join('\n')
        : 'لا يوجد';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(String(draft.embed?.title || '').slice(0, 256) || 'بدون عنوان')
        .setDescription(String(draft.embed?.description || '').slice(0, 4000) || 'بدون وصف')
        .addFields(
            { name: '🧩 الأزرار', value: btnText.slice(0, 1024), inline: false }
        )
        .setFooter({ text: requesterTag ? `طلبه: ${requesterTag}` : 'Forum UI' })
        .setTimestamp();

    if (image && /^https?:\/\//i.test(image)) {
        try { embed.setImage(image); } catch { /* ignore */ }
    }
    if (thumbnail && /^https?:\/\//i.test(thumbnail)) {
        try { embed.setThumbnail(thumbnail); } catch { /* ignore */ }
    }
    return embed;
}

function buildForumUiRows(ownerId, postId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`forumui:edit_embed:${ownerId}:${postId}`).setLabel('تعديل الإيمبد').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`forumui:add_simple:${ownerId}:${postId}`).setLabel('إضافة زر').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`forumui:clear_buttons:${ownerId}:${postId}`).setLabel('مسح الأزرار').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`forumui:templates:${ownerId}:${postId}`).setLabel('قوالب جاهزة').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`forumui:preview:${ownerId}:${postId}`).setLabel('معاينة').setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`forumui:publish:${ownerId}:${postId}`).setLabel('نشر').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`forumui:cancel:${ownerId}:${postId}`).setLabel('إلغاء').setStyle(ButtonStyle.Danger)
        )
    ];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forum')
        .setDescription('خلي لونا ترسل Embed بالمحتوى اللي تكتبه ✨')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    buildDraftPreviewEmbed,
    buildForumUiRows,

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Messages عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const draft = forumUi.createDraft({ guildId: interaction.guild.id, userId: interaction.user.id });
        const embed = buildDraftPreviewEmbed(draft, interaction.user.tag);
        const components = buildForumUiRows(interaction.user.id, draft.postId);
        return interaction.reply({ content: '🧾 سويت لك مسودة. عدل/ي ثم اضغط نشر.', embeds: [embed], components, ephemeral: true });
    }
};
