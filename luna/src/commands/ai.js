const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const { getGuildConfig } = require('../guildConfig');

function buildAiPanelEmbed(guildId) {
    const cfg = getGuildConfig(guildId);
    const ai = cfg.ai && typeof cfg.ai === 'object' ? cfg.ai : {};

    const enabled = !!ai.enabled;
    const allowedChannelId = typeof ai.allowedChannelId === 'string' ? ai.allowedChannelId : null;
    const baseUrl = typeof ai.baseUrl === 'string' && ai.baseUrl.trim() ? ai.baseUrl.trim() : null;
    const model = typeof ai.model === 'string' && ai.model.trim() ? ai.model.trim() : null;
    const cooldownMs = typeof ai.cooldownMs === 'number' ? ai.cooldownMs : 15000;
    const memoryTtlMs = typeof ai.memoryTtlMs === 'number' ? ai.memoryTtlMs : 2 * 60 * 60 * 1000;

    const embed = new EmbedBuilder()
        .setColor('#E7D3B0')
        .setTitle('🤖 لوحة التحكم بالذكاء الصناعي')
        .setDescription('تحكم بإعدادات الذكاء الصناعي من الأزرار تحت.');

    embed.addFields(
        { name: 'الحالة', value: enabled ? '✅ شغال' : '⛔ مطفى', inline: true },
        { name: 'الروم', value: allowedChannelId ? `<#${allowedChannelId}>` : 'غير محدد', inline: true },
        { name: 'الـ URL', value: baseUrl || (process.env.OLLAMA_BASE_URL || 'غير محدد'), inline: false },
        { name: 'الموديل', value: model || (process.env.OLLAMA_MODEL || 'phi3:mini'), inline: true },
        { name: 'Cooldown', value: `${Math.round(cooldownMs / 1000)}s`, inline: true },
        { name: 'الذاكرة', value: '✅ On (long-term per user, global)', inline: true },
        { name: 'TTL', value: `${Math.round(memoryTtlMs / 60000)} min`, inline: true }
    );

    return embed;
}

function buildAiPanelRows(ownerId) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`aipanel:toggle:${ownerId}`)
            .setLabel('تشغيل/إيقاف')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`aipanel:channel:${ownerId}`)
            .setLabel('تحديد الروم')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`aipanel:url:${ownerId}`)
            .setLabel('تغيير الرابط')
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`aipanel:model:${ownerId}`)
            .setLabel('تغيير الموديل')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`aipanel:memorytoggle:${ownerId}`)
            .setLabel('ذاكرة On/Off')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`aipanel:memoryclear:${ownerId}`)
            .setLabel('مسح الذاكرة')
            .setStyle(ButtonStyle.Danger)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`aipanel:tuning:${ownerId}`)
            .setLabel('إعدادات متقدمة')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`aipanel:refresh:${ownerId}`)
            .setLabel('تحديث اللوحة')
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2, row3];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai')
        .setDescription('لوحة تحكم الذكاء الصناعي (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    buildAiPanelEmbed,
    buildAiPanelRows,

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'اسفة بس هذا الأمر للإدمن فقط 3:', flags: MessageFlags.Ephemeral });
        }

        const ownerId = String(interaction.user.id);
        const embed = buildAiPanelEmbed(interaction.guild.id);
        const components = buildAiPanelRows(ownerId);
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch {
            // ignore
        }
        try {
            return await interaction.editReply({ embeds: [embed], components });
        } catch {
            try {
                return await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
            } catch {
                return;
            }
        }
    }
};
