const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const UI = require('../utils/ui');
const { getOrCreateVoiceSession, buildMusicState, getPlaybackProgressMs, putPlayBrowseCache, getPlayBrowseCache, listCategoryFiles, AUDIO_CATEGORIES } = require('./voiceManager');
const { logError } = require('../utils/log');

function repeatModeLabel(session) {
    const mode = session.repeatMode || (session.repeat ? 'one' : 'off');
    if (mode === 'one') return '🔁 مقطع واحد';
    if (mode === 'all') return '🔂 كل القائمة';
    return 'مطفى';
}

/**
 * Panel button rows (3 rows: categories / navigation / playback).
 * Signature is (ownerId, state?, session?) — extra args are optional and
 * accepted for call-site compatibility.
 */
function buildPanelRows(resolvedOwner, state = null, session = null) {
    const owner = resolvedOwner && resolvedOwner !== '0' ? resolvedOwner : '0';

    const row1 = UI.row(
        UI.btn(`musiccat:anashid:${owner}`, 'اناشيد'),
        UI.btn(`musiccat:halal:${owner}`, 'موسيقى حلال'),
        UI.btn(`musiccat:quran:${owner}`, 'قران'),
        UI.btn(`musiccat:shiir:${owner}`, 'شعر'),
        UI.btn(`musiconline:${owner}`, 'أونلاين', { style: ButtonStyle.Success, emoji: '🌐' })
    );
    const row2 = UI.row(
        UI.btn('musicctl:queue', 'قائمة الانتظار'),
        UI.btn('musicctl:seekback', '-15ث', { emoji: '⏪' }),
        UI.btn('musicctl:seekfwd', '+15ث', { emoji: '⏩' }),
        UI.btn('musicctl:skip', 'تخطي', { style: ButtonStyle.Danger }),
        UI.btn(`musicsettings:${owner}`, 'إعدادات', { style: ButtonStyle.Primary })
    );
    const row3 = UI.row(
        UI.btn('musicctl:pause', 'إيقاف مؤقت', { style: ButtonStyle.Danger }),
        UI.btn('musicctl:play', 'تشغيل', { style: ButtonStyle.Success }),
        UI.btn('musicctl:repeat', 'التكرار'),
        UI.btn('musicctl:voldown', 'صوت -'),
        UI.btn('musicctl:volup', 'صوت +')
    );
    return [row1, row2, row3];
}

async function refreshMusicPanelMessage(guildId, client) {
    try {
        const session = getOrCreateVoiceSession(guildId);
        const panel = session && session.musicPanel && typeof session.musicPanel === 'object' ? session.musicPanel : null;
        if (!panel || !panel.channelId || !panel.messageId) return;
        const channelId = String(panel.channelId);
        const messageId = String(panel.messageId);
        const ownerId = panel.ownerId ? String(panel.ownerId) : null;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const ch = guild.channels.cache.get(channelId);
        if (!ch || typeof ch.messages?.fetch !== 'function') return;

        const msg = await ch.messages.fetch(messageId).catch(() => null);
        if (!msg) return;

        const resolvedOwner = ownerId || (session && session.lastPanelOwnerId ? String(session.lastPanelOwnerId) : null) || null;
        if (!resolvedOwner || resolvedOwner === '0') return;

        const tray = session && session.viewMode === 'tray';
        const built = tray ? buildTrayPlayerView(guildId, resolvedOwner) : buildNowPlayingEmbed(guildId);
        const embed = built && built.embed ? built.embed : null;
        if (!embed) return;

        const components = tray
            ? built.components
            : buildPanelRows(resolvedOwner, built.state, session);
        await msg.edit({ embeds: [embed], components }).catch(() => null);
    } catch (e) {
        logError('Music UI - failed to refresh panel message', e, { guildId });
    }
}

// Compact "tray player" shown after starting an online track: one big title,
// a progress bar, time, source, volume and transport buttons.
function buildTrayPlayerView(guildId, ownerId = null) {
    const session = getOrCreateVoiceSession(guildId);
    const state = buildMusicState(session);
    const title = state.current && state.current.info && state.current.info.title
        ? state.current.info.title
        : 'ما فيه شي شغال';
    const durMs = Number(session.trackDurationMs) || 0;
    const elapsedMs = getPlaybackProgressMs(session);
    const active = state.playing || session.paused;
    const bar = active ? UI.progressBar(elapsedMs, durMs || 1, 20) : null;
    const progress = durMs
        ? `${UI.fmtMmSs(elapsedMs)} / ${UI.fmtMmSs(durMs)}`
        : (active ? `${UI.fmtMmSs(elapsedMs)} / ؟` : '00:00 / 00:00');
    const status = state.playing ? '▶️ شغّالة الآن' : (session.paused ? '⏸️ موقوفة مؤقتًا' : '⏹️ متوقفة');
    const source = session.currentTrack && session.currentTrack.source === 'url' ? '🌐 YouTube / أونلاين' : '💾 ملفات محلية';
    const volPct = Math.round(Math.max(0, Math.min(2, Number(session.volume) || 1)) * 100);
    const queueLen = Array.isArray(session.queue) ? session.queue.length : 0;
    const requestedBy = session.currentTrack && session.currentTrack.requestedBy
        ? `<@${String(session.currentTrack.requestedBy)}>` : '—';

    const embed = UI.embed({
        title: '🎵 مشغّل الموسيقى',
        color: UI.COLORS.music,
        description:
            `${status}\n\n` +
            `> **🎶 ${title.slice(0, 256)}**\n\n` +
            (bar ? `${bar}\n` : '') +
            `**⏱️ ${progress}**`,
        fields: [
            { name: 'المصدر', value: source, inline: true },
            { name: '🔊 الصوت', value: `**${volPct}%**`, inline: true },
            { name: '📥 بالقائمة', value: `**${queueLen}**`, inline: true },
            { name: '🫶 مطلوب بواسطة', value: requestedBy, inline: true },
            { name: '🔁 التكرار', value: repeatModeLabel(session), inline: true }
        ],
        footerText: 'استخدم الأزرار للتحكم • 🎛️ ترجع للوحة الكاملة'
    });

    const rows = [
        UI.row(
            UI.btn('musicctl:stop', '⏹️ إيقاف', { style: ButtonStyle.Danger }),
            UI.btn('musicctl:pause', '⏸️ توقف مؤقت', { style: ButtonStyle.Secondary }),
            UI.btn('musicctl:play', '▶️ تشغيل', { style: ButtonStyle.Success }),
            UI.btn('musicctl:skip', '⏭️ تخطي', { style: ButtonStyle.Secondary })
        ),
        UI.row(
            UI.btn('musicctl:voldown', '🔉 صوت -', { style: ButtonStyle.Secondary }),
            UI.btn('musicctl:volup', '🔊 صوت +', { style: ButtonStyle.Secondary }),
            UI.btn('musicctl:repeat', '🔁 التكرار', { style: ButtonStyle.Secondary }),
            UI.btn('musicctl:queue', '📥 القائمة', { style: ButtonStyle.Secondary }),
            UI.btn('musicctl:panel', '🎛️ اللوحة', { style: ButtonStyle.Primary })
        ),
        UI.row(
            UI.btn(`musiconput:${ownerId || '0'}`, '🔗 رابط / اسم أغنية', { style: ButtonStyle.Success })
        )
    ];

    return { embed, components: rows, state };
}

function buildNowPlayingEmbed(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const state = buildMusicState(session);
    const title = state.current ? (state.current.info && state.current.info.title ? state.current.info.title : 'Track') : null;
    const requestedByRaw = session.currentTrack && session.currentTrack.requestedBy ? String(session.currentTrack.requestedBy) : null;
    const requestedBy = requestedByRaw && requestedByRaw !== '0' ? requestedByRaw : null;
    const durMs = Number(session.trackDurationMs) || 0;
    const elapsedMs = getPlaybackProgressMs(session);
    const active = state.playing || session.paused;

    const progressTxt = durMs
        ? `${UI.fmtMmSs(elapsedMs)} / ${UI.fmtMmSs(durMs)}`
        : (active ? `${UI.fmtMmSs(elapsedMs)} / ؟` : null);

    const bar = active ? UI.progressBar(elapsedMs, durMs || 1, 16) : null;

    const statusLine = state.playing
        ? '▶️ شغّالة الآن'
        : (session.paused ? '⏸️ موقوفة مؤقتًا' : '🟣 جاهزين للتشغيل');

    const queueLen = Array.isArray(session.queue) ? session.queue.length : 0;
    const nextUp = queueLen > 0 ? (session.queue[0].displayName || session.queue[0].filePath || 'Track') : null;
    const volPct = Math.round(Math.max(0, Math.min(2, Number(session.volume) || 1)) * 100);

    const fields = [];
    if (bar && progressTxt) {
        fields.push({ name: '⏱️ التقدم', value: `${bar}\n${progressTxt}`, inline: false });
    }
    fields.push(
        { name: '🔁 التكرار', value: repeatModeLabel(session), inline: true },
        { name: '✨ التشغيل التلقائي', value: session.autoplayShuffle ? 'مفعل' : 'مطفى', inline: true },
        { name: '🔊 الصوت', value: `**${volPct}%**`, inline: true }
    );
    if (queueLen > 0) {
        fields.push({ name: '📥 بالقائمة', value: `**${queueLen}** مقطع`, inline: true });
    }
    if (nextUp) {
        fields.push({ name: '⏭️ التالي', value: nextUp.slice(0, 1024), inline: true });
    }
    if (requestedBy) {
        fields.push({ name: '🫶 مطلوب بواسطة', value: `<@${requestedBy}>`, inline: true });
    }

    const embed = UI.embed({
        title: '🎧 لوحة الموسيقى',
        color: UI.COLORS.music,
        description: title
            ? `${statusLine}\n\n> **🎵 الآن:** ${title}`
            : `${statusLine}\n\n> **🎵 الآن:** ما فيه شي شغال`,
        fields,
        footerText: 'لونا هنا عشان تخلي السهرة ألطف ✨'
    });

    return { embed, state, components: buildPanelRows(session.lastPanelOwnerId, state, session) };
}

function getQueueLines(guildId, limit = 10) {
    const session = getOrCreateVoiceSession(guildId);
    const q = Array.isArray(session.queue) ? session.queue : [];
    const lim = Math.max(0, Math.min(25, Math.floor(Number(limit) || 10)));
    return q.slice(0, lim).map((t, i) => {
        const title = t.displayName || t.filePath || 'Track';
        const by = t.requestedBy && String(t.requestedBy) !== '0' ? ` — <@${t.requestedBy}>` : '';
        return `**${i + 1}.** ${title}${by}`;
    });
}

// ---- Category browse view with pagination (25 files per page) ----
const BROWSE_PAGE_SIZE = 25;

function buildCategoryBrowseView(guildId, ownerId, catKey, page = 0) {
    const cat = AUDIO_CATEGORIES[catKey];
    if (!cat) return null;

    const files = listCategoryFiles(catKey);
    if (!files.length) {
        return {
            embeds: [
                UI.embed({
                    title: `🎧 ${cat.title}`,
                    description: 'ما لقيت ملفات صوت بهالقسم… حط ملفات **mp3/wav/ogg/m4a** داخل المجلد وبعدين جرّب ثانية 3:'
                })
            ],
            components: []
        };
    }

    // Cache the FULL list so any page's selection resolves.
    putPlayBrowseCache(guildId, ownerId, catKey, files);
    const cached = getPlayBrowseCache(guildId, ownerId, catKey);
    const valueToName = cached && cached.valueToName ? cached.valueToName : new Map();

    const totalPages = Math.max(1, Math.ceil(files.length / BROWSE_PAGE_SIZE));
    const p = Math.min(Math.max(0, Math.floor(Number(page) || 0)), totalPages - 1);
    const pageFiles = files.slice(p * BROWSE_PAGE_SIZE, (p + 1) * BROWSE_PAGE_SIZE);

    const options = pageFiles.map((name, idx) => {
        const safeName = String(name);
        const found = [...valueToName.entries()].find(([, v]) => v === safeName);
        const value = found ? found[0] : `f${p * BROWSE_PAGE_SIZE + idx}`;
        return {
            label: safeName.slice(0, 100),
            value: String(value).slice(0, 100)
        };
    });

    const embed = UI.embed({
        title: `🎶 اختر من ${cat.title}`,
        color: UI.COLORS.music,
        description:
            'هذه القائمة تطلع لك لحالك عشان تختار براحتك ✨\n\n' +
            `📄 صفحة **${p + 1}** من **${totalPages}** — **${files.length}** ملف`
    });

    const { StringSelectMenuBuilder } = require('discord.js');
    const select = new StringSelectMenuBuilder()
        .setCustomId(`musicfile:${catKey}:${ownerId}`)
        .setPlaceholder('اختار ملف...')
        .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);
    const navRow = UI.row(
        UI.btn(`musicpage:${catKey}:${ownerId}:${p - 1}`, 'السابق', { emoji: '◀️', disabled: p <= 0 }),
        UI.btn(`musicpage:${catKey}:${ownerId}:${p + 1}`, 'التالي', { emoji: '▶️', disabled: p >= totalPages - 1 }),
        UI.btn(`musicback:${ownerId}`, 'رجوع'),
        UI.btn(`musicsettings:${ownerId}`, 'إعدادات', { style: ButtonStyle.Primary })
    );

    return { embeds: [embed], components: [row, navRow] };
}

module.exports = {
    refreshMusicPanelMessage,
    buildNowPlayingEmbed,
    buildTrayPlayerView,
    getQueueLines,
    buildPanelRows,
    // Alias kept for older call sites
    buildMusicPanelRows: buildPanelRows,
    buildCategoryBrowseView
};
