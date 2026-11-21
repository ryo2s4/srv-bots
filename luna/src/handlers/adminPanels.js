const { PermissionsBitField, MessageFlags, EmbedBuilder } = require('discord.js');

const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const { ensureAntiRaidVerifyRole, setAntiRaidRoleOverwrites } = require('../securityService');

async function handleSecurityPanel({ client, interaction }) {
    if (!interaction.isButton() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('securitypanel:')) return false;
    if (!interaction.guild) return true;

    const parts = interaction.customId.split(':');
    const action = parts[1] || '';
    const ownerId = parts[2] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', flags: MessageFlags.Ephemeral }).then(() => true).catch(() => true);
    }

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس هذا الخيار للإدمن فقط 3:', flags: MessageFlags.Ephemeral }).then(() => true).catch(() => true);
    }

    const secCmd = client.commands.get('security');
    const buildEmbed = secCmd && typeof secCmd.buildSecurityPanelEmbed === 'function' ? secCmd.buildSecurityPanelEmbed : null;
    const buildRows = secCmd && typeof secCmd.buildSecurityPanelRows === 'function' ? secCmd.buildSecurityPanelRows : null;

    const refreshPanel = async () => {
        if (!buildEmbed || !buildRows) return;
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        try {
            if (interaction.deferred || interaction.replied) {
                return await interaction.editReply({ embeds: [embed], components });
            }
        } catch {
        }
        try {
            return await interaction.update({ embeds: [embed], components });
        } catch {
            try {
                return await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
            } catch {
                return;
            }
        }
    };

    const openModal = async (customId, title, fields) => {
        const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
        for (const f of fields) {
            const input = new TextInputBuilder()
                .setCustomId(f.id)
                .setLabel(f.label)
                .setStyle(f.style || TextInputStyle.Short)
                .setRequired(Boolean(f.required));
            if (typeof f.placeholder === 'string') input.setPlaceholder(f.placeholder);
            if (typeof f.value === 'string' && f.value !== '') input.setValue(f.value);
            if (typeof f.maxLength === 'number') input.setMaxLength(f.maxLength);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        }
        return interaction.showModal(modal);
    };

    if (action === 'refresh') {
        try { await interaction.deferUpdate(); } catch {
        }
        await refreshPanel();
        return true;
    }

    if (action === 'toggle') {
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            antiRaid: {
                ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                enabled: !(c.antiRaid && typeof c.antiRaid === 'object' && c.antiRaid.enabled === true)
            }
        }));
        try { await interaction.deferUpdate(); } catch {
        }
        await refreshPanel();
        return true;
    }

    if (action === 'verifytoggle') {
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            antiRaid: {
                ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                verifyEnabled: !(c.antiRaid && typeof c.antiRaid === 'object' && c.antiRaid.verifyEnabled === true)
            }
        }));
        try { await interaction.deferUpdate(); } catch {
        }
        await refreshPanel();
        return true;
    }

    if (action === 'set_channel') {
        const cfg = getGuildConfig(interaction.guild.id);
        const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : {};
        const current = typeof ar.verifyChannelId === 'string' ? ar.verifyChannelId : '';
        await openModal(
            `securityModal:channel:${ownerId}`,
            'تحديد روم التحقق',
            [{
                id: 'channel',
                label: 'اكتب ID الروم أو منشن مثل #verify',
                required: true,
                value: current,
                maxLength: 80
            }]
        );
        return true;
    }

    if (action === 'thresholds') {
        const cfg = getGuildConfig(interaction.guild.id);
        const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : {};
        const windowSec = Math.max(10, Math.floor((Number(ar.joinWindowMs) || 60_000) / 1000));
        const threshold = Math.max(2, Math.floor(Number(ar.joinThreshold) || 6));
        const lockMin = Math.max(1, Math.floor((Number(ar.lockdownMs) || (20 * 60_000)) / 60_000));
        await openModal(
            `securityModal:thresholds:${ownerId}`,
            'إعدادات الحساسية',
            [
                { id: 'window', label: 'نافذة الانضمام (ثواني)', required: true, value: String(windowSec), maxLength: 10 },
                { id: 'threshold', label: 'عدد الانضمامات لتفعيل الحماية', required: true, value: String(threshold), maxLength: 10 },
                { id: 'lockmin', label: 'مدة الـ Lockdown (دقائق)', required: true, value: String(lockMin), maxLength: 10 }
            ]
        );
        return true;
    }

    if (action === 'lockdown') {
        const cfg = getGuildConfig(interaction.guild.id);
        const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : {};
        const now = Date.now();
        const lockMs = Math.max(60_000, Math.floor(Number(ar.lockdownMs) || (20 * 60_000)));
        const until = now + lockMs;

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            antiRaid: {
                ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                lockdownUntil: until
            }
        }));

        try {
            const nextCfg = getGuildConfig(interaction.guild.id);
            const nar = nextCfg.antiRaid;
            if (nar && nar.verifyEnabled === true) {
                const role = await ensureAntiRaidVerifyRole(interaction.guild, nar.verifyRoleId ? nar.verifyRoleId : null);
                if (role) {
                    if (!nar.verifyRoleId || String(nar.verifyRoleId) !== String(role.id)) {
                        updateGuildConfig(interaction.guild.id, (c) => ({
                            ...c,
                            antiRaid: {
                                ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                                verifyRoleId: role.id
                            }
                        }));
                    }
                    await setAntiRaidRoleOverwrites(interaction.guild, role.id, true);
                }
            }
        } catch {
        }

        try { await interaction.deferUpdate(); } catch {
        }
        await refreshPanel();
        return true;
    }

    if (action === 'unlock') {
        const cfg = getGuildConfig(interaction.guild.id);
        const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : {};
        const roleId = typeof ar.verifyRoleId === 'string' ? ar.verifyRoleId : '';
        if (roleId) {
            try {
                await setAntiRaidRoleOverwrites(interaction.guild, roleId, false);
            } catch {
            }
        }
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            antiRaid: {
                ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                lockdownUntil: 0
            }
        }));
        try { await interaction.deferUpdate(); } catch {
        }
        await refreshPanel();
        return true;
    }

    try {
        await interaction.reply({ content: '❌ خيار غير معروف 3:', flags: MessageFlags.Ephemeral });
    } catch {
        return true;
    }
    return true;
}

async function handleSecurityModal({ client, interaction }) {
    if (!interaction.isModalSubmit() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('securityModal:')) return false;
    if (!interaction.guild) return true;
    const parts = interaction.customId.split(':');
    const kind = parts[1] || '';
    const ownerId = parts[2] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', flags: MessageFlags.Ephemeral }).then(() => true).catch(() => true);
    }

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس هذا الخيار للإدمن فقط 3:', flags: MessageFlags.Ephemeral }).then(() => true).catch(() => true);
    }

    const secCmd = client.commands.get('security');
    const buildEmbed = secCmd && typeof secCmd.buildSecurityPanelEmbed === 'function' ? secCmd.buildSecurityPanelEmbed : null;
    const buildRows = secCmd && typeof secCmd.buildSecurityPanelRows === 'function' ? secCmd.buildSecurityPanelRows : null;

    const refreshPanel = async () => {
        if (!buildEmbed || !buildRows) return;
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        return interaction.editReply({ embeds: [embed], components });
    };

    if (kind === 'channel') {
        const raw = String(interaction.fields.getTextInputValue('channel') || '').trim();
        const match = raw.match(/^(?:<#(\d+)>|(\d+))$/);
        const channelId = match ? (match[1] || match[2]) : '';
        if (!channelId) {
            return interaction.reply({ content: 'اكتب ID صحيح أو منشن للروم مثل #verify', flags: MessageFlags.Ephemeral }).then(() => true).catch(() => true);
        }
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            antiRaid: {
                ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                verifyChannelId: channelId
            }
        }));
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        await refreshPanel();
        return true;
    }

    if (kind === 'thresholds') {
        const windowSec = Math.max(10, Math.floor(Number(interaction.fields.getTextInputValue('window')) || 60));
        const threshold = Math.max(2, Math.floor(Number(interaction.fields.getTextInputValue('threshold')) || 6));
        const lockMin = Math.max(1, Math.floor(Number(interaction.fields.getTextInputValue('lockmin')) || 20));

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            antiRaid: {
                ...(c.antiRaid && typeof c.antiRaid === 'object' ? c.antiRaid : {}),
                joinWindowMs: windowSec * 1000,
                joinThreshold: threshold,
                lockdownMs: lockMin * 60_000
            }
        }));

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        await refreshPanel();
        return true;
    }

    return interaction.reply({ content: '❌ خيار غير معروف 3:', flags: MessageFlags.Ephemeral }).then(() => true).catch(() => true);
}

async function handleLogsPanelModal({ client, interaction }) {
    if (!interaction.isModalSubmit() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('logspanelModal:')) return false;
    if (!interaction.guild) return true;
    const parts = interaction.customId.split(':');
    const action = parts[1] || '';
    const ownerId = parts[2] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }).then(() => true).catch(() => true);
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    const raw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
    if (action === 'exclude' && (!raw || raw.toLowerCase() === 'none' || raw === '0')) {
        updateGuildConfig(interaction.guild.id, (c) => ({ ...c, logsExcludeChannelId: null }));
    } else {
        if (!raw || !/^\d+$/.test(raw)) {
            return interaction.reply({ content: 'اكتب ID صحيح 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
        let ch;
        try {
            ch = await interaction.guild.channels.fetch(raw);
        } catch {
            ch = null;
        }
        if (!ch) return interaction.reply({ content: 'ما لقيت هذا الروم 3:', ephemeral: true }).then(() => true).catch(() => true);

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            ...(action === 'channel' ? { logsChannelId: ch.id } : {}),
            ...(action === 'exclude' ? { logsExcludeChannelId: ch.id } : {})
        }));
    }

    const logsCmd = client.commands.get('logs');
    const buildEmbed = logsCmd && typeof logsCmd.buildLogsPanelEmbed === 'function' ? logsCmd.buildLogsPanelEmbed : null;
    const buildRows = logsCmd && typeof logsCmd.buildLogsPanelRows === 'function' ? logsCmd.buildLogsPanelRows : null;

    try {
        await interaction.deferReply({ ephemeral: true });
    } catch {
        // ignore
    }

    if (buildEmbed && buildRows) {
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        await interaction.editReply({ embeds: [embed], components });
        return true;
    }
    await interaction.editReply({ content: '✅ تم.', components: [] });
    return true;
}

async function handleLogsPanel({ client, interaction }) {
    const isBtn = typeof interaction.isButton === 'function' && interaction.isButton();
    const isCatSelect = typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()
        && typeof interaction.customId === 'string' && interaction.customId.startsWith('logspanelSelect:');
    if (!isBtn && !isCatSelect) return false;
    if (typeof interaction.customId !== 'string') return false;
    if (isBtn && !interaction.customId.startsWith('logspanel:')) return false;
    if (!interaction.guild) return true;

    const ownerId = interaction.customId.split(':')[2] || '';
    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }).then(() => true).catch(() => true);
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    const action = interaction.customId.split(':')[1] || '';
    const logsCmd = client.commands.get('logs');
    const buildEmbed = logsCmd && typeof logsCmd.buildLogsPanelEmbed === 'function' ? logsCmd.buildLogsPanelEmbed : null;
    const buildRows = logsCmd && typeof logsCmd.buildLogsPanelRows === 'function' ? logsCmd.buildLogsPanelRows : null;
    const buildSelect = logsCmd && typeof logsCmd.buildCategoriesSelect === 'function' ? logsCmd.buildCategoriesSelect : null;

    // SELECT MENU: logspanelSelect:categories:<ownerId> — toggle log categories
    if (isCatSelect) {
        const selected = Array.isArray(interaction.values) ? interaction.values.map(String) : [];
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            logs: {
                ...(c.logs && typeof c.logs === 'object' ? c.logs : {}),
                categories: {
                    ...(c.logs && typeof c.logs === 'object' && c.logs.categories && typeof c.logs.categories === 'object' ? c.logs.categories : {}),
                    messages: selected.includes('messages'),
                    moderation: selected.includes('moderation'),
                    roles: selected.includes('roles'),
                    channels: selected.includes('channels'),
                    guild: selected.includes('guild'),
                    economy: selected.includes('economy'),
                    tickets: selected.includes('tickets'),
                    suggestions: selected.includes('suggestions')
                }
            }
        }));
        if (buildEmbed && buildRows && buildSelect) {
            const embed = buildEmbed(interaction.guild.id);
            const rows = buildRows(ownerId || interaction.user.id);
            const selectRow = buildSelect(ownerId || interaction.user.id, interaction.guild.id);
            await interaction.update({ embeds: [embed], components: [...rows, selectRow] });
            return true;
        }
        await interaction.update({ content: '✅ تم.', components: [], embeds: [] });
        return true;
    }

    if (action === 'toggle') {
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            logs: {
                ...(c.logs && typeof c.logs === 'object' ? c.logs : {}),
                enabled: !(c.logs && typeof c.logs === 'object' && c.logs.enabled === true)
            }
        }));
    }

    if (action === 'refresh' || action === 'toggle') {
        if (buildEmbed && buildRows) {
            const embed = buildEmbed(interaction.guild.id);
            const components = buildRows(ownerId || interaction.user.id);
            await interaction.update({ embeds: [embed], components });
            return true;
        }
        await interaction.update({ content: '✅ تم.', components: [], embeds: [] });
        return true;
    }

    if (action === 'categories') {
        if (!buildEmbed || !buildRows || !buildSelect) {
            return interaction.reply({ content: 'آسف بس لوحة اللوقز مو جاهزة 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
        const embed = buildEmbed(interaction.guild.id);
        const rows = buildRows(ownerId || interaction.user.id);
        const selectRow = buildSelect(ownerId || interaction.user.id, interaction.guild.id);
        await interaction.update({ embeds: [embed], components: [...rows, selectRow] });
        return true;
    }

    if (action === 'channel' || action === 'exclude') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const cfg = getGuildConfig(interaction.guild.id);
        const cur = action === 'channel'
            ? (typeof cfg.logsChannelId === 'string' ? cfg.logsChannelId : '')
            : (typeof cfg.logsExcludeChannelId === 'string' ? cfg.logsExcludeChannelId : '');

        const modal = new ModalBuilder()
            .setCustomId(`logspanelModal:${action}:${ownerId}`)
            .setTitle(action === 'channel' ? 'تحديد روم اللوقز' : 'تحديد روم الاستثناء');

        const input = new TextInputBuilder()
            .setCustomId('channelId')
            .setLabel('اكتب Channel ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(action === 'channel');
        if (String(cur)) input.setValue(String(cur).slice(0, 100));

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        try {
            await interaction.showModal(modal);
            return true;
        } catch {
            return interaction.reply({ content: 'آسف بس ما قدرت أفتح الفورم 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
    }

    return interaction.reply({ content: 'آسف بس ما فهمت 3:', ephemeral: true }).then(() => true).catch(() => true);
}

async function handleAutoModPanelModal({ client, interaction }) {
    if (!interaction.isModalSubmit() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('automodpanelModal:')) return false;
    if (!interaction.guild) return true;
    const parts = interaction.customId.split(':');
    const action = parts[1] || '';
    const ownerId = parts[2] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }).then(() => true).catch(() => true);
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    const amCmd = client.commands.get('automod');
    const buildEmbed = amCmd && typeof amCmd.buildAutoModEmbed === 'function' ? amCmd.buildAutoModEmbed : null;
    const buildRows = amCmd && typeof amCmd.buildAutoModRows === 'function' ? amCmd.buildAutoModRows : null;

    if (action === 'thresholds') {
        const windowSec = String(interaction.fields.getTextInputValue('windowSec') || '').trim();
        const maxMessages = String(interaction.fields.getTextInputValue('maxMessages') || '').trim();
        const maxLinks = String(interaction.fields.getTextInputValue('maxLinks') || '').trim();
        const timeoutSeconds = String(interaction.fields.getTextInputValue('timeoutSeconds') || '').trim();

        if (amCmd && typeof amCmd.applyThresholds === 'function') {
            amCmd.applyThresholds(interaction.guild.id, { windowSec, maxMessages, maxLinks, timeoutSeconds });
        }
    }

    if (action === 'ignore') {
        const rawChannels = String(interaction.fields.getTextInputValue('ignoredChannelIds') || '').trim();
        const rawRoles = String(interaction.fields.getTextInputValue('ignoredRoleIds') || '').trim();
        const parse = amCmd && typeof amCmd.parseIdList === 'function' ? amCmd.parseIdList : null;
        const ignoredChannelIds = parse ? parse(rawChannels) : [];
        const ignoredRoleIds = parse ? parse(rawRoles) : [];
        if (amCmd && typeof amCmd.applyIgnore === 'function') {
            amCmd.applyIgnore(interaction.guild.id, ignoredChannelIds, ignoredRoleIds);
        }
    }

    if (action === 'rules') {
        const maxMentions = String(interaction.fields.getTextInputValue('maxMentions') || '').trim();
        const maxCapsPercent = String(interaction.fields.getTextInputValue('maxCapsPercent') || '').trim();
        const maxRepeats = String(interaction.fields.getTextInputValue('maxRepeats') || '').trim();
        const linkWhitelist = String(interaction.fields.getTextInputValue('linkWhitelist') || '').trim();

        if (amCmd && typeof amCmd.applyRules === 'function') {
            amCmd.applyRules(interaction.guild.id, { maxMentions, maxCapsPercent, maxRepeats, linkWhitelist });
        }
    }

    if (action === 'joininvitelog') {
        const raw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
        const channelId = (!raw || raw.toLowerCase() === 'none' || raw === '0')
            ? null
            : (/^\d+$/.test(raw) ? raw : null);
        if (amCmd && typeof amCmd.applyJoinInviteLogChannel === 'function') {
            amCmd.applyJoinInviteLogChannel(interaction.guild.id, channelId);
        }
    }

    try {
        await interaction.deferReply({ ephemeral: true });
    } catch {
        // ignore
    }

    if (buildEmbed && buildRows) {
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        await interaction.editReply({ embeds: [embed], components });
        return true;
    }
    await interaction.editReply({ content: '✅ تم.', components: [] });
    return true;
}

async function handleAutoModPanel({ client, interaction }) {
    if (!interaction.isButton() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('automodpanel:')) return false;
    if (!interaction.guild) return true;

    const ownerId = interaction.customId.split(':')[2] || '';
    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }).then(() => true).catch(() => true);
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    const action = interaction.customId.split(':')[1] || '';
    const amCmd = client.commands.get('automod');
    const buildEmbed = amCmd && typeof amCmd.buildAutoModEmbed === 'function' ? amCmd.buildAutoModEmbed : null;
    const buildRows = amCmd && typeof amCmd.buildAutoModRows === 'function' ? amCmd.buildAutoModRows : null;

    if (action === 'toggle') {
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            automod: {
                ...(c.automod && typeof c.automod === 'object' ? c.automod : {}),
                enabled: !(c.automod && typeof c.automod === 'object' && c.automod.enabled === true)
            }
        }));
    }

    if (action === 'ignoreadmins') {
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            automod: {
                ...(c.automod && typeof c.automod === 'object' ? c.automod : {}),
                ignoreAdmins: !(c.automod && typeof c.automod === 'object' && c.automod.ignoreAdmins === false)
                    ? false
                    : true
            }
        }));
    }

    if (action === 'action') {
        const cur = getGuildConfig(interaction.guild.id);
        const a = cur.automod && typeof cur.automod === 'object' ? cur.automod : {};
        const curAction = String(a.action || 'log');
        const next = amCmd && typeof amCmd.nextAction === 'function' ? amCmd.nextAction(curAction) : 'log';
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            automod: {
                ...(c.automod && typeof c.automod === 'object' ? c.automod : {}),
                action: next
            }
        }));
    }

    if (action === 'thresholds') {
        if (!amCmd || typeof amCmd.buildThresholdsModal !== 'function') {
            return interaction.reply({ content: 'آسف بس لوحة AutoMod مو جاهزة 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
        const modal = amCmd.buildThresholdsModal(ownerId || interaction.user.id, interaction.guild.id);
        try {
            await interaction.showModal(modal);
            return true;
        } catch {
            return interaction.reply({ content: 'آسف بس ما قدرت أفتح الفورم 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
    }

    if (action === 'ignore') {
        if (!amCmd || typeof amCmd.buildIgnoreModal !== 'function') {
            return interaction.reply({ content: 'آسف بس لوحة AutoMod مو جاهزة 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
        const modal = amCmd.buildIgnoreModal(ownerId || interaction.user.id, interaction.guild.id);
        try {
            await interaction.showModal(modal);
            return true;
        } catch {
            return interaction.reply({ content: 'آسف بس ما قدرت أفتح الفورم 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
    }

    if (action === 'rules') {
        if (!amCmd || typeof amCmd.buildRulesModal !== 'function') {
            return interaction.reply({ content: 'آسف بس لوحة AutoMod مو جاهزة 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
        const modal = amCmd.buildRulesModal(ownerId || interaction.user.id, interaction.guild.id);
        try {
            await interaction.showModal(modal);
            return true;
        } catch {
            return interaction.reply({ content: 'آسف بس ما قدرت أفتح الفورم 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
    }

    if (action === 'joininvitelog') {
        if (!amCmd || typeof amCmd.buildJoinInviteLogModal !== 'function') {
            return interaction.reply({ content: 'آسف بس لوحة AutoMod مو جاهزة 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
        const modal = amCmd.buildJoinInviteLogModal(ownerId || interaction.user.id, interaction.guild.id);
        try {
            await interaction.showModal(modal);
            return true;
        } catch {
            return interaction.reply({ content: 'آسف بس ما قدرت أفتح الفورم 3:', ephemeral: true }).then(() => true).catch(() => true);
        }
    }

    if (action === 'refresh' || action === 'toggle' || action === 'action' || action === 'ignoreadmins') {
        if (buildEmbed && buildRows) {
            const embed = buildEmbed(interaction.guild.id);
            const components = buildRows(ownerId || interaction.user.id);
            await interaction.update({ embeds: [embed], components });
            return true;
        }
        await interaction.update({ content: '✅ تم.', components: [], embeds: [] });
        return true;
    }

    return interaction.reply({ content: 'آسف بس ما فهمت 3:', ephemeral: true }).then(() => true).catch(() => true);
}

async function handleAiModPanel({ client, interaction }) {
    if (!interaction.isButton() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('aimod:')) return false;
    if (!interaction.guild) return true;
    const parts = interaction.customId.split(':');
    const action = parts[1] || '';
    const ownerId = parts[2] || '';

    const aimodCmd = client.commands.get('aimod');
    if (!aimodCmd) {
        return interaction.reply({ content: 'نظام AI Mod مو محمل 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }).then(() => true).catch(() => true);
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس هذا الخيار للإدمن فقط 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    if (action === 'toggle') {
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            aiMod: {
                ...(c.aiMod && typeof c.aiMod === 'object' ? c.aiMod : {}),
                enabled: !(c.aiMod && typeof c.aiMod === 'object' && c.aiMod.enabled === true)
            }
        }));
        const embed = aimodCmd.buildAiModEmbed(interaction.guild.id);
        const components = aimodCmd.buildAiModRows(ownerId || interaction.user.id, interaction.guild.id);
        await interaction.update({ embeds: [embed], components });
        return true;
    }

    if (action === 'settings') {
        const modal = aimodCmd.buildSettingsModal(ownerId || interaction.user.id, interaction.guild.id);
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'ignores') {
        const modal = aimodCmd.buildIgnoresModal(ownerId || interaction.user.id, interaction.guild.id);
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'refresh') {
        const embed = aimodCmd.buildAiModEmbed(interaction.guild.id);
        const components = aimodCmd.buildAiModRows(ownerId || interaction.user.id, interaction.guild.id);
        await interaction.update({ embeds: [embed], components });
        return true;
    }

    return interaction.reply({ content: 'آسف بس ما فهمت 3:', ephemeral: true }).then(() => true).catch(() => true);
}

async function handleAiModModal({ client, interaction }) {
    if (!interaction.isModalSubmit() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('aimodModal:')) return false;
    if (!interaction.guild) return true;
    const parts = interaction.customId.split(':');
    const kind = parts[1] || '';
    const userId = parts[2] || '';

    const aimodCmd = client.commands.get('aimod');
    if (!aimodCmd) {
        return interaction.reply({ content: 'نظام AI Mod مو محمل 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    if (userId && String(interaction.user.id) !== String(userId)) {
        return interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }).then(() => true).catch(() => true);
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'آسف بس هذا الخيار للإدمن فقط 3:', ephemeral: true }).then(() => true).catch(() => true);
    }

    if (kind === 'settings') {
        const action = String(interaction.fields.getTextInputValue('action') || 'delete').trim().toLowerCase();
        const timeoutMinutes = Math.max(1, Math.floor(Number(interaction.fields.getTextInputValue('timeoutMinutes')) || 10));
        const threshold = String(interaction.fields.getTextInputValue('threshold') || 'medium').trim().toLowerCase();
        const logChannelId = String(interaction.fields.getTextInputValue('logChannelId') || '').trim();

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            aiMod: {
                ...(c.aiMod && typeof c.aiMod === 'object' ? c.aiMod : {}),
                action: ['delete', 'timeout', 'ban'].includes(action) ? action : 'delete',
                timeoutMinutes,
                threshold: ['low', 'medium', 'high'].includes(threshold) ? threshold : 'medium',
                logChannelId: /^\d+$/.test(logChannelId) ? logChannelId : null
            }
        }));

        const embed = aimodCmd.buildAiModEmbed(interaction.guild.id);
        const components = aimodCmd.buildAiModRows(userId || interaction.user.id, interaction.guild.id);
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        await interaction.editReply({ embeds: [embed], components });
        return true;
    }

    if (kind === 'ignores') {
        const ignoreChannelIds = String(interaction.fields.getTextInputValue('ignoreChannelIds') || '')
            .split(/\s+/)
            .map(s => s.trim())
            .filter(s => /^\d+$/.test(s));
        const ignoreRoleIds = String(interaction.fields.getTextInputValue('ignoreRoleIds') || '')
            .split(/\s+/)
            .map(s => s.trim())
            .filter(s => /^\d+$/.test(s));

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            aiMod: {
                ...(c.aiMod && typeof c.aiMod === 'object' ? c.aiMod : {}),
                ignoreChannelIds,
                ignoreRoleIds
            }
        }));

        const embed = aimodCmd.buildAiModEmbed(interaction.guild.id);
        const components = aimodCmd.buildAiModRows(userId || interaction.user.id, interaction.guild.id);
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        await interaction.editReply({ embeds: [embed], components });
        return true;
    }

    return true;
}

async function handle({ client, interaction }) {
    const handlers = [
        handleSecurityPanel,
        handleSecurityModal,
        handleLogsPanelModal,
        handleLogsPanel,
        handleAutoModPanelModal,
        handleAutoModPanel,
        handleAiModPanel,
        handleAiModModal
    ];

    for (const h of handlers) {
        try {
            const handled = await h({ client, interaction });
            if (handled) return true;
        } catch {
            return true;
        }
    }

    return false;
}

module.exports = { handle };
