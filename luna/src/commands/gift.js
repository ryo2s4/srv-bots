const { SlashCommandBuilder } = require('discord.js');
const { transferLunaPoints } = require('../levelsStore');
const { getUserInventory } = require('../shopStore');
const UI = require('../utils/ui');

function fmtUserWithTitle(guildId, user) {
    if (!guildId || !user) return String(user || '');
    const inv = getUserInventory(guildId, user.id);
    const t = inv && inv.activeTitle ? ` 🎭 ${inv.activeTitle}` : '';
    return `<@${user.id}>${t}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gift')
        .setDescription('إهداء Luna Points لشخص 🎁')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('الشخص المستلم')
                .setRequired(true))
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('عدد النقاط')
                .setMinValue(1)
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const toUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (toUser.bot) {
            return interaction.reply({ content: '❌ آسف بس ما ينفع تهدي نقاط للبوتات 🤖', ephemeral: true });
        }
        if (toUser.id === interaction.user.id) {
            return interaction.reply({ content: '❌ حلوة! بس ما ينفع تهدي نفسك 😄', ephemeral: true });
        }

        // Anti-abuse: small tax to reduce farming via alts
        const res = transferLunaPoints(interaction.guild.id, interaction.user.id, toUser.id, amount, 0.08);
        if (!res.ok) {
            return interaction.reply({ content: '❌ آسف بس رصيدك من Luna Points ما يكفي 😢', ephemeral: true });
        }

        // يبقى عام عشان الإعلان يشوفه الجميع (والمنشن يظل يطلع تنبيه)
        const content =
            `🎁 ${fmtUserWithTitle(interaction.guild.id, interaction.user)} أهدى ${fmtUserWithTitle(interaction.guild.id, toUser)} **${UI.fmtNum(res.net)}** Luna Points ✨\n` +
            `> 🧾 ضريبة التحويل: **${UI.fmtNum(res.tax)}** Luna Points`;

        return interaction.reply({ content });
    }
};
