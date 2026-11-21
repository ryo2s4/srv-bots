const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserCommandInteraction
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const punishLog = require('../punishLog');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punishlog')
        .setDescription('⚖️ نظام سجل العقوبات المتقدم')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(sub =>
            sub.setName('config')
                .setDescription('إعدادات نظام سجل العقوبات')
        )
        .addSubcommand(sub =>
            sub.setName('history')
                .setDescription('عرض سجل عقوبات عضو')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('العضو')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة عقوبة يدوياً')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('العضو')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('نوع العقوبة')
                        .setRequired(true)
                        .addChoices(
                            { name: '⚠️ تحذير', value: 'warn' },
                            { name: '⏱️ تايم أوت', value: 'timeout' },
                            { name: '👢 طرد', value: 'kick' },
                            { name: '🔨 باند', value: 'ban' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('السبب')
                        .setRequired(false)
                )
                .addIntegerOption(opt =>
                    opt.setName('duration')
                        .setDescription('المدة بالدقائق (للتايم أوت)')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هذا الأمر بالسيرفرات فقط 3:', flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();

        const hasModerationPerm = !!interaction.memberPermissions && (
            interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers) ||
            interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
        );

        const hasAdminPerm = !!interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

        if (subcommand !== 'config' && !hasModerationPerm) {
            return interaction.reply({ content: 'آسف بس هذا الأمر للمشرفين فقط 3:', flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'config' && !hasAdminPerm) {
            return interaction.reply({ content: 'آسف بس إعدادات النظام للإدمنستريتر فقط 3:', flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'config') {
            const embed = punishLog.buildConfigEmbed(interaction.guild.id, interaction.guild);
            const components = punishLog.buildConfigRows(interaction.user.id, interaction.guild.id);
            return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'history') {
            const user = interaction.options.getUser('user', true);
            const embed = punishLog.buildUserHistoryEmbed(interaction.guild.id, user.id, interaction.guild);
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'add') {
            const user = interaction.options.getUser('user', true);
            const type = interaction.options.getString('type', true);
            const reason = interaction.options.getString('reason') || 'بدون سبب';
            const duration = interaction.options.getInteger('duration') || 0;

            const config = punishLog.getPunishConfig(interaction.guild.id);
            if (!config.enabled) {
                return interaction.reply({ content: '❌ نظام سجل العقوبات معطّل', flags: MessageFlags.Ephemeral });
            }

            // Get or create thread for user
            const thread = await punishLog.getOrCreateUserThread(interaction.guild, user.id);
            
            // Add punishment to database
            const punishmentId = punishLog.addPunishment(
                interaction.guild.id,
                user.id,
                interaction.user.id,
                type,
                reason,
                duration,
                thread ? thread.id : null
            );

            // Send to thread if exists
            if (thread) {
                const embed = punishLog.buildPunishEmbed({
                    id: punishmentId,
                    user_id: user.id,
                    moderator_id: interaction.user.id,
                    type,
                    reason,
                    duration_minutes: duration,
                    created_at: Date.now()
                }, interaction.guild);
                await thread.send({ embeds: [embed] }).catch(() => null);
            }

            // Apply warning role
            const count = punishLog.getPunishmentCount(interaction.guild.id, user.id);
            await punishLog.applyWarningRole(interaction.guild, user.id, count);

            // Check auto-ban
            const didBan = await punishLog.checkAndAutoBan(interaction.guild, user.id);

            // Log to main log channel
            if (config.logChannelId) {
                const logChannel = interaction.guild.channels.cache.get(config.logChannelId) ||
                    await interaction.guild.channels.fetch(config.logChannelId).catch(() => null);
                if (logChannel && logChannel.isTextBased()) {
                    const embed = punishLog.buildPunishEmbed({
                        id: punishmentId,
                        user_id: user.id,
                        moderator_id: interaction.user.id,
                        type,
                        reason,
                        duration_minutes: duration,
                        created_at: Date.now()
                    }, interaction.guild);
                    await logChannel.send({ embeds: [embed] }).catch(() => null);
                }
            }

            const resultText = didBan 
                ? `\n🔨 **تم تبنيد العضو تلقائياً لتجاوز حد التحذيرات!**`
                : `\n📊 عدد العقوبات الحالي: **${UI.fmtNum(count)}**`;

            return interaction.reply({
                content: `✅ تم تسجيل العقوبة بنجاح!${resultText}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },

    // Export for handlers
    buildConfigEmbed: punishLog.buildConfigEmbed,
    buildConfigRows: punishLog.buildConfigRows,
    buildSettingsModal: punishLog.buildSettingsModal,
    buildRolesModal: punishLog.buildRolesModal,
    parseWarningRolesInput: punishLog.parseWarningRolesInput,
    startTempRoleChecker: punishLog.startTempRoleChecker,
    removeExpiredRoles: punishLog.removeExpiredRoles
};
