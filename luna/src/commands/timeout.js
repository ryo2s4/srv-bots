const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const modActions = require('../modActions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('تايم آوت لعضو — أو إزالة التايم آوت (مع تسجيل بالسجل)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('العضو المراد إعطاؤه تايم آوت')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('المدة: 30s / 10m / 2h / 3d — واكتب 0 لإزالة التايم آوت')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('سبب التايم آوت')
                .setRequired(false))
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
        const reason = interaction.options.getString('reason') || 'بدون سبب';
        const silent = interaction.options.getBoolean('silent') === true;

        const parsed = modActions.parseDurationSpec(interaction.options.getString('duration'));
        if (!parsed.ok) {
            return interaction.reply({ embeds: [UI.error(parsed.reason)], flags: MessageFlags.Ephemeral });
        }

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) {
            return interaction.reply({ embeds: [UI.error('ما قدرت ألاقي هالعضو بالسيرفر 3:')], flags: MessageFlags.Ephemeral });
        }

        const type = parsed.remove ? 'untimeout' : 'timeout';
        const check = modActions.preflight({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            targetUser,
            action: type
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
                type,
                reason: parsed.remove ? 'إزالة التايم آوت' : reason,
                durationMs: parsed.ms,
                silent
            });
            return interaction.reply({
                embeds: [modActions.buildResultEmbed({
                    type,
                    targetUser,
                    moderator: interaction.user,
                    reason: parsed.remove ? 'إزالة التايم آوت' : reason,
                    durationMs: parsed.ms,
                    record
                })],
                flags: MessageFlags.Ephemeral
            });
        } catch (err) {
            return interaction.reply({
                embeds: [UI.error(`صار خلل وأنا أعطي تايم آوت: ${String(err && err.message ? err.message : err).slice(0, 200)}`)],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
