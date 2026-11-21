const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const { updateGuildConfig, getGuildConfig, emojiKeyFromString } = require('../guildConfig');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('إدارة رتب التفاعل (Reaction Roles)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة ربط رتبة مع تفاعل')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('ID الرسالة التي سيتم مراقبتها')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emoji')
                        .setDescription('إيموجي (😀 أو مخصص مثل <a:name:id>)')
                        .setRequired(true))
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('الرتبة التي ستتم إضافتها/إزالتها')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف ربط رتبة مع تفاعل')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('ID الرسالة')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emoji')
                        .setDescription('الإيموجي المستخدم في الربط')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض روابط رتب التفاعل')),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر يشتغل بالسيرفر بس 3:')], flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ embeds: [UI.error('آسف بس، تحتاج صلاحية **Manage Roles** عشان تستخدم هالأمر 3:')], flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const messageId = interaction.options.getString('message_id');
            const emojiInput = interaction.options.getString('emoji');
            const role = interaction.options.getRole('role');

            const emojiKey = emojiKeyFromString(emojiInput);
            if (!emojiKey) {
                return interaction.reply({ embeds: [UI.error('آسف بس، الإيموجي مو صحيح — جرّب إيموجي عادي أو مخصص مثل `<a:name:id>` 3:')], flags: MessageFlags.Ephemeral });
            }

            const botMember = interaction.guild.members.me;
            if (botMember && botMember.roles.highest.comparePositionTo(role) <= 0) {
                return interaction.reply({ embeds: [UI.error('آسف بس، لازم رتبة لونا تكون أعلى من الرتبة المطلوبة عشان أقدر أضيفها/أشيلها — عدّل ترتيب الرتب وجرّب مرة ثانية >:')], flags: MessageFlags.Ephemeral });
            }

            updateGuildConfig(interaction.guild.id, (cfg) => {
                const next = { ...cfg };
                const list = Array.isArray(next.reactionRoles) ? [...next.reactionRoles] : [];
                const existingIdx = list.findIndex(rr => rr && rr.messageId === messageId && rr.emoji === emojiKey);
                const entry = { messageId, emoji: emojiKey, roleId: role.id };
                if (existingIdx >= 0) list[existingIdx] = entry;
                else list.push(entry);
                next.reactionRoles = list;
                return next;
            });

            return interaction.reply({
                embeds: [
                    UI.success('تمت إضافة/تحديث ربط رتبة التفاعل.', {
                        title: '✅ ربط رتبة التفاعل',
                        fields: [
                            { name: '📨 ID الرسالة', value: `\`${messageId}\``, inline: true },
                            { name: '😀 الإيموجي', value: emojiInput, inline: true },
                            { name: '🎭 الرتبة', value: `<@&${role.id}>`, inline: true }
                        ]
                    })
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        if (sub === 'remove') {
            const messageId = interaction.options.getString('message_id');
            const emojiInput = interaction.options.getString('emoji');
            const emojiKey = emojiKeyFromString(emojiInput);

            const before = getGuildConfig(interaction.guild.id);
            const beforeCount = Array.isArray(before.reactionRoles) ? before.reactionRoles.length : 0;

            updateGuildConfig(interaction.guild.id, (cfg) => {
                const next = { ...cfg };
                const list = Array.isArray(next.reactionRoles) ? next.reactionRoles.filter(rr => !(rr && rr.messageId === messageId && rr.emoji === emojiKey)) : [];
                next.reactionRoles = list;
                return next;
            });

            const after = getGuildConfig(interaction.guild.id);
            const afterCount = Array.isArray(after.reactionRoles) ? after.reactionRoles.length : 0;

            return interaction.reply({
                embeds: [
                    beforeCount === afterCount
                        ? UI.warn('آسف بس، ما لقيت ربط مطابق للحذف 3:')
                        : UI.success('تمام! حذفت ربط رتبة التفاعل ✅', { title: '🗑️ حذف ربط' })
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        const cfg = getGuildConfig(interaction.guild.id);
        const list = Array.isArray(cfg.reactionRoles) ? cfg.reactionRoles : [];

        if (list.length === 0) {
            return interaction.reply({ embeds: [UI.info('ما فيه رتب تفاعل مضافة حاليًا. استخدم `/reactionrole add` عشان تضيف أول ربط.')], flags: MessageFlags.Ephemeral });
        }

        const lines = list.map(rr => `- \`${rr.messageId}\` | ${rr.emoji} | <@&${rr.roleId}>`);

        return interaction.reply({
            embeds: [
                UI.embed({
                    color: UI.COLORS.primary,
                    title: '🎭 رتب التفاعل',
                    description: lines.slice(0, 20).join('\n'),
                    footerText: `${UI.fmtNum(list.length)} ربط`
                })
            ],
            flags: MessageFlags.Ephemeral
        });
    },
};
