const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ButtonStyle
} = require('discord.js');
const UI = require('../utils/ui');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');

function fmtMult(m) {
    const pct = Math.round((Number(m) - 1) * 100);
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function buildConfigEmbed(guildId) {
    const cfg = getGuildConfig(guildId);
    const rewards = Array.isArray(cfg.levelRewards) ? cfg.levelRewards : [];

    const desc = rewards.length === 0
        ? 'ما في مكافآت بعد. أضف أول مكافأة! 🎁'
        : [...rewards]
            .sort((a, b) => a.level - b.level)
            .map((r) => {
                const kind = r.type === 'luna_points' ? '🌙 Luna Points' :
                    `⚡ ${r.type}`;
                const pct = r.type.endsWith('_boost') ? ` (${fmtMult(r.multiplier)})` : '';
                const valueText = r.type === 'luna_points' ? ` +${r.value}` : '';
                return `**المستوى ${r.level}** → ${r.label}${pct}${valueText}`;
            })
            .join('\n');

    return UI.embed({
        color: UI.COLORS.levels,
        title: '🎁 مكافآت المستويات',
        description: desc,
        footerText: `${UI.fmtNum(rewards.length)} مكافأة`
    });
}

function buildConfigRows(ownerId) {
    return [
        UI.row(
            UI.btn(`levelrewards:add:${ownerId}`, '➕ إضافة مكافأة', { style: ButtonStyle.Success }),
            UI.btn(`levelrewards:remove:${ownerId}`, '🗑️ حذف مكافأة', { style: ButtonStyle.Danger }),
            UI.btn(`levelrewards:refresh:${ownerId}`, '🔄 تحديث', { style: ButtonStyle.Secondary })
        )
    ];
}

const data = new SlashCommandBuilder()
    .setName('levelrewards')
    .setDescription('إدارة مكافآت المستويات')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(interaction) {
    const ownerId = interaction.user.id;
    const embed = buildConfigEmbed(interaction.guild.id);
    const components = buildConfigRows(ownerId);
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

module.exports = {
    data,
    execute,
    buildConfigEmbed,
    buildConfigRows
};
