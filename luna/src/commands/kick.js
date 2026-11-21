const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const modActions = require('../modActions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('طرد عضو من السيرفر (مع تسجيل بالسجل)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('العضو المراد طرده')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('سبب الطرد')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('silent')
                .setDescription('بدون إرسال إشعار للعضو')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هذا الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({ content: 'آسف بس ما عندك صلاحية Kick Members 3:', flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('target', true);
        const reason = interaction.options.getString('reason') || 'بدون سبب';
        const silent = interaction.options.getBoolean('silent') === true;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return interaction.reply({ embeds: [UI.error('ما قدرت ألاقي هالعضو بالسيرفر 3:')], flags: MessageFlags.Ephemeral });
        }

        const check = modActions.preflight({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            targetUser,
            action: 'kick'
        });
        if (!check.ok) {
            return interaction.reply({ embeds: [UI.error(check.error)], flags: MessageFlags.Ephemeral });
        }

        try {
            const record = await modActions.executePunishment({
                client: interaction.client,
                guild: interaction.guild,
                moderator: interaction.member,
                targetUser,
                targetMember,
                type: 'kick',
                reason,
                silent
            });
            return interaction.reply({
                embeds: [modActions.buildResultEmbed({ type: 'kick', targetUser, moderator: interaction.user, reason, record })],
                flags: MessageFlags.Ephemeral
            });
        } catch (err) {
            return interaction.reply({
                embeds: [UI.error(`صار خلل وأنا أطرد: ${String(err && err.message ? err.message : err).slice(0, 200)}`)],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
