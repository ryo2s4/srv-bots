const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { updateGuildConfig, getGuildConfig } = require('../guildConfig');

module.exports = {
    disabled: true,
    data: new SlashCommandBuilder()
        .setName('autoreply')
        .setDescription('إدارة الردود التلقائية')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة قاعدة رد تلقائي')
                .addStringOption(opt =>
                    opt.setName('trigger')
                        .setDescription('نص المحفّز')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('response')
                        .setDescription('نص الرد')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('mode')
                        .setDescription('وضع المطابقة')
                        .addChoices(
                            { name: 'مطابقة تامة (exact)', value: 'exact' },
                            { name: 'يحتوي (includes)', value: 'includes' }
                        )
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف قاعدة رد تلقائي حسب المحفّز')
                .addStringOption(opt =>
                    opt.setName('trigger')
                        .setDescription('المحفّز المراد حذفه')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض قواعد الردود التلقائية'))
        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('حذف جميع قواعد الردود التلقائية')),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const trigger = interaction.options.getString('trigger').trim();
            const response = interaction.options.getString('response');
            const mode = interaction.options.getString('mode') || 'exact';

            if (!trigger) {
                return interaction.reply({ content: 'اسفة بس المحفّز ما ينفع يكون فاضي 3:' });
            }

            if (!response) {
                return interaction.reply({ content: 'اسفة بس الرد ما ينفع يكون فاضي 3:' });
            }

            updateGuildConfig(interaction.guild.id, (cfg) => {
                const next = { ...cfg };
                const list = Array.isArray(next.autoReplies) ? [...next.autoReplies] : [];
                const idx = list.findIndex(r => r && typeof r.trigger === 'string' && r.trigger.toLowerCase() === trigger.toLowerCase());
                const entry = { trigger, response, mode };
                if (idx >= 0) list[idx] = entry;
                else list.push(entry);
                next.autoReplies = list;
                return next;
            });

            const content =
                `تمت إضافة/تحديث رد تلقائي.\n` +
                `المحفّز: **${trigger}**\n` +
                `الوضع: **${mode}**\n` +
                `الرد: ${response}`;

            return interaction.reply({ content });
        }

        if (sub === 'remove') {
            const trigger = interaction.options.getString('trigger').trim();
            const before = getGuildConfig(interaction.guild.id);
            const beforeCount = Array.isArray(before.autoReplies) ? before.autoReplies.length : 0;

            updateGuildConfig(interaction.guild.id, (cfg) => {
                const next = { ...cfg };
                const list = Array.isArray(next.autoReplies) ? next.autoReplies.filter(r => !(r && typeof r.trigger === 'string' && r.trigger.toLowerCase() === trigger.toLowerCase())) : [];
                next.autoReplies = list;
                return next;
            });

            const after = getGuildConfig(interaction.guild.id);
            const afterCount = Array.isArray(after.autoReplies) ? after.autoReplies.length : 0;

            return interaction.reply({ content: beforeCount === afterCount ? 'اسفة بس ما لقيت قاعدة بهالمحفّز 3:' : 'تمام! حذفت قاعدة الرد التلقائي ✅' });
        }

        if (sub === 'clear') {
            updateGuildConfig(interaction.guild.id, (cfg) => ({ ...cfg, autoReplies: [] }));
            return interaction.reply({ content: 'تم حذف جميع قواعد الردود التلقائية.' });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const list = Array.isArray(cfg.autoReplies) ? cfg.autoReplies : [];

        if (list.length === 0) {
            return interaction.reply({ content: 'لا يوجد ردود تلقائية مضافة حاليًا.' });
        }

        const lines = list.slice(0, 20).map(r => `- ${r.trigger} (${r.mode || 'exact'}): ${r.response}`);
        const content = `الردود التلقائية:\n${lines.join('\n')}`;

        return interaction.reply({ content });
    },
};
