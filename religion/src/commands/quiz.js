const { SlashCommandBuilder } = require('discord.js');
const { questionBank } = require('../constants');

module.exports = {
  data: new SlashCommandBuilder().setName('quiz').setDescription('طرح سؤال ديني للمجموعة'),

  async execute(interaction, { store }) {
    const existing = store.getQuiz(interaction.guildId);
    if (existing && existing.active) {
      return interaction.reply({
        content: `📚 يوجد سؤال قائم الآن: ${existing.question}\nاستخدم /answer للرد.`,
        ephemeral: true,
      });
    }

    const question = questionBank[Math.floor(Math.random() * questionBank.length)];
    store.setQuiz(interaction.guildId, {
      active: true,
      questionId: question.id,
      question: question.question,
      choices: question.choices,
      answer: question.answer,
      answeredBy: [],
    });

    const choicesText = question.choices.map((choice, index) => `\n${index + 1}. ${choice}`).join('');
    return interaction.reply(`❓ سؤال ديني:${question.question}${choicesText}\nاستخدم /answer واكتب الجواب بشكل كامل.`);
  },
};
