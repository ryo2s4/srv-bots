const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');

const { getGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setupcheck')
        .setDescription('فحص جاهزية إعدادات السيرفر والبوت (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'آسف بس هذا الأمر للإدمن فقط 3:', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);

        const guild = interaction.guild;
        const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
        const cfg = getGuildConfig(guild.id);

        const ar = cfg.antiRaid && typeof cfg.antiRaid === 'object' ? cfg.antiRaid : {};

        const perm = (flag) => (me && me.permissions && me.permissions.has(flag) ? '✅' : '⛔');

        const verifyChannelId = typeof ar.verifyChannelId === 'string' ? ar.verifyChannelId : null;
        const verifyChannelOk = verifyChannelId ? guild.channels.cache.has(verifyChannelId) : false;
        const retroMinutes = Math.max(0, Math.floor(Number(ar.retroMinutes) || 0));

        const embed = UI.embed({
            title: '🧪 فحص الجاهزية',
            color: UI.COLORS.info,
            description: 'تقرير سريع عن جاهزية البوت وإعدادات الحماية 👇'
        });

        embed.addFields(
            { name: '🔐 صلاحيات البوت', value: `Manage Roles: ${perm(PermissionFlagsBits.ManageRoles)}\nManage Channels: ${perm(PermissionFlagsBits.ManageChannels)}\nModerate Members: ${perm(PermissionFlagsBits.ModerateMembers)}\nView Audit Log: ${perm(PermissionFlagsBits.ViewAuditLog)}`, inline: true },
            { name: '🎖️ ترتيب الرتب', value: me ? `أعلى رتبة للبوت: **${me.roles.highest?.name || 'غير معروف'}**` : 'غير متاح', inline: true },
            { name: '🛡️ إعدادات الحماية', value: `Anti-Raid: **${ar.enabled === true ? 'شغال ✅' : 'مقفل ⛔'}**\nVerify: **${ar.verifyEnabled === true ? 'شغال ✅' : 'مقفل ⛔'}**\nRetro: **${UI.fmtDuration(retroMinutes * 60_000)}**`, inline: false },
            { name: '💬 روم التحقق', value: verifyChannelId ? `${verifyChannelOk ? '✅' : '⛔'} <#${verifyChannelId}>` : 'غير محدد', inline: false }
        );

        return interaction.editReply({ embeds: [embed] });
    }
};
