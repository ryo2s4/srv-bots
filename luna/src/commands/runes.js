const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');
const { buildRunesView } = require('../handlers/runes');

const data = new SlashCommandBuilder()
    .setName('runes')
    .setDescription('إدارة الرونات الخاصة بك (بيع، شراء، ترقية)')
    .setDMPermission(false);

async function execute(interaction) {
    if (!interaction.guild) return;

    const payload = buildRunesView(interaction.guild.id, interaction.user.id);
    // Handle possible auto-defer from index.js (2500ms timer)
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
    } else {
        await interaction.reply({
            ...payload,
            flags: MessageFlags.Ephemeral
        });
    }
}

module.exports = { data, execute };
