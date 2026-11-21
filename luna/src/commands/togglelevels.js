const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('togglelevels')
        .setDescription('تشغيل/إيقاف نظام اللفلات في السيرفر (Administrator فقط)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption((opt) =>
            opt
                .setName('enabled')
                .setDescription('تشغيل اللفلات؟ true للتشغيل / false للإيقاف')
                .setRequired(true)
        )
        .addChannelOption((opt) =>
            opt
                .setName('channel')
                .setDescription('الروم اللي لونا ترسل فيه رسائل التطور (اختياري)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر يشتغل بالسيرفر بس 3:')], flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ embeds: [UI.error('آسف بس، تحتاج صلاحية **Administrator** عشان تستخدم هالأمر 3:')], flags: MessageFlags.Ephemeral });
        }

        const enabled = interaction.options.getBoolean('enabled', true);
        const channel = interaction.options.getChannel('channel');
        const beforeCfg = getGuildConfig(interaction.guild.id);
        const before = beforeCfg.levelingEnabled !== false;
        const beforeChannelId = beforeCfg.levelUpChannelId || null;

        updateGuildConfig(interaction.guild.id, (cfg) => {
            const next = { ...cfg };
            next.levelingEnabled = Boolean(enabled);
            if (channel) {
                next.levelUpChannelId = channel.id;
            }
            return next;
        });

        const afterCfg = getGuildConfig(interaction.guild.id);
        const after = afterCfg.levelingEnabled !== false;
        const beforeText = before ? 'شغّال ✅' : 'مطفي ⛔';
        const afterText = after ? 'شغّال ✅' : 'مطفي ⛔';
        const afterChannelId = afterCfg.levelUpChannelId || null;
        const channelLine = channel
            ? `\n**روم رسائل التطور:** <#${channel.id}>`
            : (beforeChannelId !== afterChannelId
                ? `\n**روم رسائل التطور:** ${afterChannelId ? `<#${afterChannelId}>` : 'غير محددة'}`
                : '');

        return interaction.reply({
            embeds: [
                UI.embed({
                    color: UI.COLORS.levels,
                    title: '🧠 نظام اللفلات',
                    description:
                        `**قبل:** ${beforeText}\n` +
                        `**بعد:** ${afterText}` +
                        channelLine
                })
            ]
        });
    }
};
