require('dotenv').config();

const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const store = require('./store');
const sessionService = require('./sessionService');
const { commands, handlers, owner } = require('./commands');

const token = process.env.DISCORD_TOKEN?.trim().replace(/^"|"$/g, '').replace(/^\\'|\\'$/g, '');
if (!token) {
  console.error('❌ DISCORD_TOKEN missing in .env or empty after trimming. Copy .env.example to .env and add your bot token.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

sessionService.init(client);

client.once(Events.ClientReady, async () => {
  try {
    await client.application.commands.set(commands.map((c) => c.data));
    console.log(`✅ تم تسجيل ${commands.length} أمرًا.`);
  } catch (error) {
    console.error('❌ فشل تسجيل الأوامر:', error);
  }

  console.log(`✅ البوت متصل باسم ${client.user.tag}`);
  client.user.setActivity('جلسات التلاوة', { type: ActivityType.Watching });

  // Resume scheduled sessions / clean up stale ones after restart.
  sessionService.recoverSessions(store);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) return owner.handleButton(interaction);
    if (interaction.isModalSubmit()) return owner.handleModal(interaction);
    if (!interaction.isChatInputCommand()) return;

    const handler = handlers[interaction.commandName];
    if (!handler) return interaction.reply({ content: '⚠️ أمر غير معروف.', ephemeral: true });
    await handler(interaction, { client, store });
  } catch (error) {
    console.error('❌ خطأ أثناء معالجة الأمر:', error);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ content: 'حدث خطأ غير متوقع. الرجاء المحاولة مرة أخرى لاحقًا.', ephemeral: true }).catch(() => {});
    }
  }
});

client.on('error', (error) => {
  console.error('❌ خطأ في العميل:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

client.login(token).catch((error) => {
  console.error('❌ فشل تسجيل الدخول:', error);
});
