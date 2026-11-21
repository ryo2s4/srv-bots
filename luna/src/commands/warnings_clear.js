const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const modActions = require('../modActions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings_clear')
        .setDescription('مسح كل عقوبات وتحذيرات العضو (يشيل رتب التحذير أيضًا)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('العضو المراد مسح سجله')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هذا الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: 'آسف بس تحتاج صلاحية Moderate Members 3:', flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('target', true);

        const summary = await modActions.clearUserRecord(interaction.guild, targetUser);

        return interaction.reply({
            embeds: [UI.success(
                `تم مسح سجل ${targetUser} ✅\n\n` +
                `> 🗑️ عقوبات مسحها: **${UI.fmtNum(summary.punishments)}**\n` +
                `> ⚠️ تحذيرات قديمة: **${UI.fmtNum(summary.legacy)}**\n` +
                `> 🎭 رتب تحذير أُزيلت: **${UI.fmtNum(summary.rolesRemoved)}**`,
                { title: '🧼 مسح السجل' }
            )],
            flags: MessageFlags.Ephemeral
        });
    }
};
