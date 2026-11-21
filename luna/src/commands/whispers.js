const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const { updateGuildConfig, getGuildConfig } = require('../guildConfig');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('whispers')
        .setDescription('إعداد نظام الهمسات (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sc) =>
            sc
                .setName('set')
                .setDescription('تحديد روم الهمسات')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('الروم اللي العضو يرسل فيه همسات')
                        .setRequired(true)
                )
        )
        .addSubcommand((sc) =>
            sc
                .setName('off')
                .setDescription('إيقاف نظام الهمسات')
        ),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'set') {
            const ch = interaction.options.getChannel('channel', true);
            if (!ch || !ch.isTextBased()) {
                return interaction.reply({ content: 'اختاري روم نصي (Text) 3:', ephemeral: true });
            }

            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, whispersChannelId: ch.id }));
            return interaction.reply({ content: `🌙✅ تم! من الحين أي رسالة في <#${ch.id}> راح تصير همسة مجهولة… وأنا أتصرّف ✨`, ephemeral: true });
        }

        if (sub === 'off') {
            const cfg = getGuildConfig(interaction.guild.id);
            if (!cfg.whispersChannelId) {
                return interaction.reply({ content: '🌙 الهمسات مو مفعّلة أصلًا حاليًا.', ephemeral: true });
            }
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, whispersChannelId: null }));
            return interaction.reply({ content: '⛔🌙 تم إيقاف الهمسات… رجعنا للوضع الطبيعي.', ephemeral: true });
        }

        return interaction.reply({ content: 'اسفة بس ما فهمت 3:', ephemeral: true });
    }
};
