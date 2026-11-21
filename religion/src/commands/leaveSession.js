const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('leave_session').setDescription('مغادرة جلسة التلاوة'),

  async execute(interaction, { store }) {
    const session = store.getSession(interaction.guildId);
    if (!session || session.status !== 'scheduled') {
      return interaction.reply({ content: '⚠️ لا توجد جلسة حالية لتغادرها.', ephemeral: true });
    }

    session.participants = session.participants.filter((id) => id !== interaction.user.id);
    store.setSession(interaction.guildId, session);
    return interaction.reply('✅ تم حذفك من جلسة التلاوة.');
  },
};
