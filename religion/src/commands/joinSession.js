const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('join_session').setDescription('الانضمام إلى جلسة التلاوة المقبلة'),

  async execute(interaction, { store }) {
    const session = store.getSession(interaction.guildId);
    if (!session || session.status !== 'scheduled') {
      return interaction.reply({ content: '⚠️ لا توجد جلسة تلاوة مجدولة في الوقت الحالي.', ephemeral: true });
    }
    if (session.participants.includes(interaction.user.id)) {
      return interaction.reply({ content: '✅ أنت مسجل بالفعل في هذه الجلسة.', ephemeral: true });
    }

    session.participants.push(interaction.user.id);
    store.setSession(interaction.guildId, session);
    return interaction.reply('✅ تم تسجيلك في جلسة التلاوة. سيتم ذكر المشاركين قبل 5 دقائق من البداية.');
  },
};
