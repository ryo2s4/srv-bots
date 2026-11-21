const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const games = require('../handlers/games');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('ورقة، حجر، مقص — أفضل من 3 ضد البوت ✊'),
    async execute(interaction) {
        const session = games.createRpsSession({
            ownerId: interaction.user.id,
            ownerTag: interaction.user.tag,
            guildId: interaction.guild ? interaction.guild.id : null
        });

        if (!session) {
            return interaction.reply({ embeds: [UI.error('آسف بس، ما قدرت أجهز اللعبة الآن… جرّب مرة ثانية 3:')], flags: MessageFlags.Ephemeral });
        }

        await interaction.reply(games.buildRpsMessage(session));
    }
};
