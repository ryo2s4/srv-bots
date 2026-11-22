const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
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
        UI.btn(`musiccat:shiir:${owner}`, 'شعر'),
        UI.btn(`musiccat:quran:${owner}`, 'قران'),
        UI.btn(`musiccat:halal:${owner}`, 'موسيقى حلال'),
        UI.btn(`musiccat:anashid:${owner}`, 'اناشيد')
    );
    const row2 = UI.row(
        UI.btn(`musicsetvolume:${owner}`, '🔊 Volume'),
        UI.btn('musicctl:stop', '⏹️ Stop', { style: ButtonStyle.Danger }),
        UI.btn('musicctl:pause', '⏸️ Pause', { style: ButtonStyle.Secondary }),
        UI.btn('musicctl:play', '▶️ Resume', { style: ButtonStyle.Success }),
        UI.btn('musicctl:queue', '📥 Playlist', { style: ButtonStyle.Primary })
    );
    const row3 = UI.row(
        UI.btn(`musicsettings:${owner}`, '⚙️ إعدادات', { style: ButtonStyle.Secondary }),
        UI.btn('musicctl:skip', '⏭️ تخطي', { style: ButtonStyle.Secondary }),
        UI.btn(`musicview:choose:${owner}`, '🔙 اختيار المصدر', { style: ButtonStyle.Secondary }),
        UI.btn(`musiconline:${owner}`, '🌐 أونلاين', { style: ButtonStyle.Success })
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

        const mode = session && session.viewMode ? session.viewMode : 'panel';
        let built;
        if (mode === 'choose') built = buildChooserView(guildId, resolvedOwner);
        else if (mode === 'tray') built = buildTrayPlayerView(guildId, resolvedOwner);
        else built = buildNowPlayingEmbed(guildId);

        const embed = built && built.embed ? built.embed : null;
        if (!embed) return;

        const components = built.components
            ? built.components
            : buildPanelRows(resolvedOwner, built.state, session);
        const payload = { embeds: [embed], components };
        if (built.files && built.files.length) payload.files = built.files;
        await msg.edit(payload).catch(() => null);
    } catch (e) {
        logError('Music UI - failed to refresh panel message', e, { guildId });
    }
}

// First screen when /music runs: pick the source.
function buildChooserView(guildId, ownerId = null) {
    const session = getOrCreateVoiceSession(guildId);
    const title = session.currentTrack && session.currentTrack.displayName;
    const embed = UI.embed({
        title: '🎧 لوحة الموسيقى',
        color: UI.COLORS.music,
        description:
            'من وين تحب تشغّل؟\n\n' +
            '💾 **محلي** — ملفات لونا المعروضة (اناشيد، قران، موسيقى حلال، شعر)\n' +
            '🌐 **أونلاين** — مشغّل YouTube مع قرص الألبوم والتقدم والوقت\n\n' +
            (title ? `> الآن: **${String(title).slice(0, 200)}**` : ''),
        footerText: 'اختر مصدر واحد وبعدين تحكم بالتشغيل من الأزرار'
    });
    const owner = ownerId || session.lastPanelOwnerId || '0';
    const rows = [
        UI.row(
            UI.btn(`musicview:local:${owner}`, '💾 محلي', { style: ButtonStyle.Primary }),
            UI.btn(`musicview:online:${owner}`, '🌐 أونلاين', { style: ButtonStyle.Success })
        )
    ];
    return { embed, components: rows };
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
    const channelName = session.voiceChannelRef && session.voiceChannelRef.name
        ? String(session.voiceChannelRef.name)
        : (session.voiceChannelId ? `<#${session.voiceChannelId}>` : '—');
    const authorName = session.currentTrack && session.currentTrack.channel
        ? String(session.currentTrack.channel).slice(0, 200)
        : null;

    const embed = UI.embed({
        title: '🎵 مشغّل الموسيقى',
        color: UI.COLORS.music,
        description:
            `${status}\n\n` +
            `> **🎶 ${title.slice(0, 256)}**\n\n` +
            (bar ? `${bar}\n` : '') +
            `**⏱️ ${progress}**\n` +
            `**🕒 ${UI.fmtMmSs(durMs)}** كامل المقطع · **⏳ ${UI.fmtMmSs(elapsedMs)}** منقضي`,
        fields: [
            { name: 'المصدر', value: source, inline: true },
            { name: '🔊 الصوت', value: `**${volPct}%**`, inline: true },
            { name: '📥 بالقائمة', value: `**${queueLen}**`, inline: true },
            { name: '🫶 مطلوب بواسطة', value: requestedBy, inline: true },
            { name: '🎤 القناة', value: channelName, inline: true },
            ...(authorName ? [{ name: '🎼 القناة/المؤلف', value: authorName, inline: true }] : [])
        ],
        footerText: '💿 القرص يوضّح صورة المقطع • الأزرار للتحكم'
    });

    // Circular album art referenced from the same message (no external host).
    const files = [];
    const disc = session.currentTrack && session.currentTrack.discBuffer;
    if (disc && Buffer.isBuffer(disc)) {
        files.push(new AttachmentBuilder(disc, { name: 'disc.png' }));
        embed.setImage('attachment://disc.png');
    }

    const owner = ownerId || session.lastPanelOwnerId || '0';
    const rows = [
        UI.row(
            UI.btn('musicctl:play', '▶️ Play', { style: ButtonStyle.Success }),
            UI.btn(`musicsetvolume:${owner}`, '🔊 Volume', { style: ButtonStyle.Primary }),
            UI.btn('musicctl:pause', '⏸️ Pause', { style: ButtonStyle.Secondary }),
            UI.btn('musicctl:stop', '⏹️ Stop', { style: ButtonStyle.Danger }),
            UI.btn('musicctl:resume', '⏵️ Resume', { style: ButtonStyle.Success })
        ),
        UI.row(
            UI.btn(`musiconput:${owner}`, '🔗 رابط / اسم أغنية', { style: ButtonStyle.Success }),
            UI.btn('musicctl:skip', '⏭️ تخطي', { style: ButtonStyle.Secondary }),
            UI.btn('musicctl:queue', '📥 القائمة', { style: ButtonStyle.Secondary }),
            UI.btn(`musicview:choose:${owner}`, '🔙 المصدر', { style: ButtonStyle.Secondary })
        )
    ];

    return { embed, components: rows, files, state };
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
    buildChooserView,
    getQueueLines,
    buildPanelRows,
    // Alias kept for older call sites
    buildMusicPanelRows: buildPanelRows,
    buildCategoryBrowseView
};
