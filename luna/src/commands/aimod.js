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
    TextInputStyle
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const aimod = require('../aimod');
const UI = require('../utils/ui');

function buildAiModEmbed(guildId) {
    const cfg = aimod.getAiModConfig(guildId);
    
    const actionLabels = { delete: 'حذف', timeout: 'تايم أوت', ban: 'باند' };
    const thresholdLabels = { low: 'منخفض (يشمل البسيط)', medium: 'متوسط', high: 'عالي (الخطير فقط)' };
    
    return UI.embed({
        title: '🤖 لوحة الـ AI Moderation',
        color: UI.COLORS.mod,
        description:
            'الذكاء الاصطناعي يراقب الرسائل ويكشف المخالفات تلقائيًا 🧠\n\n' +
            `> **الحالة:** ${cfg.enabled ? 'شغال ✅' : 'مقفل ⛔'}\n` +
            `> **الإجراء:** ${actionLabels[cfg.action] || cfg.action}\n` +
            `> **مدة التايم أوت:** ${UI.fmtDuration((Number(cfg.timeoutMinutes) || 0) * 60_000)}\n` +
            `> **الحساسية:** ${thresholdLabels[cfg.threshold] || cfg.threshold}\n` +
            `> **روم السجلات:** ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'غير محدد'}\n` +
            `> **رومات مستثناة:** ${cfg.ignoreChannelIds.length > 0 ? cfg.ignoreChannelIds.map(id => `<#${id}>`).join(', ') : 'لا يوجد'}\n` +
            `> **رولات مستثناة:** ${cfg.ignoreRoleIds.length > 0 ? UI.fmtNum(cfg.ignoreRoleIds.length) : 'لا يوجد'}`,
        fields: [{
            name: '🔍 كيف يعمل؟',
            value: 'البوت يستخدم AI لتحليل كل رسالة ويكشف:\n• الشتم والقذف\n• السباب والسب\n• خطاب الكراهية\n• سلوك Raid\n• التهديدات',
            inline: false
        }]
    });
}

function buildAiModRows(ownerId, guildId) {
    const cfg = aimod.getAiModConfig(guildId);
    
    return [
        UI.row(
            UI.btn(`aimod:toggle:${ownerId}`, '⏯️ تشغيل/إيقاف', { style: ButtonStyle.Primary }),
            UI.btn(`aimod:settings:${ownerId}`, '⚙️ الإعدادات', { style: ButtonStyle.Secondary }),
            UI.btn(`aimod:ignores:${ownerId}`, '🚫 الاستثناءات', { style: ButtonStyle.Secondary }),
            UI.btn(`aimod:refresh:${ownerId}`, '🔄 تحديث', { style: ButtonStyle.Secondary })
        )
    ];
}

function buildSettingsModal(ownerId, guildId) {
    const cfg = aimod.getAiModConfig(guildId);
    
    const modal = new ModalBuilder()
        .setCustomId(`aimodModal:settings:${ownerId}`)
        .setTitle('⚙️ إعدادات AI Moderation');
    
    const action = new TextInputBuilder()
        .setCustomId('action')
        .setLabel('الإجراء (delete / timeout / ban)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(cfg.action);
    
    const timeoutMinutes = new TextInputBuilder()
        .setCustomId('timeoutMinutes')
        .setLabel('مدة التايم أوت بالدقائق')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(cfg.timeoutMinutes));
    
    const threshold = new TextInputBuilder()
        .setCustomId('threshold')
        .setLabel('الحساسية (low / medium / high)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(cfg.threshold);
    
    const logChannelId = new TextInputBuilder()
        .setCustomId('logChannelId')
        .setLabel('ID روم السجلات (أو none)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(cfg.logChannelId || 'none');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(action),
        new ActionRowBuilder().addComponents(timeoutMinutes),
        new ActionRowBuilder().addComponents(threshold),
        new ActionRowBuilder().addComponents(logChannelId)
    );
    
    return modal;
}

function buildIgnoresModal(ownerId, guildId) {
    const cfg = aimod.getAiModConfig(guildId);
    
    const modal = new ModalBuilder()
        .setCustomId(`aimodModal:ignores:${ownerId}`)
        .setTitle('🚫 استثناءات AI Moderation');
    
    const ignoreChannels = new TextInputBuilder()
        .setCustomId('ignoreChannelIds')
        .setLabel('IDs الرومات المستثناة (مفصولة بمسافة)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(cfg.ignoreChannelIds.join(' ') || ' ');
    
    const ignoreRoles = new TextInputBuilder()
        .setCustomId('ignoreRoleIds')
        .setLabel('IDs الرولات المستثناة (مفصولة بمسافة)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(cfg.ignoreRoleIds.join(' ') || ' ');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(ignoreChannels),
        new ActionRowBuilder().addComponents(ignoreRoles)
    );
    
    return modal;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aimod')
        .setDescription('إعدادات AI Moderation (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        const embed = buildAiModEmbed(interaction.guild.id);
        const components = buildAiModRows(interaction.user.id, interaction.guild.id);
        return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    },

    buildAiModEmbed,
    buildAiModRows,
    buildSettingsModal,
    buildIgnoresModal
};
