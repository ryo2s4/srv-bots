const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('حذف عدة رسائل دفعة واحدة')
        .setDMPermission(false)
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('عدد الرسائل المراد فحصها (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .addUserOption(option =>
            option.setName('target')
                .setDescription('حذف رسائل هذا المستخدم فقط')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('سبب الحذف (يُسجَّل باللوغ)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هذا الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: 'آسف بس تحتاج صلاحية Manage Messages 3:', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.channel || !interaction.channel.messages) {
            return interaction.reply({ embeds: [UI.error('ما أقدر أحذف رسائل بهالروم 3:')], flags: MessageFlags.Ephemeral });
        }

        const amount = interaction.options.getInteger('amount');
        const target = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'بدون سبب';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let messages;
        try {
            messages = await interaction.channel.messages.fetch({ limit: amount });
        } catch {
            return interaction.editReply({ embeds: [UI.error('ما قدرت أجيب الرسائل من هالروم 3:')] });
        }

        if (target) messages = messages.filter((msg) => msg.author.id === target.id);

        let deleted;
        try {
            deleted = await interaction.channel.bulkDelete(messages, true);
        } catch {
            return interaction.editReply({ embeds: [UI.error('صار خلل وأنا أحذف — تأكد عندي صلاحية Manage Messages + أقدر أحذف هالرسائل (ما أقدر على رسائل أقدم من 14 يوم) 3:')] });
        }

        const skipped = messages.size - deleted.size;

        const embed = UI.success(
            `تم حذف **${UI.fmtNum(deleted.size)}** رسالة ✅${target ? ` من ${target}` : ''}`,
            {
                title: '🧹 تم التنظيف',
                fields: [
                    { name: '📄 السبب', value: String(reason).slice(0, 500), inline: false },
                    { name: '🛡️ بواسطة', value: `${interaction.user}`, inline: true },
                    { name: '📍 الروم', value: `${interaction.channel}`, inline: true }
                ]
            }
        );
        if (skipped > 0) {
            embed.addFields({ name: '⚠️ تنبيه', value: `تم تخطي **${UI.fmtNum(skipped)}** رسالة (غالبًا أقدم من 14 يوم)`, inline: false });
        }

        try {
            const { sendGuildLog } = require('../guildLog');
            await sendGuildLog(interaction.guild, {
                embeds: [UI.embed({
                    title: '🧹 مسح رسائل',
                    description: `**الروم:** ${interaction.channel}\n**المنفّذ:** ${interaction.user}\n**العدد:** ${UI.fmtNum(deleted.size)}\n**السبب:** ${String(reason).slice(0, 500)}`,
                    color: UI.COLORS.logs
                })]
            }, { category: 'moderation', sourceChannelId: interaction.channel.id });
        } catch {
        }

        await interaction.editReply({ embeds: [embed] });
    }
};
