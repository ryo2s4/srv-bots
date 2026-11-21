const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('answer')
    .setDescription('إجابة عن سؤال الفقه')
    .addStringOption((option) =>
      option.setName('answer_text').setDescription('اكتب جواب السؤال').setRequired(true),
    ),

  async execute(interaction, { store }) {
    const answerText = interaction.options.getString('answer_text').trim();
    const quiz = store.getQuiz(interaction.guildId);
    if (!quiz || !quiz.active) {
      return interaction.reply({ content: '⚠️ لا يوجد سؤال قائم الآن.', ephemeral: true });
    }
    if (quiz.answeredBy.includes(interaction.user.id)) {
      return interaction.reply({ content: '⚠️ لقد أجبت بالفعل على هذا السؤال.', ephemeral: true });
    }

    if (answerText === quiz.answer) {
      quiz.answeredBy.push(interaction.user.id);
      store.setQuiz(interaction.guildId, quiz);

      const user = store.getUser(interaction.user.id);
      user.points += config.QUIZ_REWARD_POINTS;
      store.saveUser(user);
      return interaction.reply(`✅ صحيح! حصلت على ${config.QUIZ_REWARD_POINTS} نقاط. مجموع نقاطك الآن ${user.points}.`);
    }

    return interaction.reply({ content: '❌ الإجابة غير صحيحة، حاول مرة أخرى.', ephemeral: true });
  },
};
