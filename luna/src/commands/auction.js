const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getGuildShop } = require('../shopStore');
const { getUserInventory } = require('../shopStore');

function fmtUserWithTitle(guildId, userId) {
    if (!guildId || !userId) return '-';
    const inv = getUserInventory(guildId, userId);
    const t = inv && inv.activeTitle ? ` 🎭 ${inv.activeTitle}` : '';
    return `<@${userId}>${t}`;
}

module.exports = {
    disabled: true,
    data: new SlashCommandBuilder()
        .setName('auction')
        .setDescription('عرض حالة المزاد الأسطوري 🏆'),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
        }

        const shop = getGuildShop(interaction.guild.id);
        const a = shop.auction;

        const embed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('🏆 المزاد الأسطوري — رتبة أسطورية')
            .setDescription('للمزايدة استخدم زر **Bid** من داخل `/shop` 👇')
            .addFields(
                { name: 'الرتبة الأسطورية', value: a.legendaryRoleId ? `<@&${a.legendaryRoleId}>` : 'غير محددة بعد', inline: false },
                { name: 'الحالة', value: a.active ? 'نشط ✅' : 'غير نشط ⛔', inline: true },
                { name: 'ينتهي', value: a.active ? `<t:${Math.floor(a.endsAt / 1000)}:R>` : '-', inline: true },
                { name: 'أعلى مزايدة', value: a.active ? `**${a.highestBid}** Luna Points ✨` : '-', inline: true },
                { name: 'أعلى مزايد', value: a.active && a.highestBidderId ? fmtUserWithTitle(interaction.guild.id, a.highestBidderId) : '-', inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
