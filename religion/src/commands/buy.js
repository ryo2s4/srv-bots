const { SlashCommandBuilder } = require('discord.js');
const { shopItems } = require('../constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('شراء عنصر من المتجر')
    .addStringOption((option) =>
      option.setName('item_id').setDescription('معرف العنصر الذي تريد شرائه').setRequired(true),
    ),

  async execute(interaction, { store }) {
    const itemId = interaction.options.getString('item_id');
    const item = shopItems.find((entry) => entry.id === itemId);
    if (!item) {
      return interaction.reply({ content: '❌ هذا العنصر غير موجود في المتجر.', ephemeral: true });
    }

    const user = store.getUser(interaction.user.id);
    if (user.points < item.price) {
      return interaction.reply({ content: `❌ لا تملك ما يكفي من النقاط. تحتاج ${item.price} نقطة.`, ephemeral: true });
    }

    user.points -= item.price;
    user.inventory.push(item.name);
    store.saveUser(user);
    return interaction.reply(`✅ تم شراء ${item.name}. نقاطك المتبقية: ${user.points}.`);
  },
};
