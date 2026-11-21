const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const modActions = require('../modActions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('تحذير عضو (يُسجَّل بالسجل + يحتسب للرتب التحذيرية والباند التلقائي)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('العضو المراد تحذيره')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('سبب التحذير')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('silent')
                .setDescription('بدون إرسال إشعار للعضو')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هذا الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: 'آسف بس تحتاج صلاحية Moderate Members 3:', flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('target', true);
        const reason = interaction.options.getString('reason', true);
        const silent = interaction.options.getBoolean('silent') === true;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        const check = modActions.preflight({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            targetUser,
            action: 'warn'
        });
        if (!check.ok) {
            return interaction.reply({ embeds: [UI.error(check.error)], flags: MessageFlags.Ephemeral });
        }

        const record = await modActions.executePunishment({
            client: interaction.client,
            guild: interaction.guild,
            moderator: interaction.member,
            targetUser,
            targetMember,
            type: 'warn',
            reason,
            silent
        });

        return interaction.reply({
            embeds: [modActions.buildResultEmbed({ type: 'warn', targetUser, moderator: interaction.user, reason, record })],
            flags: MessageFlags.Ephemeral
        });
    }
};
