const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const modActions = require('../modActions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('حظر عضو من السيرفر (مع تأكيد وتسجيل بالسجل)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('العضو المراد حظره')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('سبب الحظر')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('عدد أيام الرسائل للحذف (0-7)')
                .setMinValue(0)
                .setMaxValue(7)
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('silent')
                .setDescription('بدون إرسال إشعار للعضو')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هذا الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: 'آسف بس ما عندك صلاحية Ban Members 3:', flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('target', true);
        const reason = interaction.options.getString('reason') || 'بدون سبب';
        const deleteDays = interaction.options.getInteger('days') || 0;
        const silent = interaction.options.getBoolean('silent') === true;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        const check = modActions.preflight({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            targetUser,
            action: 'ban'
        });
        if (!check.ok) {
            return interaction.reply({ embeds: [UI.error(check.error)], flags: MessageFlags.Ephemeral });
        }

        // تأكيد قبل الحظر ⚡
        modActions.PENDING_BANS.set(`${interaction.user.id}:${targetUser.id}`, {
            guildId: interaction.guild.id,
            reason,
            deleteDays,
            silent,
            expiresAt: Date.now() + 3 * 60 * 1000
        });

        return interaction.reply({
            embeds: [modActions.buildBanConfirmEmbed({
                guild: interaction.guild,
                moderator: interaction.user,
                targetUser,
                targetMember,
                reason,
                deleteDays
            })],
            components: modActions.buildBanConfirmRows(interaction.user.id, targetUser.id),
            flags: MessageFlags.Ephemeral
        });
    }
};
