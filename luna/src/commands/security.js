const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const { getGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

function buildSecurityPanelEmbed(guildId) {
    const cfg = getGuildConfig(guildId);
    const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : {};

    const enabled = ar.enabled === true;
    const verifyEnabled = ar.verifyEnabled === true;
    const verifyRoleId = typeof ar.verifyRoleId === 'string' ? ar.verifyRoleId : null;
    const verifyChannelId = typeof ar.verifyChannelId === 'string' ? ar.verifyChannelId : null;

    const joinWindowMs = Math.max(10_000, Math.floor(Number(ar.joinWindowMs) || 60_000));
    const joinThreshold = Math.max(2, Math.floor(Number(ar.joinThreshold) || 6));
    const lockdownMs = Math.max(60_000, Math.floor(Number(ar.lockdownMs) || (20 * 60_000)));
    const lockdownUntil = Math.max(0, Math.floor(Number(ar.lockdownUntil) || 0));
    const retroMinutes = Math.max(0, Math.floor(Number(ar.retroMinutes) || 5));

    const now = Date.now();
    const lockdownActive = lockdownUntil && now < lockdownUntil;

    return UI.embed({
        title: '🛡️ لوحة الحماية (Security)',
        color: UI.COLORS.mod,
        description: 'تحكم بالحماية والتحقق من الأزرار تحت 👇',
        fields: [
            { name: '🛡️ Anti-Raid', value: enabled ? '✅ شغال' : '⛔ مطفي', inline: true },
            { name: '✅ التحقق (Verification)', value: verifyEnabled ? '✅ شغال' : '⛔ مطفي', inline: true },
            { name: '🔒 الـ Lockdown', value: lockdownActive ? `✅ فعال (ينتهي <t:${Math.floor(lockdownUntil / 1000)}:R>)` : '⛔ غير فعال', inline: false },
            { name: '🎖️ رتبة التحقق', value: verifyRoleId ? `<@&${verifyRoleId}>` : 'غير محدد', inline: true },
            { name: '💬 روم التحقق', value: verifyChannelId ? `<#${verifyChannelId}>` : 'غير محدد', inline: true },
            { name: '⏱️ نافذة الانضمام', value: UI.fmtDuration(joinWindowMs), inline: true },
            { name: '🎯 حد الانضمامات', value: UI.fmtNum(joinThreshold), inline: true },
            { name: '⏳ مدة الـ Lockdown', value: UI.fmtDuration(lockdownMs), inline: true },
            { name: '♻️ نافذة التحقق الرجعي', value: UI.fmtDuration(retroMinutes * 60_000), inline: true }
        ]
    });
}

function buildSecurityPanelRows(ownerId) {
    const row1 = UI.row(
        UI.btn(`securitypanel:toggle:${ownerId}`, '🛡️ Anti-Raid On/Off', { style: ButtonStyle.Primary }),
        UI.btn(`securitypanel:verifytoggle:${ownerId}`, '✅ Verify On/Off', { style: ButtonStyle.Secondary }),
        UI.btn(`securitypanel:lockdown:${ownerId}`, '🚨 Lockdown الآن', { style: ButtonStyle.Danger }),
        UI.btn(`securitypanel:unlock:${ownerId}`, '🔓 Unlock', { style: ButtonStyle.Secondary }),
        UI.btn(`securitypanel:refresh:${ownerId}`, '🔄 تحديث', { style: ButtonStyle.Secondary })
    );

    const row2 = UI.row(
        UI.btn(`securitypanel:set_channel:${ownerId}`, '📍 تحديد روم التحقق', { style: ButtonStyle.Secondary }),
        UI.btn(`securitypanel:thresholds:${ownerId}`, '📊 إعدادات الحساسية', { style: ButtonStyle.Secondary })
    );

    return [row1, row2];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('security')
        .setDescription('لوحة الحماية والتحقق (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    buildSecurityPanelEmbed,
    buildSecurityPanelRows,

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'آسف بس هذا الأمر للإدمن فقط 3:', flags: MessageFlags.Ephemeral });
        }

        const ownerId = String(interaction.user.id);
        const embed = buildSecurityPanelEmbed(interaction.guild.id);
        const components = buildSecurityPanelRows(ownerId);
        return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }
};
