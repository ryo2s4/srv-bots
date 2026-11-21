const { SlashCommandBuilder } = require('discord.js');
const { getGuildShop } = require('../shopStore');
const UI = require('../utils/ui');

function computeShopPower(inv) {
    const titles = Array.isArray(inv.titles) ? inv.titles.length : 0;
    const roles = Array.isArray(inv.roles) ? inv.roles.length : 0;
    const collectibles = Array.isArray(inv.collectibles) ? inv.collectibles.length : 0;
    const boosts = Array.isArray(inv.boosts) ? inv.boosts.length : 0;
    const activeBoosts = Array.isArray(inv.activeBoosts) ? inv.activeBoosts.length : 0;
    const s = inv.services && typeof inv.services === 'object' ? inv.services : {};
    const services =
        (Number(s.renameOnce) || 0) +
        (Number(s.xpTransfer) || 0) +
        (Number(s.shield) || 0) +
        (Number(s.rebalance) || 0) +
        (Number(s.vipTitle) || 0) +
        (Number(s.rerollDaily) || 0);

    return (
        titles * 8 +
        roles * 15 +
        collectibles * 25 +
        boosts * 6 +
        activeBoosts * 10 +
        services * 5
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('topshop')
        .setDescription('لوحة صدارة المتجر حسب Shop Power')
        .setDMPermission(false)
        .addIntegerOption((opt) =>
            opt
                .setName('limit')
                .setDescription('عدد الأعضاء المعروضين (حتى 15)')
                .setMinValue(1)
                .setMaxValue(15)
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const limit = interaction.options.getInteger('limit') || 10;
        const shop = getGuildShop(interaction.guild.id);
        const invs = shop.inventories && typeof shop.inventories === 'object' ? shop.inventories : {};

        const rows = Object.entries(invs)
            .map(([userId, inv]) => {
                const p = computeShopPower(inv || {});
                const col = Array.isArray(inv && inv.collectibles) ? inv.collectibles.length : 0;
                const roles = Array.isArray(inv && inv.roles) ? inv.roles.length : 0;
                return { userId: String(userId), power: p, collectibles: col, roles };
            })
            .filter((x) => x.power > 0)
            .sort((a, b) => (b.power - a.power) || (b.collectibles - a.collectibles) || (b.roles - a.roles))
            .slice(0, limit);

        if (!rows.length) {
            return interaction.reply({ content: '❌ لسه ما فيه بيانات متجر كفاية لعرض التوب 🌙', ephemeral: true });
        }

        const lines = rows.map((r, i) => {
            const prefix = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            return `${prefix} <@${r.userId}> — **${UI.fmtNum(r.power)}** Shop Power (🎖️ ${UI.fmtNum(r.collectibles)})`;
        });

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '🏆 صدارة Shop Power',
            description: lines.join('\n').slice(0, 3900),
            footerText: `سيرفر: ${interaction.guild.name}`
        });

        return interaction.reply({ embeds: [embed] });
    }
};
