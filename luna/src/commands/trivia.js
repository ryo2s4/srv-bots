const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const games = require('../handlers/games');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('تحدّي نفسك — أسئلة معلومات صعبة ضد لونا 🧠')
        .addIntegerOption(option =>
            option.setName('questions')
                .setDescription('عدد الأسئلة (3-10)')
                .setRequired(false)
                .setMinValue(3)
                .setMaxValue(10)),
    async execute(interaction) {
        const count = interaction.options.getInteger('questions') || 5;

        const session = games.createTriviaSession({
            ownerId: interaction.user.id,
            ownerTag: interaction.user.tag,
            guildId: interaction.guild ? interaction.guild.id : null,
            count
        });

        if (!session) {
            return interaction.reply({ embeds: [UI.error('آسف بس، ما قدرت أجهز الأسئلة الآن… جرّب مرة ثانية 3:')], flags: MessageFlags.Ephemeral });
        }

        await interaction.reply(games.buildTriviaMessage(session));
    }
};
