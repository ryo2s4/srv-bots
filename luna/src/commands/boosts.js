const { SlashCommandBuilder } = require('discord.js');
const { getUserInventory, updateUserInventory } = require('../shopStore');
const { getBoostNameAr } = require('../boostMeta');
const UI = require('../utils/ui');

async function respond(interaction, options) {
    if (interaction.deferred) return interaction.editReply(options);
    if (interaction.replied) return interaction.followUp(options);
    return interaction.reply({ ...options, ephemeral: options.ephemeral ?? true });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('boost')
        .setDescription('عرض البوستات النشطة والوقت المتبقي ⏳'),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const inv = getUserInventory(interaction.guild.id, interaction.user.id);
        const now = Date.now();

        const active = Array.isArray(inv.activeBoosts) ? inv.activeBoosts.filter(b => b && (!b.expiresAt || b.expiresAt > now)) : [];
        const expired = Array.isArray(inv.activeBoosts) ? inv.activeBoosts.filter(b => b && b.expiresAt && b.expiresAt <= now) : [];

        if (expired.length > 0) {
            updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
                const next = { ...cur };
                next.activeBoosts = Array.isArray(next.activeBoosts) ? next.activeBoosts.filter(b => b && (!b.expiresAt || b.expiresAt > now)) : [];
                return next;
            });
        }

        const lines = active
            .sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0))
            .slice(0, 20)
            .map((b) => `- ${getBoostNameAr(b.type)} — ⏳ ${b.expiresAt ? `متبقي ${UI.fmtDuration(b.expiresAt - now)}` : 'دائم'}`);

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '⏳ البوستات النشطة',
            description: lines.length
                ? lines.join('\n')
                : '> ما عندك بوستات نشطة الحين… عادي! تقدر تفعّل واحد من `/use` ✨',
            footerText: 'البوستات النشطة'
        });

        return respond(interaction, { embeds: [embed] });
    }
};
