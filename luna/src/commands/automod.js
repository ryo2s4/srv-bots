const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

function getAutoModCfg(guildId) {
    const cfg = getGuildConfig(guildId);
    const a = cfg.automod && typeof cfg.automod === 'object' ? cfg.automod : {};

    const windowMs = Math.max(1000, Math.min(60_000, Math.floor(Number(a.windowMs) || 10_000)));
    const maxMessages = Math.max(1, Math.min(50, Math.floor(Number(a.maxMessages) || 12)));
    const maxLinks = Math.max(0, Math.min(20, Math.floor(Number(a.maxLinks) || 3)));
    const timeoutSeconds = Math.max(0, Math.min(60 * 60 * 24 * 7, Math.floor(Number(a.timeoutSeconds) || 60)));

    const actionRaw = String(a.action || 'log');
    const action = ['log', 'delete', 'timeout', 'delete_timeout'].includes(actionRaw) ? actionRaw : 'log';

    const ignoredRoleIds = Array.isArray(a.ignoredRoleIds) ? a.ignoredRoleIds.map(String).filter(Boolean).slice(0, 30) : [];
    const ignoredChannelIds = Array.isArray(a.ignoredChannelIds) ? a.ignoredChannelIds.map(String).filter(Boolean).slice(0, 30) : [];

    const joinInviteLogChannelId = typeof a.joinInviteLogChannelId === 'string' ? a.joinInviteLogChannelId : null;

    const rc = a.rulesConfig && typeof a.rulesConfig === 'object' ? a.rulesConfig : {};
    const rulesConfig = {
        linkWhitelist: Array.isArray(rc.linkWhitelist) ? rc.linkWhitelist.filter((s) => typeof s === 'string').slice(0, 50) : [],
        maxMentions: Math.max(0, Math.floor(Number(rc.maxMentions) || 5)),
        maxCapsPercent: Math.max(0, Math.min(100, Math.floor(Number(rc.maxCapsPercent) || 70))),
        maxRepeats: Math.max(0, Math.floor(Number(rc.maxRepeats) || 3)),
        repeatWindowMs: Math.max(1000, Math.floor(Number(rc.repeatWindowMs) || 30000))
    };

    return {
        enabled: a.enabled === true,
        windowMs,
        maxMessages,
        maxLinks,
        action,
        timeoutSeconds,
        ignoreAdmins: a.ignoreAdmins !== false,
        ignoredRoleIds,
        ignoredChannelIds,
        joinInviteLogChannelId,
        rulesConfig
    };
}

function actionLabel(action) {
    if (action === 'log') return 'لوق فقط';
    if (action === 'delete') return 'حذف الرسالة';
    if (action === 'timeout') return 'Timeout';
    if (action === 'delete_timeout') return 'حذف + Timeout';
    return 'لوق فقط';
}

function buildAutoModEmbed(guildId) {
    const a = getAutoModCfg(guildId);
    const onOff = (x) => (x ? '✅' : '⛔');

    const ignoredCh = a.ignoredChannelIds.length ? a.ignoredChannelIds.map((id) => `<#${id}>`).join(' ') : 'لا يوجد';
    const ignoredRoles = a.ignoredRoleIds.length ? a.ignoredRoleIds.map((id) => `<@&${id}>`).join(' ') : 'لا يوجد';

    const joinLog = a.joinInviteLogChannelId ? `<#${a.joinInviteLogChannelId}>` : 'غير محدد';

    const rc = a.rulesConfig;
    const whitelistPreview = rc.linkWhitelist.length > 0
        ? rc.linkWhitelist.slice(0, 3).join(', ') + (rc.linkWhitelist.length > 3 ? ` (+${rc.linkWhitelist.length - 3})` : '')
        : 'لا يوجد';

    return UI.embed({
        title: '🛡️ لوحة AutoMod (خفيف)',
        color: UI.COLORS.mod,
        description:
            'حماية خفيفة من السبام والروابط والمنشن الزايد 🛡️\n\n' +
            `> **الحالة:** ${a.enabled ? 'شغال ✅' : 'مقفل ⛔'}\n` +
            `> **النافذة:** ${UI.fmtDuration(a.windowMs)}\n` +
            `> **حد الرسائل:** ${UI.fmtNum(a.maxMessages)}\n` +
            `> **حد الروابط:** ${UI.fmtNum(a.maxLinks)}\n` +
            `> **الإجراء:** ${actionLabel(a.action)}\n` +
            `> **مدة الـ Timeout:** ${UI.fmtDuration(a.timeoutSeconds * 1000)}\n` +
            `> **تجاهل الأدمن/المود:** ${onOff(a.ignoreAdmins)}\n` +
            `> **لوق دخول + انفايت:** ${joinLog}\n\n` +
            `**🚫 استثناء رومات:** ${ignoredCh}\n` +
            `**🚫 استثناء رولات:** ${ignoredRoles}`,
        fields: [
            { name: '⚙️ قواعد إضافية', value: `المنشن: **${UI.fmtNum(rc.maxMentions)}**\nCaps: **${UI.fmtNum(rc.maxCapsPercent)}%**\nتكرار: **${UI.fmtNum(rc.maxRepeats)}**\nWhitelist روابط: ${whitelistPreview}`, inline: false }
        ]
    });
}

function buildAutoModRows(ownerId) {
    const row1 = UI.row(
        UI.btn(`automodpanel:toggle:${ownerId}`, '⏯️ تشغيل/إيقاف', { style: ButtonStyle.Primary }),
        UI.btn(`automodpanel:action:${ownerId}`, '🎯 تغيير الإجراء', { style: ButtonStyle.Secondary }),
        UI.btn(`automodpanel:thresholds:${ownerId}`, '📊 الحدود', { style: ButtonStyle.Secondary }),
        UI.btn(`automodpanel:ignore:${ownerId}`, '🚫 الاستثناءات', { style: ButtonStyle.Secondary }),
        UI.btn(`automodpanel:refresh:${ownerId}`, '🔄 تحديث', { style: ButtonStyle.Secondary })
    );
    const row2 = UI.row(
        UI.btn(`automodpanel:ignoreadmins:${ownerId}`, '👔 تجاهل الأدمن/المود', { style: ButtonStyle.Secondary }),
        UI.btn(`automodpanel:rules:${ownerId}`, '📜 قواعد إضافية', { style: ButtonStyle.Secondary }),
        UI.btn(`automodpanel:joininvitelog:${ownerId}`, '📥 لوق الدخول + انفايت', { style: ButtonStyle.Secondary })
    );
    return [row1, row2];
}

function nextAction(cur) {
    const order = ['log', 'delete', 'timeout', 'delete_timeout'];
    const i = Math.max(0, order.indexOf(cur));
    return order[(i + 1) % order.length];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('لوحة إعداد AutoMod (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const ownerId = String(interaction.user.id);
        const embed = buildAutoModEmbed(interaction.guild.id);
        const components = buildAutoModRows(ownerId);
        return interaction.reply({ embeds: [embed], components, ephemeral: true });
    },

    buildAutoModEmbed,
    buildAutoModRows,
    getAutoModCfg,
    nextAction,

    buildThresholdsModal(ownerId, guildId) {
        const a = getAutoModCfg(guildId);
        const modal = new ModalBuilder()
            .setCustomId(`automodpanelModal:thresholds:${ownerId}`)
            .setTitle('إعداد حدود AutoMod');

        const windowSec = new TextInputBuilder()
            .setCustomId('windowSec')
            .setLabel('النافذة بالثواني (1-60)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(Math.floor(a.windowMs / 1000)).slice(0, 100));

        const maxMessages = new TextInputBuilder()
            .setCustomId('maxMessages')
            .setLabel('حد الرسائل داخل النافذة (1-50)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(a.maxMessages).slice(0, 100));

        const maxLinks = new TextInputBuilder()
            .setCustomId('maxLinks')
            .setLabel('حد الروابط داخل النافذة (0-20)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(a.maxLinks).slice(0, 100));

        const timeoutSeconds = new TextInputBuilder()
            .setCustomId('timeoutSeconds')
            .setLabel('مدة الـ Timeout بالثواني (0-604800)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(a.timeoutSeconds).slice(0, 100));

        modal.addComponents(
            new ActionRowBuilder().addComponents(windowSec),
            new ActionRowBuilder().addComponents(maxMessages),
            new ActionRowBuilder().addComponents(maxLinks),
            new ActionRowBuilder().addComponents(timeoutSeconds)
        );

        return modal;
    },

    buildIgnoreModal(ownerId, guildId) {
        const a = getAutoModCfg(guildId);
        const modal = new ModalBuilder()
            .setCustomId(`automodpanelModal:ignore:${ownerId}`)
            .setTitle('استثناءات AutoMod');

        const channels = new TextInputBuilder()
            .setCustomId('ignoredChannelIds')
            .setLabel('Channel IDs مفصولة بفواصل (أو none)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(a.ignoredChannelIds.join(', ').slice(0, 900) || ' ');

        const roles = new TextInputBuilder()
            .setCustomId('ignoredRoleIds')
            .setLabel('Role IDs مفصولة بفواصل (أو none)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(a.ignoredRoleIds.join(', ').slice(0, 900) || ' ');

        modal.addComponents(
            new ActionRowBuilder().addComponents(channels),
            new ActionRowBuilder().addComponents(roles)
        );

        return modal;
    },

    parseIdList(raw) {
        const s = String(raw || '').trim();
        if (!s) return [];
        if (s.toLowerCase() === 'none' || s === '0') return [];
        const parts = s.split(/[,\n\s]+/g).map((x) => x.trim()).filter(Boolean);
        return parts.filter((x) => /^\d+$/.test(x)).slice(0, 30);
    },

    applyThresholds(guildId, values) {
        const windowMs = Math.max(1000, Math.min(60_000, Math.floor((Number(values.windowSec) || 10) * 1000)));
        const maxMessages = Math.max(1, Math.min(50, Math.floor(Number(values.maxMessages) || 12)));
        const maxLinks = Math.max(0, Math.min(20, Math.floor(Number(values.maxLinks) || 3)));
        const timeoutSeconds = Math.max(0, Math.min(60 * 60 * 24 * 7, Math.floor(Number(values.timeoutSeconds) || 60)));

        updateGuildConfig(guildId, (c) => ({
            ...c,
            automod: {
                ...(c.automod && typeof c.automod === 'object' ? c.automod : {}),
                windowMs,
                maxMessages,
                maxLinks,
                timeoutSeconds
            }
        }));
    },

    applyIgnore(guildId, ignoredChannelIds, ignoredRoleIds) {
        updateGuildConfig(guildId, (c) => ({
            ...c,
            automod: {
                ...(c.automod && typeof c.automod === 'object' ? c.automod : {}),
                ignoredChannelIds,
                ignoredRoleIds
            }
        }));
    },

    buildRulesModal(ownerId, guildId) {
        const a = getAutoModCfg(guildId);
        const rc = a.rulesConfig;
        const modal = new ModalBuilder()
            .setCustomId(`automodpanelModal:rules:${ownerId}`)
            .setTitle('قواعد AutoMod الإضافية');

        const maxMentions = new TextInputBuilder()
            .setCustomId('maxMentions')
            .setLabel('حد المنشنات (0 = تعطيل)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(rc.maxMentions));

        const maxCapsPercent = new TextInputBuilder()
            .setCustomId('maxCapsPercent')
            .setLabel('حد الـ Caps % (0-100)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(rc.maxCapsPercent));

        const maxRepeats = new TextInputBuilder()
            .setCustomId('maxRepeats')
            .setLabel('حد التكرار (0 = تعطيل)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(rc.maxRepeats));

        const whitelist = new TextInputBuilder()
            .setCustomId('linkWhitelist')
            .setLabel('Whitelist روابط (مفصولة بفواصل)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(rc.linkWhitelist.join(', ').slice(0, 900) || ' ');

        modal.addComponents(
            new ActionRowBuilder().addComponents(maxMentions),
            new ActionRowBuilder().addComponents(maxCapsPercent),
            new ActionRowBuilder().addComponents(maxRepeats),
            new ActionRowBuilder().addComponents(whitelist)
        );

        return modal;
    },

    applyRules(guildId, values) {
        const maxMentions = Math.max(0, Math.floor(Number(values.maxMentions) || 0));
        const maxCapsPercent = Math.max(0, Math.min(100, Math.floor(Number(values.maxCapsPercent) || 0)));
        const maxRepeats = Math.max(0, Math.floor(Number(values.maxRepeats) || 0));

        const rawWhitelist = String(values.linkWhitelist || '').trim();
        const linkWhitelist = rawWhitelist
            ? rawWhitelist.split(/[,\n\s]+/g).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0).slice(0, 50)
            : [];

        updateGuildConfig(guildId, (c) => ({
            ...c,
            automod: {
                ...(c.automod && typeof c.automod === 'object' ? c.automod : {}),
                rulesConfig: {
                    ...(c.automod?.rulesConfig || {}),
                    maxMentions,
                    maxCapsPercent,
                    maxRepeats,
                    linkWhitelist
                }
            }
        }));
    },

    buildJoinInviteLogModal(ownerId, guildId) {
        const cfg = getGuildConfig(guildId);
        const cur = cfg && cfg.automod && typeof cfg.automod === 'object' && typeof cfg.automod.joinInviteLogChannelId === 'string'
            ? cfg.automod.joinInviteLogChannelId
            : '';

        const modal = new ModalBuilder()
            .setCustomId(`automodpanelModal:joininvitelog:${ownerId}`)
            .setTitle('لوق دخول الأعضاء + الانفايت');

        const channelId = new TextInputBuilder()
            .setCustomId('channelId')
            .setLabel('Channel ID (أو none للإيقاف)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(String(cur).slice(0, 100) || ' ');

        modal.addComponents(new ActionRowBuilder().addComponents(channelId));
        return modal;
    },

    applyJoinInviteLogChannel(guildId, channelId) {
        updateGuildConfig(guildId, (c) => ({
            ...c,
            automod: {
                ...(c.automod && typeof c.automod === 'object' ? c.automod : {}),
                joinInviteLogChannelId: channelId
            }
        }));
    }
};
