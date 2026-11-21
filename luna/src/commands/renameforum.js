const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

module.exports = {
    disabled: true,
    data: new SlashCommandBuilder()
        .setName('renameforum')
        .setDescription('إعداد قناة الفورم الخاصة بطلبات تغيير الاسم')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('تحديد قناة Forum التي سيتم إنشاء الطلبات فيها')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('قناة Forum')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('إلغاء ربط قناة الفورم'))
        .addSubcommand(sub =>
            sub.setName('show')
                .setDescription('عرض الإعداد الحالي')),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'اسفة بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'set') {
            const channel = interaction.options.getChannel('channel');
            if (!channel || channel.type !== ChannelType.GuildForum) {
                return interaction.reply({ content: 'اسفة بس لازم تختار/ي قناة نوعها **Forum** 3:' });
            }

            updateGuildConfig(interaction.guild.id, (cfg) => ({ ...cfg, renameForumChannelId: channel.id }));
            return interaction.reply({ content: `تم تحديد قناة طلبات تغيير الاسم: <#${channel.id}>.` });
        }

        if (sub === 'clear') {
            updateGuildConfig(interaction.guild.id, (cfg) => ({ ...cfg, renameForumChannelId: null }));
            return interaction.reply({ content: 'تم إلغاء ربط قناة طلبات تغيير الاسم.' });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const ch = cfg.renameForumChannelId ? `<#${cfg.renameForumChannelId}>` : 'غير محددة';
        return interaction.reply({ content: `قناة طلبات تغيير الاسم الحالية: ${ch}` });
    }
};
