const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

function buildEmbed(guildId) {
    const cfg = getGuildConfig(guildId);
    const d = cfg.dailyTasks && typeof cfg.dailyTasks === 'object' ? cfg.dailyTasks : {};
    const media = d.mediaChannelId ? `<#${d.mediaChannelId}>` : 'غير محدد';
    const voice = d.voiceChannelId ? `<#${d.voiceChannelId}>` : 'غير محدد';

    return UI.embed({
        color: UI.COLORS.info,
        title: '⚙️ إعدادات المهام اليومية',
        description: [
            `> 🖼️ **روم الميديا (صور/ملفات):** ${media}`,
            `> 🎙️ **روم الفويس:** ${voice}`,
            '',
            '💡 اكتب ID الروم في الفورم (Modal).'
        ].join('\n'),
        footerText: 'إعدادات المهام اليومية'
    });
}

function buildRows(ownerId) {
    const row = UI.row(
        UI.btn(`dailycfg:media:${ownerId}`, 'تحديد روم الميديا', { style: ButtonStyle.Secondary }),
        UI.btn(`dailycfg:voice:${ownerId}`, 'تحديد روم الفويس', { style: ButtonStyle.Secondary }),
        UI.btn(`dailycfg:clear:${ownerId}`, 'مسح الإعدادات', { style: ButtonStyle.Danger }),
        UI.btn(`dailycfg:refresh:${ownerId}`, 'تحديث', { style: ButtonStyle.Primary })
    );
    return [row];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dailyconfig')
        .setDescription('إعداد رومات مهام اليومية (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const ownerId = String(interaction.user.id);
        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId);
        return interaction.reply({ embeds: [embed], components, ephemeral: true });
    },

    buildEmbed,
    buildRows,

    async handleButton(interaction) {
        if (!interaction.guild) return;

        const parts = String(interaction.customId || '').split(':');
        const action = parts[1] || '';
        const ownerId = parts[2] || '';

        if (ownerId && String(interaction.user.id) !== String(ownerId)) {
            return interaction.reply({ content: '❌ آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
        }

        if (action === 'refresh') {
            const embed = buildEmbed(interaction.guild.id);
            const components = buildRows(ownerId || interaction.user.id);
            return interaction.update({ embeds: [embed], components });
        }

        if (action === 'clear') {
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                dailyTasks: { mediaChannelId: null, voiceChannelId: null }
            }));
            const embed = buildEmbed(interaction.guild.id);
            const components = buildRows(ownerId || interaction.user.id);
            return interaction.update({ embeds: [embed], components });
        }

        if (action === 'media' || action === 'voice') {
            const cfg = getGuildConfig(interaction.guild.id);
            const d = cfg.dailyTasks && typeof cfg.dailyTasks === 'object' ? cfg.dailyTasks : {};
            const current = action === 'media' ? (d.mediaChannelId || '') : (d.voiceChannelId || '');

            const modal = new ModalBuilder()
                .setCustomId(`dailycfgModal:${action}:${ownerId}`)
                .setTitle(action === 'media' ? 'تحديد روم الميديا' : 'تحديد روم الفويس');

            const input = new TextInputBuilder()
                .setCustomId('channelId')
                .setLabel('اكتب Channel ID')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            if (String(current)) input.setValue(String(current).slice(0, 100));

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            try {
                return interaction.showModal(modal);
            } catch {
                return interaction.reply({ content: '❌ آسف بس ما قدرت أفتح الفورم 3:', ephemeral: true });
            }
        }

        return interaction.reply({ content: '❌ آسف بس ما فهمت 3:', ephemeral: true });
    },

    async handleModal(interaction) {
        if (!interaction.guild) return;

        const parts = String(interaction.customId || '').split(':');
        const action = parts[1] || '';
        const ownerId = parts[2] || '';

        if (ownerId && String(interaction.user.id) !== String(ownerId)) {
            return interaction.reply({ content: '❌ آسف بس هاللوحة لصاحبها بس 3:', ephemeral: true });
        }
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true });
        }

        const raw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
        if (!raw || !/^\d+$/.test(raw)) {
            return interaction.reply({ content: '❌ اكتب ID صحيح 3:', ephemeral: true });
        }

        let ch;
        try {
            ch = await interaction.guild.channels.fetch(raw);
        } catch {
            ch = null;
        }
        if (!ch) {
            return interaction.reply({ content: '❌ ما لقيت هذا الروم 3:', ephemeral: true });
        }

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            dailyTasks: {
                ...(c.dailyTasks && typeof c.dailyTasks === 'object' ? c.dailyTasks : {}),
                ...(action === 'media' ? { mediaChannelId: ch.id } : {}),
                ...(action === 'voice' ? { voiceChannelId: ch.id } : {})
            }
        }));

        const embed = buildEmbed(interaction.guild.id);
        const components = buildRows(ownerId || interaction.user.id);

        try {
            await interaction.deferReply({ ephemeral: true });
        } catch {
            // ignore
        }
        return interaction.editReply({ embeds: [embed], components });
    }
};
