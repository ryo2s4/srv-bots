const { PermissionsBitField } = require('discord.js');
const eventGames = require('../eventGames');
const UI = require('../utils/ui');

async function handleEventsPanelButtons({ client, interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('eventspanel:'))) return false;
    if (!interaction.guild) return true;

    const parts = interaction.customId.split(':');
    const action = parts[1] || '';
    const ownerId = parts[2] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        try { await interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }); } catch { }
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: 'آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
    const eventsCmd = client.commands.get('events');
    const buildEmbed = eventsCmd && typeof eventsCmd.buildEventsPanelEmbed === 'function' ? eventsCmd.buildEventsPanelEmbed : null;
    const buildRows = eventsCmd && typeof eventsCmd.buildEventsPanelRows === 'function' ? eventsCmd.buildEventsPanelRows : null;

    const refreshPanel = async () => {
        if (!buildEmbed || !buildRows) return;
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        try {
            return await interaction.update({ embeds: [embed], components });
        } catch {
            try {
                if (interaction.deferred || interaction.replied) {
                    return await interaction.editReply({ embeds: [embed], components });
                }
            } catch {
            }
            try {
                return await interaction.reply({ embeds: [embed], components, ephemeral: true });
            } catch {
                return;
            }
        }
    };

    if (action === 'toggle') {
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            events: {
                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                enabled: !(c.events && typeof c.events === 'object' && c.events.enabled)
            }
        }));
        await refreshPanel();
        return true;
    }

    if (action === 'refresh') {
        await refreshPanel();
        return true;
    }

    if (action === 'channel') {
        try {
            const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
            const cfg = getGuildConfig(interaction.guild.id);
            const e = cfg.events && typeof cfg.events === 'object' ? cfg.events : {};
            const current = e.channelId ? String(e.channelId) : '';

            const modal = new ModalBuilder()
                .setCustomId(`eventspanelModal:channel:${ownerId}`)
                .setTitle('تحديد روم الفعاليات');

            const input = new TextInputBuilder()
                .setCustomId('channelId')
                .setLabel('اكتب Channel ID للروم (Text)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            if (current) input.setValue(current.slice(0, 100));

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        } catch {
            try { await interaction.reply({ content: 'آسف بس ما قدرت أفتح نافذة تحديد الروم 3:', ephemeral: true }); } catch { }
        }
        return true;
    }

    if (action === 'types') {
        const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
        const cfg = getGuildConfig(interaction.guild.id);
        const e = cfg.events && typeof cfg.events === 'object' ? cfg.events : {};
        const t = e.typesEnabled && typeof e.typesEnabled === 'object' ? e.typesEnabled : {};

        const embed = UI.embed({
            title: '🎉 أنواع الفعاليات',
            color: UI.COLORS.events,
            description: 'اختار الأنواع اللي تبيها تشتغل (اختيار متعدد) — كلها ألعاب تفكير 🧠'
        });

        const values = eventGames.GAME_KEYS.filter((k) => t[k] !== false);

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`eventspanelSelect:types:${ownerId}`)
                .setPlaceholder('اختاري الأنواع...')
                .setMinValues(0)
                .setMaxValues(eventGames.GAME_KEYS.length)
                .addOptions(eventGames.GAME_KEYS.map((k) => ({
                    label: eventGames.GAMES[k].label,
                    value: k,
                    default: values.includes(k)
                })))
        );

        try {
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        } catch {
            try {
                await interaction.update({ embeds: [embed], components: [row] });
            } catch {
            }
        }
        return true;
    }

    if (action === 'settings') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const cfg = getGuildConfig(interaction.guild.id);
        const e = cfg.events && typeof cfg.events === 'object' ? cfg.events : {};

        const modal = new ModalBuilder()
            .setCustomId(`eventspanelModal:settings:${ownerId}`)
            .setTitle('إعدادات الفعاليات');

        const interval = new TextInputBuilder()
            .setCustomId('interval')
            .setLabel('كل متى؟ مثال: 30m / 2h / 45s')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(Math.max(10, Math.round((Number(e.intervalMs) || 60_000) / 1000))) + 's');

        const duration = new TextInputBuilder()
            .setCustomId('duration')
            .setLabel('مدة الفعالية؟ مثال: 30s / 2m')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(String(Math.max(5, Math.round((Number(e.durationMs) || 20_000) / 1000))) + 's');

        const reward = new TextInputBuilder()
            .setCustomId('reward')
            .setLabel('المكافأة: min-max (مثال: 10-50)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(`${Math.max(0, Math.floor(Number(e.rewardMin) || 10))}-${Math.max(0, Math.floor(Number(e.rewardMax) || 50))}`);

        modal.addComponents(
            new ActionRowBuilder().addComponents(interval),
            new ActionRowBuilder().addComponents(duration),
            new ActionRowBuilder().addComponents(reward)
        );

        try {
            await interaction.showModal(modal);
        } catch {
            try { await interaction.reply({ content: 'آسف بس ما قدرت أفتح نافذة الإعدادات 3:', ephemeral: true }); } catch { }
        }
        return true;
    }

    if (action === 'run') {
        const now = Date.now();
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            events: {
                ...(c.events && typeof c.events === 'object' ? c.events : {}),
                nextAt: now - 1
            }
        }));
        try { await interaction.reply({ content: '✅ تمام! راح أشغل فعالية خلال ثواني (إذا النظام مفعّل والروم مضبوط).', ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'stats') {
        try {
            const eventsCmd = client.commands.get('events');
            const buildStats = eventsCmd && typeof eventsCmd.buildEventsStatsEmbed === 'function' ? eventsCmd.buildEventsStatsEmbed : null;
            const embed = buildStats
                ? buildStats(interaction.guild.id, interaction.user.id)
                : null;
            if (embed) return await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch {
        }
        try { await interaction.reply({ content: 'آسف بس ما قدرت أجيب الإحصائيات 3:', ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'runspecific') {
        const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('🎯 شغّل لعبة محددة')
            .setDescription('اختار اللعبة اللي تبيها تشتغل الحين — راح تنطلق خلال ثواني ⚡\n\n(تشتغل حتى لو كانت معطّلة بالقائمة، لأنك أنت طلبتها)');

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`eventspanelSelect:runtype:${ownerId}`)
                .setPlaceholder('🎯 اختار اللعبة...')
                .addOptions(eventGames.GAME_KEYS.map((k) => ({
                    label: eventGames.GAMES[k].label,
                    value: k
                })).slice(0, 25))
        );

        try {
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        } catch {
        }
        return true;
    }

    if (action === 'history') {
        try {
            const { listEventHistory } = require('../db');
            const { EmbedBuilder } = require('discord.js');
            const rows = listEventHistory(interaction.guild.id, 10);

            const embed = UI.embed({
                title: '📜 سجل الفعاليات',
                color: UI.COLORS.events
            });

            if (!rows.length) {
                embed.setDescription('ما فيه سجل لسه.');
            } else {
                const lines = rows.map((r) => {
                    const when = r.createdAt ? `<t:${Math.floor(Number(r.createdAt) / 1000)}:R>` : 'قبل';
                    const reward = Math.max(0, Math.floor(Number(r.reward) || 0));
                    const winners = Array.isArray(r.winners) ? r.winners.map((id) => `<@${id}>`).join(' ') : '';
                    const ch = r.channelId ? `<#${r.channelId}>` : '';
                    const type = String(r.type || 'unknown');
                    const w = winners ? `— ${winners}` : '— (بدون فائزين)';
                    return `> ${when} ${ch} **${type}** (+${UI.fmtNum(reward)}) ${w}`;
                });
                embed.setDescription(lines.join('\n').slice(0, 3900));
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch {
            try { await interaction.reply({ content: 'آسف بس ما قدرت أجيب السجل 3:', ephemeral: true }); } catch { }
        }
        return true;
    }

    try { await interaction.reply({ content: 'آسف بس ما فهمت الخيار 3:', ephemeral: true }); } catch { }
    return true;
}

async function handleEventsPanelModalChannel({ client, interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('eventspanelModal:channel:'))) return false;
    if (!interaction.guild) return true;

    const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

    const ownerId = interaction.customId.split(':')[2] || '';
    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        try { await interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }); } catch { }
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: 'آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const chId = String(interaction.fields.getTextInputValue('channelId') || '').trim();
    if (!chId || !/^\d+$/.test(chId)) {
        try { await interaction.reply({ content: 'اكتبي ID صحيح للروم 3:', ephemeral: true }); } catch { }
        return true;
    }

    let ch;
    try {
        ch = await interaction.guild.channels.fetch(chId);
    } catch {
        ch = null;
    }
    if (!ch || !ch.isTextBased()) {
        try { await interaction.reply({ content: 'هذا مو روم نصي (Text) 3:', ephemeral: true }); } catch { }
        return true;
    }

    const now = Date.now();
    updateGuildConfig(interaction.guild.id, (c) => ({
        ...c,
        events: {
            ...(c.events && typeof c.events === 'object' ? c.events : {}),
            channelId: ch.id,
            nextAt: now + 3000
        }
    }));

    const eventsCmd = client.commands.get('events');
    const buildEmbed = eventsCmd && typeof eventsCmd.buildEventsPanelEmbed === 'function' ? eventsCmd.buildEventsPanelEmbed : null;
    const buildRows = eventsCmd && typeof eventsCmd.buildEventsPanelRows === 'function' ? eventsCmd.buildEventsPanelRows : null;

    try {
        await interaction.deferReply({ ephemeral: true });
    } catch {
    }

    if (buildEmbed && buildRows) {
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        try {
            await interaction.editReply({ embeds: [embed], components });
        } catch {
        }
        return true;
    }

    try {
        await interaction.editReply({ content: `✅ تم تحديد روم الفعاليات: <#${ch.id}>`, components: [] });
    } catch {
    }
    return true;
}

async function handleEventsPanelModalSettings({ client, interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('eventspanelModal:settings:'))) return false;
    if (!interaction.guild) return true;

    const ownerId = interaction.customId.split(':')[2] || '';
    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        try { await interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }); } catch { }
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: 'آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const { updateGuildConfig } = require('../guildConfig');

    const eventsCmd = client.commands.get('events');
    const parseDurationSpec = eventsCmd && typeof eventsCmd.parseDurationSpec === 'function' ? eventsCmd.parseDurationSpec : null;
    const buildEmbed = eventsCmd && typeof eventsCmd.buildEventsPanelEmbed === 'function' ? eventsCmd.buildEventsPanelEmbed : null;
    const buildRows = eventsCmd && typeof eventsCmd.buildEventsPanelRows === 'function' ? eventsCmd.buildEventsPanelRows : null;

    const intervalRaw = String(interaction.fields.getTextInputValue('interval') || '').trim();
    const durationRaw = String(interaction.fields.getTextInputValue('duration') || '').trim();
    const rewardRaw = String(interaction.fields.getTextInputValue('reward') || '').trim();

    if (!parseDurationSpec) {
        try { await interaction.reply({ content: 'آسف بس نظام /events مو جاهز 3:', ephemeral: true }); } catch { }
        return true;
    }

    const interval = parseDurationSpec(intervalRaw);
    if (!interval.ok) {
        try { await interaction.reply({ content: interval.reason, ephemeral: true }); } catch { }
        return true;
    }
    const duration = parseDurationSpec(durationRaw);
    if (!duration.ok) {
        try { await interaction.reply({ content: duration.reason, ephemeral: true }); } catch { }
        return true;
    }
    if (interval.ms < 10_000) {
        try { await interaction.reply({ content: 'خلي مدة الإرسال 10 ثواني أو أكثر عشان ما يصير سبام 🙏', ephemeral: true }); } catch { }
        return true;
    }
    if (duration.ms < 30_000) {
        try { await interaction.reply({ content: 'مدة الفعالية لازم تكون 30 ثانية أو أكثر — الألعاب تحتاج وقت تفكير 🧠 (فيها حد أدنى تلقائي أيضًا).', ephemeral: true }); } catch { }
        return true;
    }
    if (duration.ms >= interval.ms) {
        try { await interaction.reply({ content: 'مدة الفعالية لازم تكون أقل من مدة الإرسال.', ephemeral: true }); } catch { }
        return true;
    }

    const rm = rewardRaw.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
    if (!rm) {
        try { await interaction.reply({ content: 'صيغة المكافأة غلط. مثال: 10-50', ephemeral: true }); } catch { }
        return true;
    }
    const rewardMin = Math.max(0, Math.floor(Number(rm[1]) || 0));
    const rewardMax = Math.max(rewardMin, Math.floor(Number(rm[2]) || rewardMin));

    const now = Date.now();
    updateGuildConfig(interaction.guild.id, (c) => ({
        ...c,
        events: {
            ...(c.events && typeof c.events === 'object' ? c.events : {}),
            intervalMs: interval.ms,
            durationMs: duration.ms,
            rewardMin,
            rewardMax,
            nextAt: now + 3000
        }
    }));

    try {
        await interaction.deferReply({ ephemeral: true });
    } catch {
    }

    if (buildEmbed && buildRows) {
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        try {
            await interaction.editReply({ embeds: [embed], components });
        } catch {
        }
        return true;
    }

    try {
        await interaction.editReply({ content: '✅ تم حفظ الإعدادات.', components: [] });
    } catch {
    }
    return true;
}

async function handleEventsPanelTypesSelect({ client, interaction }) {
    if (!(interaction.isStringSelectMenu && interaction.isStringSelectMenu())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('eventspanelSelect:types:'))) return false;
    if (!interaction.guild) return true;

    const ownerId = interaction.customId.split(':')[2] || '';
    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        try { await interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }); } catch { }
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: 'آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const { updateGuildConfig } = require('../guildConfig');
    const selected = Array.isArray(interaction.values) ? interaction.values.map(String) : [];
    const nextTypes = {};
    for (const k of eventGames.GAME_KEYS) nextTypes[k] = selected.includes(k);

    updateGuildConfig(interaction.guild.id, (c) => ({
        ...c,
        events: {
            ...(c.events && typeof c.events === 'object' ? c.events : {}),
            typesEnabled: nextTypes
        }
    }));

    const eventsCmd = client.commands.get('events');
    const buildEmbed = eventsCmd && typeof eventsCmd.buildEventsPanelEmbed === 'function' ? eventsCmd.buildEventsPanelEmbed : null;
    const buildRows = eventsCmd && typeof eventsCmd.buildEventsPanelRows === 'function' ? eventsCmd.buildEventsPanelRows : null;

    if (buildEmbed && buildRows) {
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);
        try {
            await interaction.update({ embeds: [embed], components });
        } catch {
            try {
                await interaction.reply({ embeds: [embed], components, ephemeral: true });
            } catch {
            }
        }
        return true;
    }

    try {
        await interaction.reply({ content: '✅ تم.', ephemeral: true });
    } catch {
    }
    return true;
}

async function handleEventsPanelRunTypeSelect({ client, interaction }) {
    if (!(interaction.isStringSelectMenu && interaction.isStringSelectMenu())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('eventspanelSelect:runtype:'))) return false;
    if (!interaction.guild) return true;

    const ownerId = interaction.customId.split(':')[2] || '';
    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        try { await interaction.reply({ content: 'آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true }); } catch { }
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: 'آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const key = Array.isArray(interaction.values) && interaction.values[0] ? String(interaction.values[0]) : '';
    if (!eventGames.GAMES[key]) {
        try { await interaction.reply({ content: 'آسف بس ما فهمت اللعبة المطلوبة 3:', ephemeral: true }); } catch { }
        return true;
    }

    const { updateGuildConfig } = require('../guildConfig');
    const now = Date.now();
    updateGuildConfig(interaction.guild.id, (c) => ({
        ...c,
        events: {
            ...(c.events && typeof c.events === 'object' ? c.events : {}),
            forceType: key,
            nextAt: now - 1
        }
    }));

    try {
        await interaction.reply({ content: `✅ جاهز! راح أشغل **${eventGames.GAMES[key].label}** خلال ثواني ⚡`, ephemeral: true });
    } catch {
    }
    return true;
}

async function handle({ client, interaction }) {
    if (await handleEventsPanelButtons({ client, interaction })) return true;
    if (await handleEventsPanelTypesSelect({ client, interaction })) return true;
    if (await handleEventsPanelRunTypeSelect({ client, interaction })) return true;
    if (await handleEventsPanelModalChannel({ client, interaction })) return true;
    if (await handleEventsPanelModalSettings({ client, interaction })) return true;
    return false;
}

module.exports = { handle };
