const { EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const config = require('./config');

let client = null;

function init(c) {
  client = c;
}

// Every scheduled timer is tracked here so we can clean them up and never double-fire.
const timeouts = new Map();

function setTimer(key, ms, fn) {
  if (timeouts.has(key)) clearTimeout(timeouts.get(key));
  const timer = setTimeout(() => {
    timeouts.delete(key);
    fn();
  }, ms);
  timeouts.set(key, timer);
}

function clearAllTimers() {
  for (const t of timeouts.values()) clearTimeout(t);
  timeouts.clear();
}

/**
 * (Re)arm the timers for one guild's session:
 *  - scheduled → reminder (5 min before) + start timers
 *  - ongoing   → end timer (remaining time), or silent cleanup if already past due
 */
function scheduleSessionTasks(guildId, store) {
  const session = store.getSession(guildId);
  if (!session) return;

  const now = Date.now();

  if (session.status === 'scheduled') {
    const reminderAt = session.startAt - config.REMINDER_BEFORE_MS;
    if (reminderAt > now) {
      setTimer(`${guildId}-reminder`, reminderAt - now, () => sendReminder(guildId, store));
    }
    if (session.startAt > now) {
      setTimer(`${guildId}-start`, session.startAt - now, () => beginSession(guildId, store));
    }
  }

  if (session.status === 'ongoing') {
    const endAt = session.startAt + session.duration * 60 * 1000;
    const remaining = endAt - now;
    if (remaining > 0) {
      setTimer(`${guildId}-end`, remaining, () => endSession(guildId, store));
    } else {
      endSession(guildId, store, { silent: true });
    }
  }
}

/**
 * Called on bot startup. Resumes timers for scheduled sessions and cleans up
 * stale ones (bot was offline when a session should have started/ended).
 */
function recoverSessions(store) {
  const now = Date.now();
  for (const { guildId, session } of store.getAllSessions()) {
    if (!session) continue;

    if (session.status === 'scheduled') {
      const startAt = session.startAt || 0;
      if (startAt <= now) {
        // Start time passed while the bot was offline — abandon it quietly.
        endSession(guildId, store, { silent: true });
      } else {
        scheduleSessionTasks(guildId, store);
      }
    } else if (session.status === 'ongoing') {
      scheduleSessionTasks(guildId, store); // arms end timer, or cleans up if past due
    }
  }
}

async function sendReminder(guildId, store) {
  const session = store.getSession(guildId);
  if (!session || session.status !== 'scheduled') return;

  const channel = await client.channels.fetch(session.notifyChannelId || session.textChannelId).catch(() => null);
  if (!channel) return;

  const mentions = (session.participants || []).map((id) => `<@${id}>`).join(' ');
  await channel
    .send(`⏳ تذكير: جلسة التلاوة ستبدأ بعد 5 دقائق. ${mentions}\nالرجاء التجهز للدخول إلى الروم الصوتي.`)
    .catch(() => {});
  session.reminderSent = true;
  store.setSession(guildId, session);
}

async function beginSession(guildId, store) {
  const session = store.getSession(guildId);
  if (!session || session.status !== 'scheduled') return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const textChannel = await client.channels.fetch(session.notifyChannelId || session.textChannelId).catch(() => null);
  const voiceChannel = await guild.channels.fetch(session.voiceChannelId).catch(() => null);

  if (!textChannel || !voiceChannel) {
    store.setSession(guildId, null);
    return;
  }

  session.status = 'ongoing';
  store.setSession(guildId, session);

  joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfMute: true,
  });

  const mentions = (session.participants || []).map((id) => `<@${id}>`).join(' ');
  await textChannel.send(`📢 بدأت جلسة التلاوة الآن! ${mentions}\nالرجاء الانضمام إلى الروم الصوتي.`).catch(() => {});

  setTimer(`${guildId}-end`, session.duration * 60 * 1000, () => endSession(guildId, store));
}

/**
 * End a session: post the summary (unless silent, used for stale cleanup),
 * credit participants with a completed session, leave the voice channel and
 * drop the session row entirely.
 */
async function endSession(guildId, store, opts = {}) {
  const session = store.getSession(guildId);
  if (!session || session.status === 'ended') return;

  const participants = session.participants || [];
  const pagesByUser = session.pagesByUser || {};

  if (!opts.silent) {
    const endChannel = await client.channels
      .fetch(session.endChannelId || session.notifyChannelId || session.textChannelId)
      .catch(() => null);
    const progressChannel = await client.channels
      .fetch(session.progressChannelId || session.endChannelId || session.notifyChannelId || session.textChannelId)
      .catch(() => null);

    const mentions = participants.map((id) => `<@${id}>`).join(' ');
    const totalSessionPages = Object.values(pagesByUser).reduce((sum, value) => sum + value, 0);

    const userSummaries = participants
      .map((id) => {
        const userData = store.getUser(id);
        const pages = pagesByUser[id] || 0;
        return `- <@${id}>: ${pages} صفحة، السلسلة الحالية: ${userData.streak} يوم${userData.streak === 1 ? '' : 'ًا'}.`;
      })
      .join('\n');

    if (endChannel) {
      await endChannel
        .send(
          `📌 ${mentions}\n✅ انتهت جلسة التلاوة بعد ${session.duration} دقيقة.\n` +
            `شكراً لحضوركم وأثابكم الله.\n` +
            `مجموع الصفحات المقروءة في هذه الجلسة: ${totalSessionPages} صفحة.\n` +
            `${userSummaries}`,
        )
        .catch(() => {});
    }

    if (progressChannel && progressChannel.id !== (endChannel && endChannel.id)) {
      await progressChannel
        .send(`📊 نهاية الجلسة:\n- عدد الصفحات في الجلسة: ${totalSessionPages}\n- تقدم القارئين:\n${userSummaries}`)
        .catch(() => {});
    }

    for (const id of participants) {
      const userData = store.getUser(id);
      userData.completedSessions += 1;
      store.saveUser(userData);
    }
  }

  const voiceConnection = getVoiceConnection(guildId);
  if (voiceConnection) voiceConnection.destroy();

  store.setSession(guildId, null);
}

function buildTelawaEmbed(session, voiceChannel, startChannel, endChannel, progressChannel) {
  return new EmbedBuilder()
    .setColor(config.EMBED_COLOR)
    .setTitle('تخصيص جلسة التلاوة')
    .setDescription('تم إنشاء جلسة تلاوة مع تفعيل التشغيل التلقائي والإشعارات.')
    .addFields([
      { name: 'موعد الجلسة', value: `<t:${Math.floor(session.startAt / 1000)}:F>`, inline: false },
      { name: 'الروم الصوتي', value: voiceChannel ? voiceChannel.toString() : 'غير محدد', inline: true },
      { name: 'مدة الجلسة', value: `${session.duration} دقيقة`, inline: true },
      { name: 'قناة بدء الجلسة', value: startChannel.toString(), inline: false },
      { name: 'قناة انتهاء الجلسة', value: endChannel.toString(), inline: false },
      { name: 'قناة عرض التقدم', value: progressChannel.toString(), inline: false },
      { name: 'كيفية التسجيل', value: '/join_session للانضمام، /leave_session للمغادرة، /log_reading لتسجيل القراءة', inline: false },
    ])
    .setFooter({ text: 'سيعمل البوت تلقائياً في هذه الجلسة.' });
}

module.exports = { init, scheduleSessionTasks, recoverSessions, buildTelawaEmbed, clearAllTimers };
