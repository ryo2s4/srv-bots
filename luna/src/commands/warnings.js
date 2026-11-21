const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

const TYPE_ICON = {
    ban: '🔨', kick: '👢', timeout: '🔇', untimeout: '🔊', warn: '⚠️'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('عرض سجل عقوبات العضو الموحّد (تحذيرات + عقوبات)')
        .setDMPermission(false)
        .addUserOption(option =>
            option.setName('target')
                .setDescription('العضو المراد عرض سجله')
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

        let punishments = [];
        let count = 0;
        try {
            const punishLog = require('../punishLog');
            punishments = punishLog.getUserPunishments(interaction.guild.id, targetUser.id) || [];
            count = punishments.length;
        } catch {
        }

        let legacy = [];
        try {
            const { listWarnings } = require('../db');
            legacy = listWarnings(interaction.guild.id, targetUser.id, 10) || [];
        } catch {
        }

        const recent = punishments.slice(0, 10).map((p) => {
            const icon = TYPE_ICON[String(p.type)] || '📄';
            const when = p.created_at ? `<t:${Math.floor(Number(p.created_at) / 1000)}:R>` : 'قبل';
            const dur = p.duration_minutes ? ` (${UI.fmtDuration(Number(p.duration_minutes) * 60000)})` : '';
            const reason = String(p.reason || 'بدون سبب').slice(0, 80);
            return `${icon} **#${p.id}** ${when}${dur} — ${reason} · <@${p.moderator_id}>`;
        });

        const legacyLines = legacy.map((w) => {
            const when = w.createdAt ? `<t:${Math.floor(Number(w.createdAt) / 1000)}:R>` : 'قبل';
            return `⚠️ ${when} — ${String(w.reason || 'بدون سبب').slice(0, 80)} · <@${w.moderatorId}>`;
        });

        const descLines = [
            `**العضو:** ${targetUser} (\`${targetUser.id}\`)`,
            `**إجمالي العقوبات المسجّلة:** ${UI.fmtNum(count)}`
        ];
        if (recent.length) {
            descLines.push('', '**آخر العقوبات:**');
            descLines.push(...recent);
        } else {
            descLines.push('', '✨ ما فيه أي عقوبة مسجلة — عضو نظيف!');
        }
        if (legacyLines.length) {
            descLines.push('', '**تحذيرات قديمة (نظام سابق):**');
            descLines.push(...legacyLines);
        }

        return interaction.reply({
            embeds: [UI.embed({
                title: '📋 سجل العقوبات',
                description: descLines.join('\n').slice(0, 3900),
                color: UI.COLORS.mod
            })],
            components: [UI.row(
                UI.btn(`modact:hist:${interaction.user.id}:${targetUser.id}`, 'السجل الكامل', { emoji: '📜' })
            )],
            flags: MessageFlags.Ephemeral
        });
    }
};
