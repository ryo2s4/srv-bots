const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('points').setDescription('عرض نقاطك الحالية'),

  async execute(interaction, { store }) {
    const user = store.getUser(interaction.user.id);
    return interaction.reply(`💰 لديك ${user.points} نقطة. استعملها في المتجر أو اجمع المزيد بالتلاوة والأسئلة.`);
  },
};
