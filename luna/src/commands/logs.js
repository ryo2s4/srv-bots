const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

function getLogsCfg(guildId) {
    const cfg = getGuildConfig(guildId);
    const logs = cfg.logs && typeof cfg.logs === 'object' ? cfg.logs : { enabled: true, categories: {} };
    const cats = logs.categories && typeof logs.categories === 'object' ? logs.categories : {};
    return {
        enabled: logs.enabled !== false,
        categories: {
            messages: cats.messages !== false,
            moderation: cats.moderation !== false,
            roles: cats.roles !== false,
            channels: cats.channels !== false,
            guild: cats.guild !== false,
            economy: cats.economy !== false,
            tickets: cats.tickets !== false,
            suggestions: cats.suggestions !== false
        },
        channelId: typeof cfg.logsChannelId === 'string' ? cfg.logsChannelId : null,
        excludeChannelId: typeof cfg.logsExcludeChannelId === 'string' ? cfg.logsExcludeChannelId : null
    };
}

function buildLogsPanelEmbed(guildId) {
    const l = getLogsCfg(guildId);
    const channel = l.channelId ? `<#${l.channelId}>` : 'غير محدد';
    const exclude = l.excludeChannelId ? `<#${l.excludeChannelId}>` : 'لا يوجد';
    const enabled = l.enabled;
    const onOff = (x) => (x ? '✅' : '⛔');
    const cats = l.categories;

    const catLines = [
        `• رسائل: ${onOff(cats.messages)}`,
        `• إدارة/موديريشن: ${onOff(cats.moderation)}`,
        `• رولات: ${onOff(cats.roles)}`,
        `• رومات: ${onOff(cats.channels)}`,
        `• السيرفر: ${onOff(cats.guild)}`,
        `• اقتصاد: ${onOff(cats.economy)}`,
        `• تكتات: ${onOff(cats.tickets)}`,
        `• اقتراحات: ${onOff(cats.suggestions)}`
    ].join('\n');

    return UI.embed({
        title: '🧾 لوحة اللوقز',
        color: UI.COLORS.logs,
        description:
            `> **الحالة:** ${enabled ? 'شغال ✅' : 'مقفل ⛔'}\n` +
            `> **روم اللوقز:** ${channel}\n` +
            `> **الاستثناء:** ${exclude}\n\n` +
            `**📁 التصنيفات:**\n${catLines}\n\n` +
            '_ملاحظة: حذف الصور/الملفات ينرسل في اللوقز إذا كانت موجودة في الكاش._'
    });
}

function buildLogsPanelRows(ownerId) {
    const row1 = UI.row(
        UI.btn(`logspanel:toggle:${ownerId}`, '⏯️ تشغيل/إيقاف', { style: ButtonStyle.Primary }),
        UI.btn(`logspanel:channel:${ownerId}`, '📍 تحديد روم اللوقز', { style: ButtonStyle.Secondary }),
        UI.btn(`logspanel:exclude:${ownerId}`, '🚫 تحديد الاستثناء', { style: ButtonStyle.Secondary }),
        UI.btn(`logspanel:categories:${ownerId}`, '📁 التصنيفات', { style: ButtonStyle.Secondary }),
        UI.btn(`logspanel:refresh:${ownerId}`, '🔄 تحديث', { style: ButtonStyle.Secondary })
    );
    return [row1];
}

function buildCategoriesSelect(ownerId, guildId) {
    const l = getLogsCfg(guildId);
    const cats = l.categories;
    const enabledKeys = Object.keys(cats).filter((k) => cats[k]);

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`logspanelSelect:categories:${ownerId}`)
            .setPlaceholder('اختر التصنيفات اللي تبغاها شغالة')
            .setMinValues(0)
            .setMaxValues(8)
            .addOptions(
                { label: 'رسائل', value: 'messages', default: enabledKeys.includes('messages') },
                { label: 'إدارة/موديريشن', value: 'moderation', default: enabledKeys.includes('moderation') },
                { label: 'رولات', value: 'roles', default: enabledKeys.includes('roles') },
                { label: 'رومات', value: 'channels', default: enabledKeys.includes('channels') },
                { label: 'السيرفر', value: 'guild', default: enabledKeys.includes('guild') },
                { label: 'اقتصاد', value: 'economy', default: enabledKeys.includes('economy') },
                { label: 'تكتات', value: 'tickets', default: enabledKeys.includes('tickets') },
                { label: 'اقتراحات', value: 'suggestions', default: enabledKeys.includes('suggestions') }
            )
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('لوحة إعداد اللوقز (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'آسف بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const ownerId = String(interaction.user.id);
        const embed = buildLogsPanelEmbed(interaction.guild.id);
        const components = buildLogsPanelRows(ownerId);
        return interaction.reply({ embeds: [embed], components, ephemeral: true });
    }
    ,

    buildLogsPanelEmbed,
    buildLogsPanelRows,
    buildCategoriesSelect,
    getLogsCfg
};
