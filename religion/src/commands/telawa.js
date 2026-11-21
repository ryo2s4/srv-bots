const { ChannelType, SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const sessionService = require('../sessionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('telawa')
    .setDescription('إنشاء جلسة تلاوة تلقائية')
    .addChannelOption((option) =>
      option.setName('voice_channel').setDescription('الروم الصوتي الذي سيدخل إليه البوت').addChannelTypes(ChannelType.GuildVoice).setRequired(true),
    )
    .addIntegerOption((option) =>
      option.setName('start_minutes').setDescription('بعد كم دقيقة تبدأ الجلسة؟').setMinValue(1).setMaxValue(60).setRequired(false),
    )
    .addIntegerOption((option) =>
      option.setName('duration').setDescription('مدة التلاوة بالدقائق').setMinValue(5).setMaxValue(120).setRequired(false),
    )
    .addChannelOption((option) =>
      option.setName('start_channel').setDescription('قناة إرسال رسالة بدء الجلسة').addChannelTypes(ChannelType.GuildText).setRequired(false),
    )
    .addChannelOption((option) =>
      option.setName('end_channel').setDescription('قناة إرسال رسالة انتهاء الجلسة').addChannelTypes(ChannelType.GuildText).setRequired(false),
    )
    .addChannelOption((option) =>
      option.setName('progress_channel').setDescription('قناة عرض تقدم القراءة بعد انتهاء الجلسة').addChannelTypes(ChannelType.GuildText).setRequired(false),
    ),

  async execute(interaction, { store }) {
    const startMinutes = interaction.options.getInteger('start_minutes') ?? config.DEFAULT_START_MINUTES;
    const duration = interaction.options.getInteger('duration') ?? config.DEFAULT_DURATION_MINUTES;
    const voiceChannel = interaction.options.getChannel('voice_channel');
    const startChannel = interaction.options.getChannel('start_channel') || interaction.channel;
    const endChannel = interaction.options.getChannel('end_channel') || interaction.channel;
    const progressChannel = interaction.options.getChannel('progress_channel') || interaction.channel;

    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      return interaction.reply({ content: '❌ يجب أن تحدد روم صوتي صالح للروم الصوتي الذي سيدخله البوت.', ephemeral: true });
    }
    if (voiceChannel.guildId !== interaction.guildId) {
      return interaction.reply({ content: '❌ يجب أن يكون الروم الصوتي في نفس السيرفر.', ephemeral: true });
    }

    const current = store.getSession(interaction.guildId);
    if (current && current.status === 'scheduled') {
      return interaction.reply({ content: '⚠️ هناك جلسة مجدولة بالفعل. يمكنك الانضمام إليها باستخدام /join_session.', ephemeral: true });
    }

    const session = {
      status: 'scheduled',
      organizerId: interaction.user.id,
      voiceChannelId: voiceChannel.id,
      notifyChannelId: startChannel.id,
      endChannelId: endChannel.id,
      progressChannelId: progressChannel.id,
      participants: [interaction.user.id],
      pagesByUser: {},
      startAt: Date.now() + startMinutes * 60 * 1000,
      duration,
      reminderSent: false,
    };
    store.setSession(interaction.guildId, session);
    sessionService.scheduleSessionTasks(interaction.guildId, store);

    const embed = sessionService.buildTelawaEmbed(session, voiceChannel, startChannel, endChannel, progressChannel);
    return interaction.reply({ embeds: [embed] });
  },
};
