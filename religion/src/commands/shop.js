const { SlashCommandBuilder } = require('discord.js');
const { shopItems } = require('../constants');

module.exports = {
  data: new SlashCommandBuilder().setName('shop').setDescription('عرض متجر الألقاب والرموز'),

  async execute(interaction) {
    const shopText = shopItems
      .map((item) => '\n• `' + item.id + '` - ' + item.name + ' (' + item.price + ' نقطة)\n  ' + item.description)
      .join('');
    return interaction.reply(`🛍️ متجر التميز:${shopText}\n\nاستخدم /buy item_id للشراء.`);
  },
};
