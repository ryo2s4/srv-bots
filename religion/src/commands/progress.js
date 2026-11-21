const { SlashCommandBuilder } = require('discord.js');
const util = require('../util');

module.exports = {
  data: new SlashCommandBuilder().setName('progress').setDescription('عرض تقدمك وسلسلة القراءة'),

  async execute(interaction, { store }) {
    const user = store.getUser(interaction.user.id);
    const inventoryText = user.inventory.length ? user.inventory.join(', ') : 'لا توجد عناصر بعد.';
    return interaction.reply(
      `📊 تقدّمك:\n- التقدم في الختمة: ${util.calculateProgress(user.totalPages)}\n` +
        `- عدد الأيام المتتالية: ${user.streak} يوم${user.streak === 1 ? '' : 'ًا'}\n` +
        `- النقاط: ${user.points}\n- المتجر: ${inventoryText}`,
    );
  },
};
