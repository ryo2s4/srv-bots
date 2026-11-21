const { PermissionsBitField, MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const UI = require('../utils/ui');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

const validTypes = ['xp_boost', 'luna_boost', 'levelup_reward_boost', 'luna_points'];

async function safeReply(interaction, content) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.followUp(content);
        }
        return await interaction.reply(content);
    } catch {
        try {
            if (!interaction.replied) await interaction.followUp(content);
        } catch {}
    }
}

async function handleLevelRewardsButtons({ client, interaction }) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return false;
    if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith('levelrewards:')) return false;
    if (!interaction.guild) return true;

    const parts = interaction.customId.split(':');
    const action = parts[1] || '';
    const ownerId = parts[2] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        await safeReply(interaction, { embeds: [UI.error('آسف بس، هاللوحة لصاحبها بس 3:')], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        await safeReply(interaction, { embeds: [UI.error('آسف بس، هالأمر للإدمن فقط 3:')], flags: MessageFlags.Ephemeral });
        return true;
    }

    const lrCmd = client.commands.get('levelrewards');
    const buildEmbed = lrCmd && typeof lrCmd.buildConfigEmbed === 'function' ? lrCmd.buildConfigEmbed : null;
    const buildRows = lrCmd && typeof lrCmd.buildConfigRows === 'function' ? lrCmd.buildConfigRows : null;

    if (action === 'refresh') {
        try { await interaction.deferUpdate(); } catch {}
        if (buildEmbed && buildRows) {
            try {
                await interaction.editReply({ embeds: [buildEmbed(interaction.guild.id)], components: buildRows(ownerId || interaction.user.id) });
            } catch {}
        }
        return true;
    }

    if (action === 'add') {
        if (interaction.deferred || interaction.replied) {
            await safeReply(interaction, { embeds: [UI.error('الرجاء إعادة فتح اللوحة والمحاولة مرة أخرى 3:')], flags: MessageFlags.Ephemeral });
            return true;
        }
        const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
        const modal = new ModalBuilder()
            .setCustomId(`levelrewardsModal:add:${ownerId}`)
            .setTitle('➕ إضافة مكافأة مستوى');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('level')
                    .setLabel('المستوى المطلوب (رقم)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('مثال: 5')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('type')
                    .setLabel('النوع')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('xp_boost | luna_boost | levelup_reward_boost | luna_points')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('multiplier')
                    .setLabel('نسبة البوست المئوية (25 = +25%)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('25')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel('عدد Luna Points (لنوع luna_points)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('عدد Luna Points')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('label')
                    .setLabel('الاسم المعروض (اتركه فاضي ليتعبى تلقائياً)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('مثال: XP Boost +25%')
            )
        );

        try { await interaction.showModal(modal); } catch {
            await safeReply(interaction, { embeds: [UI.error('تعذر فتح النافذة. جرّب مرة أخرى 3:')], flags: MessageFlags.Ephemeral });
        }
        return true;
    }

    if (action === 'remove') {
        const cfg = getGuildConfig(interaction.guild.id);
        const rewards = Array.isArray(cfg.levelRewards) ? cfg.levelRewards : [];
        if (rewards.length === 0) {
            await safeReply(interaction, { embeds: [UI.warn('ما في مكافآت عشان تحذفها 3:')], flags: MessageFlags.Ephemeral });
            return true;
        }

        const options = rewards.slice(0, 25).map((r) => ({
            label: `المستوى ${r.level} - ${r.label.slice(0, 50)}`,
            value: r.id
        }));

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`levelrewards:remove_select:${ownerId}`)
                .setPlaceholder('اختار مكافأة للحذف')
                .addOptions(options)
        );

        await safeReply(interaction, { content: '👇 اختار المكافأة اللي تبي تحذفها:', components: [row], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'remove_select') {
        const targetId = interaction.values && interaction.values[0];
        if (!targetId) {
            await safeReply(interaction, { embeds: [UI.error('ما اخترت مكافأة 3:')], flags: MessageFlags.Ephemeral });
            return true;
        }

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            levelRewards: (Array.isArray(c.levelRewards) ? c.levelRewards : []).filter((r) => r && r.id !== targetId)
        }));

        try { await interaction.deferUpdate(); } catch {}
        if (buildEmbed && buildRows) {
            try {
                await interaction.editReply({ embeds: [buildEmbed(interaction.guild.id)], components: buildRows(ownerId || interaction.user.id) });
            } catch {}
        }
        return true;
    }

    return false;
}

async function handleLevelRewardsModal({ client, interaction }) {
    if (!interaction.isModalSubmit() || typeof interaction.customId !== 'string' || !interaction.customId.startsWith('levelrewardsModal:')) return false;
    if (!interaction.guild) return true;

    const parts = interaction.customId.split(':');
    const kind = parts[1] || '';
    const ownerId = parts[2] || '';

    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        try { await interaction.reply({ embeds: [UI.error('آسف بس، هاللوحة لصاحبها بس 3:')], flags: MessageFlags.Ephemeral }); } catch {
            try { await interaction.followUp({ embeds: [UI.error('آسف بس، هاللوحة لصاحبها بس 3:')], flags: MessageFlags.Ephemeral }); } catch {}
        }
        return true;
    }

    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        try { await interaction.reply({ embeds: [UI.error('آسف بس، هالأمر للإدمن فقط 3:')], flags: MessageFlags.Ephemeral }); } catch {
            try { await interaction.followUp({ embeds: [UI.error('آسف بس، هالأمر للإدمن فقط 3:')], flags: MessageFlags.Ephemeral }); } catch {}
        }
        return true;
    }

    if (kind === 'add') {
        const rawLevel = String(interaction.fields.getTextInputValue('level') || '').trim();
        const rawType = String(interaction.fields.getTextInputValue('type') || '').trim().toLowerCase();
        const rawMult = String(interaction.fields.getTextInputValue('multiplier') || '').trim();
        const rawValue = String(interaction.fields.getTextInputValue('value') || '').trim();
        const rawLabel = String(interaction.fields.getTextInputValue('label') || '').trim();

        const parsedLevel = Number(rawLevel);
        if (!rawLevel || !Number.isFinite(parsedLevel) || parsedLevel < 1 || parsedLevel > 1000) {
            try { await interaction.reply({ embeds: [UI.error('اكتب مستوى صحيح (رقم بين 1 و 1000) 3:')], flags: MessageFlags.Ephemeral }); } catch {}
            return true;
        }
        const level = Math.max(1, Math.floor(parsedLevel));

        const type = validTypes.includes(rawType) ? rawType : 'luna_points';

        if (type === 'luna_points' && (!rawValue || isNaN(Number(rawValue)) || Number(rawValue) < 1)) {
            try { await interaction.reply({ embeds: [UI.error('لـ Luna Points لازم تكتب رقم أكبر من 0 3:')], flags: MessageFlags.Ephemeral }); } catch {}
            return true;
        }

        let pct = 25;
        if (type.endsWith('_boost')) {
            const parsed = Number(rawMult);
            pct = rawMult && !isNaN(parsed) && parsed > 0 ? parsed : 25;
        }
        const multiplier = 1 + pct / 100;

        const pctLabel = type.endsWith('_boost') ? ` +${pct}%` : '';

        let label = rawLabel;
        if (!label) {
            const typeNames = {
                xp_boost: 'XP Boost',
                luna_boost: 'Luna Boost',
                levelup_reward_boost: 'Level-Up Reward Boost',
                luna_points: '🌙 Luna Points'
            };
            const base = typeNames[type] || type;
            if (type === 'luna_points') label = `${base} +${rawValue}`;
            else label = `${base}${pctLabel}`;
        }

        const rewardId = `lr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        let value = '';
        if (type === 'luna_points') {
            value = String(Math.max(1, Math.floor(Number(rawValue))));
        }

        updateGuildConfig(interaction.guild.id, (c) => {
            const rewards = Array.isArray(c.levelRewards) ? [...c.levelRewards] : [];
            rewards.push({
                id: rewardId,
                level,
                type,
                multiplier,
                value,
                label: label.slice(0, 100),
                durationMs: 0
            });
            return { ...c, levelRewards: rewards };
        });

        const lrCmd = client.commands.get('levelrewards');
        const buildEmbed = lrCmd && typeof lrCmd.buildConfigEmbed === 'function' ? lrCmd.buildConfigEmbed : null;
        const buildRows = lrCmd && typeof lrCmd.buildConfigRows === 'function' ? lrCmd.buildConfigRows : null;

        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch {}
        if (buildEmbed && buildRows) {
            try {
                await interaction.editReply({ embeds: [buildEmbed(interaction.guild.id)], components: buildRows(ownerId || interaction.user.id) });
            } catch {}
        }
        return true;
    }

    return false;
}

async function handle({ client, interaction }) {
    const handlers = [handleLevelRewardsButtons, handleLevelRewardsModal];
    for (const h of handlers) {
        try {
            const handled = await h({ client, interaction });
            if (handled) return true;
        } catch (e) {
            console.error('levelRewards handler error:', e);
            return true;
        }
    }
    return false;
}

module.exports = { handle };
