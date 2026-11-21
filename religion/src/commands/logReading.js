const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const util = require('../util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('log_reading')
    .setDescription('تسجيل الصفحات المقروءة')
    .addIntegerOption((option) =>
      option.setName('pages').setDescription('عدد الصفحات التي قرأتها').setMinValue(1).setMaxValue(100).setRequired(true),
    ),

  async execute(interaction, { store }) {
    const pages = interaction.options.getInteger('pages');
    const user = store.getUser(interaction.user.id);
    const today = util.formatDate();

    user.totalPages += pages;
    user.points += pages * config.POINTS_PER_PAGE;

    // Streak: same day = no change, yesterday = +1, otherwise restart at 1.
    if (user.lastReadDate !== today) {
      if (util.isYesterday(user.lastReadDate)) {
        user.streak += 1;
      } else {
        user.streak = 1;
      }
      user.lastReadDate = today;
    }

    const session = store.getSession(interaction.guildId);
    if (session && session.status === 'ongoing' && session.participants.includes(interaction.user.id)) {
      session.pagesByUser[interaction.user.id] = (session.pagesByUser[interaction.user.id] || 0) + pages;
      store.setSession(interaction.guildId, session);
    }

    store.saveUser(user);
    return interaction.reply(
      `📖 تم تسجيل ${pages} صفحة. تقدمك الكلي الآن ${util.calculateProgress(user.totalPages)}. نقاطك زادت بـ ${pages * config.POINTS_PER_PAGE} نقطة.`,
    );
  },
};
