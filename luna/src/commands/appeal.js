const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const UI = require('../utils/ui');
const { getGuildConfig } = require('../guildConfig');
const infractionStore = require('../stores/infractionStore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('تقديم استئناف على عقوبة (رقم الحالة + السبب)')
        .setDMPermission(false)
        .addIntegerOption(option =>
            option.setName('case_id')
                .setDescription('رقم حالة العقوبة (يظهر بسجل العقوبات)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('سبب الاستئناف — ليش تعتقد العقوبة غلط؟')
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        const caseId = interaction.options.getInteger('case_id', true);
        const reason = String(interaction.options.getString('reason', true) || '').trim();

        if (reason.length < 5) {
            return interaction.reply({ content: 'اكتب سبب أوضح شوي (5 أحرف على الأقل) 3=', flags: MessageFlags.Ephemeral });
        }

        // العقوبة لازم تكون على صاحب الأمر نفسه
        const infraction = infractionStore.findInfractionForCase(interaction.guild.id, interaction.user.id, caseId);
        if (!infraction) {
            return interaction.reply({
                content: `ما لقيت عقوبة برقم \`${caseId}\` مسجلة عليك 3: جرّب رقم الحالة من \`/infractions\` أو من رسالة العقوبة.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const result = infractionStore.createAppeal({
            guildId: interaction.guild.id,
            userId: interaction.user.id,
            infractionId: infraction.id,
            reason
        });

        if (!result.ok) {
            if (result.error === 'duplicate') {
                return interaction.reply({
                    content: `عندك استئناف مفتوح على هالحالة بالفعل (#${result.appeal ? result.appeal.id : '?'})… انتظر رد الإدارة أول 3:`,
                    flags: MessageFlags.Ephemeral
                });
            }
            return interaction.reply({ content: 'ما قدرت أسجل الاستئناف… جرّب مرة ثانية 3:', flags: MessageFlags.Ephemeral });
        }

        const appeal = result.appeal;

        // لوق السيرفر (لو محدد) — رسالة بسيطة
        try {
            const cfg = getGuildConfig(interaction.guild.id);
            const logChId = typeof cfg.logsChannelId === 'string' ? cfg.logsChannelId : null;
            if (logChId) {
                const logCh = await interaction.guild.channels.fetch(logChId).catch(() => null);
                if (logCh && logCh.isTextBased()) {
                    const logEmbed = UI.embed({
                        title: '📮 استئناف جديد',
                        color: UI.COLORS.mod,
                        description: `${interaction.user} قدّم استئناف على العقوبة \`#${infraction.caseRef || infraction.id}\``,
                        fields: [
                            { name: 'العضو', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'رقم الاستئناف', value: `#${appeal.id}`, inline: true },
                            { name: 'العقوبة', value: `\`${infraction.type}\` — ${infraction.reason || 'بدون سبب'}`, inline: false },
                            { name: 'سبب الاستئناف', value: reason.slice(0, 1000), inline: false }
                        ]
                    });
                    await logCh.send({ embeds: [logEmbed] }).catch(() => null);
                }
            }
        } catch {
            // اللوق ما يفشل الأمر
        }

        const embed = UI.success(
            `تم تسجيل استئنافك على العقوبة \`#${infraction.caseRef || infraction.id}\`.\n` +
            `**رقم الاستئناف:** \`#${appeal.id}\`\n` +
            `**الحالة:** ⏳ قيد المراجعة\n\n` +
            `فريق الإدارة بيراجعه وبيتواصل معك 3=`,
            { title: '📮 تم إرسال الاستئناف' }
        );

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
