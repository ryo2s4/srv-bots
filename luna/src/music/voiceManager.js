const { spawn } = require('child_process');
const { PermissionsBitField, MessageFlags } = require('discord.js');
const { logError } = require('../utils/log');

const voiceSessions = new Map();
const playBrowseCache = new Map();

// A track is either a local file (filePath) or an online stream (url).
// Keep the `filePath` field for both so all existing resume/seek/skip logic
// keeps working — ffmpeg accepts a local path or an http(s) URL equally.
function trackSource(track) {
    if (!track) return null;
    if (typeof track.url === 'string' && isHttpSource(track.url)) return track.url;
    if (typeof track.filePath === 'string' && track.filePath) return track.filePath;
    return null;
}
function isHttpSource(src) {
    return /^https?:\/\//i.test(String(src || ''));
}

// Registered by createMusicAPI(client) so playback can refresh the music panel UI.
let panelRefresher = null;
function setPanelRefresher(fn) {
    panelRefresher = typeof fn === 'function' ? fn : null;
}
async function refreshPanelSafe(guildId) {
    if (!panelRefresher) return;
    try {
        await panelRefresher(guildId);
    } catch {
        // ignore
    }
}

function getOrCreateVoiceSession(guildId) {
    let session = voiceSessions.get(guildId);
    if (!session) {
        session = {
            connection: null,
            player: null,
            ffmpeg: null,
            volume: 1,
            repeat: false,
            repeatMode: 'off',
            autoplayShuffle: false,
            voiceChannelId: null,
            lastTrack: null,
            currentTrack: null,
            queue: [],
            currentResource: null
        };
        voiceSessions.set(guildId, session);
    } else {
        if (typeof session.volume !== 'number') session.volume = 1;
        if (typeof session.repeat !== 'boolean') session.repeat = false;
        if (session.repeatMode !== 'one' && session.repeatMode !== 'all') {
            session.repeatMode = session.repeat ? 'one' : 'off';
        }
        if (typeof session.autoplayShuffle !== 'boolean') session.autoplayShuffle = false;
        if (!('voiceChannelId' in session)) session.voiceChannelId = null;
        if (!('lastTrack' in session)) session.lastTrack = null;
        if (!('currentTrack' in session)) session.currentTrack = null;
        if (!Array.isArray(session.queue)) session.queue = [];
        if (!('currentResource' in session)) session.currentResource = null;
        if (!('ffmpeg' in session)) session.ffmpeg = null;
    }
    return session;
}

// ---- Audio categories & cached directory listing ----
const AUDIO_CATEGORIES = {
    anashid: { title: 'اناشيد', folder: 'اناشيد' },
    halal: { title: 'موسيقى حلال', folder: 'موسيقى حلال' },
    quran: { title: 'قران', folder: 'قران' },
    shiir: { title: 'شعر', folder: 'شعر' }
};

const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|mp4|m3a)$/i;
const fileListCache = new Map(); // folder -> { files, exp }
const FILE_LIST_TTL_MS = 60 * 1000;

function listCategoryFiles(catKey) {
    const cat = AUDIO_CATEGORIES[catKey];
    if (!cat) return [];
    return listFolderFiles(cat.folder);
}

function listFolderFiles(folderName) {
    const cached = fileListCache.get(folderName);
    if (cached && Date.now() < cached.exp) return cached.files;

    const fs = require('fs');
    const path = require('path');
    let files = [];
    try {
        const dir = path.join(__dirname, '..', '..', 'audio', folderName);
        if (fs.existsSync(dir)) {
            files = fs.readdirSync(dir, { withFileTypes: true })
                .filter((d) => d && d.isFile && d.isFile())
                .map((d) => d.name)
                .filter((name) => AUDIO_EXT_RE.test(String(name)))
                .sort((a, b) => String(a).localeCompare(String(b), 'ar'));
        }
    } catch {
        files = [];
    }
    fileListCache.set(folderName, { files, exp: Date.now() + FILE_LIST_TTL_MS });
    return files;
}

function refreshFolderListing(folderName) {
    fileListCache.delete(folderName);
    return listFolderFiles(folderName);
}

function resolveCategoryTrack(catKey, fileName) {
    const cat = AUDIO_CATEGORIES[catKey];
    if (!cat || !fileName) return null;
    const path = require('path');
    const fs = require('fs');
    const filePath = path.join(__dirname, '..', '..', 'audio', cat.folder, String(fileName));
    if (!fs.existsSync(filePath)) return null;
    return { filePath, displayName: String(fileName) };
}

function normalizeTrackTitle(track) {
    if (!track) return null;
    if (track.displayName) return String(track.displayName);
    if (track.info && track.info.title) return String(track.info.title);
    return null;
}

function buildMusicState(session) {
    const s = session && typeof session === 'object' ? session : {};
    const current = s.currentTrack
        ? { info: { title: s.currentTrack.displayName || s.currentTrack.filePath || 'Track', uri: null } }
        : null;
    const queue = Array.isArray(s.queue)
        ? s.queue.map((t) => ({ info: { title: t.displayName || t.filePath || 'Track', uri: null } }))
        : [];
    const playing = !!(s.player && s.player.state && s.player.state.status && s.player.state.status !== 'idle');
    return { playing, current, queue };
}

function getPlaybackProgressMs(session) {
    try {
        const startedAt = Number(session.trackStartedAt) || 0;
        const baseOffset = Number(session.trackOffsetMs) || 0;
        const elapsed = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
        return Math.max(0, baseOffset + elapsed);
    } catch {
        return 0;
    }
}

function renderProgressBar(elapsedMs, totalMs, width = 14) {
    const w = Math.max(6, Math.min(24, Math.floor(Number(width) || 14)));
    const total = Math.max(0, Math.floor(Number(totalMs) || 0));
    const elapsed = Math.max(0, Math.floor(Number(elapsedMs) || 0));
    if (!total) {
        const fill = Math.max(0, Math.min(w, Math.floor(elapsed / 5000)));
        return `${'▰'.repeat(fill)}${'▱'.repeat(Math.max(0, w - fill))}`;
    }
    const ratio = Math.max(0, Math.min(1, elapsed / total));
    const fill = Math.max(0, Math.min(w, Math.round(ratio * w)));
    return `${'▰'.repeat(fill)}${'▱'.repeat(Math.max(0, w - fill))}`;
}

function clampNumber(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
}

function pickRandomAudioFile(excludeFilePaths = []) {
    const exclude = new Set((Array.isArray(excludeFilePaths) ? excludeFilePaths : []).map(String));
    const path = require('path');
    const baseDir = path.join(__dirname, '..', '..', 'audio');
    let all = [];
    try {
        for (const cat of Object.values(AUDIO_CATEGORIES)) {
            const files = listFolderFiles(cat.folder);
            for (const name of files) {
                const filePath = path.join(baseDir, cat.folder, name);
                if (!exclude.has(filePath)) all.push({ name, filePath });
            }
        }
    } catch {
        all = [];
    }
    if (!all.length) {
        // Everything is excluded — fall back to a full pick rather than nothing.
        return pickRandomAudioFileUnfiltered();
    }
    return all[Math.floor(Math.random() * all.length)];
}

function pickRandomAudioFileUnfiltered() {
    const path = require('path');
    const baseDir = path.join(__dirname, '..', '..', 'audio');
    const all = [];
    for (const cat of Object.values(AUDIO_CATEGORIES)) {
        for (const name of listFolderFiles(cat.folder)) {
            all.push({ name, filePath: path.join(baseDir, cat.folder, name) });
        }
    }
    if (!all.length) return null;
    return all[Math.floor(Math.random() * all.length)];
}

// ---- Queue management ----

function addToQueue(guildId, track) {
    const session = getOrCreateVoiceSession(guildId);
    if (!Array.isArray(session.queue)) session.queue = [];
    if (track) session.queue.push(track);
    return session.queue.length;
}

function removeFromQueue(guildId, index) {
    const session = getOrCreateVoiceSession(guildId);
    const q = Array.isArray(session.queue) ? session.queue : [];
    const idx = Math.floor(Number(index));
    if (!Number.isFinite(idx) || idx < 0 || idx >= q.length) return null;
    const removed = q.splice(idx, 1)[0];
    session.queue = q;
    return removed;
}

function clearQueue(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const count = Array.isArray(session.queue) ? session.queue.length : 0;
    session.queue = [];
    return count;
}

function shuffleQueue(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const q = Array.isArray(session.queue) ? session.queue : [];
    for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
    }
    session.queue = q;
    return q.length;
}

function setRepeatMode(guildId, mode) {
    const session = getOrCreateVoiceSession(guildId);
    const m = mode === 'one' || mode === 'all' ? mode : 'off';
    session.repeatMode = m;
    session.repeat = m === 'one'; // back-compat for old callers
    return m;
}

function cycleRepeatMode(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const order = ['off', 'one', 'all'];
    const cur = order.includes(session.repeatMode) ? session.repeatMode : 'off';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    return setRepeatMode(guildId, next);
}

function setVolumeLevel(guildId, volume) {
    const session = getOrCreateVoiceSession(guildId);
    session.volume = clampNumber(volume, 0, 2);
    if (session.currentResource) {
        try {
            session.currentResource.volume.setVolume(session.volume);
        } catch {
            // ignore
        }
    }
    return session.volume;
}

async function stopGuildPlayback(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    try {
        // Only suppress the idle event if the player is actually playing
        // (stopping an already-idle player emits nothing — a set flag would
        // then get stuck and swallow the NEXT track's natural end).
        const playing = !!(session.player && session.player.state && session.player.state.status && session.player.state.status !== 'idle');
        session.__suppressNextIdle = playing;
        session.queue = [];
        session.currentTrack = null;
        session.lastTrack = null;
        session.paused = false;
        session.__skipRequested = false;
        session.trackOffsetMs = 0;
        session.trackStartedAt = 0;
        session.trackDurationMs = 0;
    } catch {
        // ignore
    }
    try {
        if (session.ffmpeg) {
            try { session.ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
            session.ffmpeg = null;
        }
    } catch {
        // ignore
    }
    try {
        if (session.player) session.player.stop(true);
    } catch {
        // ignore
    }
}

async function pauseGuildPlayback(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const playing = !!(session.player && session.player.state && session.player.state.status && session.player.state.status !== 'idle');
    if (!playing || !session.currentTrack) return { ok: false, error: 'ما فيه شي شغال' };

    const startedAt = Number(session.trackStartedAt) || 0;
    const baseOffset = Number(session.trackOffsetMs) || 0;
    const elapsed = startedAt ? Math.max(0, Date.now() - startedAt) : 0;

    try {
        session.__suppressNextIdle = true;
        session.paused = true;
        session.trackOffsetMs = Math.max(0, baseOffset + elapsed);
        session.trackStartedAt = 0;
    } catch {
        // ignore
    }

    try {
        if (session.ffmpeg) {
            try { session.ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
            session.ffmpeg = null;
        }
    } catch {
        // ignore
    }

    try {
        if (session.player) session.player.stop(true);
    } catch {
        // ignore
    }
    return { ok: true };
}

async function resumeGuildPlayback(interaction) {
    try {
        if (!interaction || !interaction.guild) return { ok: false, error: 'ما فيه سيرفر' };
        const session = getOrCreateVoiceSession(interaction.guild.id);
        const source = trackSource(session && session.currentTrack);
        if (!session || !session.paused || !source) {
            return { ok: false, error: 'ما فيه شي موقوف مؤقتاً' };
        }
        await startPlaybackFromFile(interaction, source, session.currentTrack.displayName || source);
        return { ok: true };
    } catch {
        return { ok: false, error: 'ما قدرت أكمل التشغيل' };
    }
}

// Seek by a relative number of milliseconds (positive or negative).
// Works while playing or paused: restarts ffmpeg at the new offset.
async function seekByMs(guildId, deltaMs) {
    const session = getOrCreateVoiceSession(guildId);
    const source = trackSource(session.currentTrack);
    if (!source) {
        return { ok: false, error: 'ما فيه شي شغال' };
    }

    const durMs = Number(session.trackDurationMs) || 0;
    const currentMs = session.paused
        ? Math.max(0, Number(session.trackOffsetMs) || 0)
        : getPlaybackProgressMs(session);

    let targetMs = currentMs + Math.floor(Number(deltaMs) || 0);
    targetMs = Math.max(0, targetMs);
    if (durMs > 0) targetMs = Math.min(targetMs, Math.max(0, durMs - 1500));

    session.trackOffsetMs = targetMs;
    session.paused = false;
    session.__seekRestart = true;

    try {
        await startPlaybackFromFile(
            makeInternalInteraction(guildId, session.currentTrack.requestedBy),
            source,
            session.currentTrack.displayName || source
        );
        return { ok: true, positionMs: targetMs, durationMs: durMs };
    } catch {
        return { ok: false, error: 'ما قدرت أنتقل للموضع هذا' };
    }
}

async function skipGuildTrack(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const q = Array.isArray(session.queue) ? session.queue : [];
    const hasNext = q.length > 0;
    const repeatMode = session.repeatMode || (session.repeat ? 'one' : 'off');
    const playing = !!(session.player && session.player.state && session.player.state.status && session.player.state.status !== 'idle');

    // When paused (or stopped) the player is already idle — player.stop() emits
    // no event, so the idle handler never runs. Handle the skip inline there.
    if (!playing) {
        session.paused = false;
        session.__skipRequested = false;
        if (hasNext) {
            await playNextFromQueue(guildId);
            return;
        }
        const lastSource = trackSource(session.lastTrack);
        if (repeatMode === 'all' && lastSource) {
            session.queue.push({ ...session.lastTrack, filePath: lastSource, requestedBy: session.currentTrack && session.currentTrack.requestedBy });
            await playNextFromQueue(guildId);
            return;
        }
        session.currentTrack = null;
        session.trackOffsetMs = 0;
        session.trackStartedAt = 0;
        session.trackDurationMs = 0;
        await refreshPanelSafe(guildId);
        return;
    }

    session.__skipRequested = true;
    try {
        if (session.ffmpeg) {
            try { session.ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
            session.ffmpeg = null;
        }
    } catch {
        // ignore
    }
    try {
        if (session.player) session.player.stop(true);
    } catch {
        // ignore
    }
    if (!hasNext && repeatMode === 'off') {
        session.currentTrack = null;
    }
}

function shiftNextQueuedTrack(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const q = Array.isArray(session.queue) ? session.queue : [];
    const next = q.shift() || null;
    session.queue = q;
    return next;
}

async function playNextFromQueue(guildId) {
    const session = getOrCreateVoiceSession(guildId);
    const next = shiftNextQueuedTrack(guildId);
    if (!next) return false;

    const source = trackSource(next);
    if (!source) return false;
    await startPlaybackFromFile(makeInternalInteraction(guildId, next.requestedBy), source, next.displayName || source, {
        durationMs: next.durationMs,
        discBuffer: next.discBuffer
    });
    return true;
}

// Build an interaction-like object for internal playback starts (queue/auto/repeat).
// Uses the real guild object captured from a previous user interaction.
function makeInternalInteraction(guildId, userId) {
    const session = getOrCreateVoiceSession(guildId);
    const guild = session.guildRef || { id: guildId };
    return {
        guild,
        member: {
            voice: {
                channel: session.voiceChannelRef || (guild.channels && session.voiceChannelId
                    ? guild.channels.cache.get(session.voiceChannelId)
                    : null) || { id: session.voiceChannelId }
            }
        },
        user: { id: userId || '0' },
        deferred: false,
        replied: true,
        followUp: async () => {},
        reply: async () => {},
        deferReply: async () => {}
    };
}

async function startAutoplayNext(guildId) {
    try {
        const session = getOrCreateVoiceSession(guildId);
        if (!session.autoplayShuffle) return;
        if (!session.voiceChannelId) return;

        // Avoid immediately repeating the last few tracks when possible.
        const recent = [session.currentTrack && session.currentTrack.filePath, session.lastTrack && session.lastTrack.filePath]
            .filter(Boolean)
            .map(String);
        const pick = pickRandomAudioFile(recent);
        if (!pick) return;

        await startPlaybackFromFile(makeInternalInteraction(guildId, session.autoplayEnabledBy), pick.filePath, pick.name);
    } catch (e) {
        logError('Music autoplay - failed to start next track', e, { guildId });
    }
}

function putPlayBrowseCache(guildId, userId, catKey, files, ttlMs = 10 * 60 * 1000) {
    const key = `${String(guildId)}:${String(userId)}:${String(catKey)}`;
    const list = Array.isArray(files) ? files : [];
    const valueToName = new Map();
    const crypto = require('crypto');
    for (let i = 0; i < list.length; i += 1) {
        const name = String(list[i] || '');
        const hash = crypto.createHash('sha1').update(name).digest('hex').slice(0, 12);
        const v = `f${i}-${hash}`;
        valueToName.set(v, name);
    }
    playBrowseCache.set(key, { files: list, valueToName, exp: Date.now() + ttlMs });
}

function getPlayBrowseCache(guildId, userId, catKey) {
    const key = `${String(guildId)}:${String(userId)}:${String(catKey)}`;
    const v = playBrowseCache.get(key);
    if (!v) return null;
    if (Date.now() > (v.exp || 0)) {
        playBrowseCache.delete(key);
        return null;
    }
    return v;
}

async function startPlaybackFromFile(interaction, filePath, displayName, meta = {}) {
    if (!interaction.guild) return;

    const voice = interaction.member && interaction.member.voice ? interaction.member.voice : null;
    const channel = voice && voice.channel ? voice.channel : null;
    if (!channel) {
        try {
            if (interaction.deferred || interaction.replied) {
                return interaction.followUp({ content: 'ادخل فويس أول وبعدين جرّب 3:', flags: MessageFlags.Ephemeral });
            }
            return interaction.reply({ content: 'ادخل فويس أول وبعدين جرّب 3:', flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    }

    const botMember = await interaction.guild.members.fetchMe().catch(() => null);
    if (botMember) {
        const botPerms = channel.permissionsFor(botMember);
        if (!botPerms || !botPerms.has(PermissionsBitField.Flags.CONNECT)) {
            logError('Music playback - missing CONNECT permission', null, { guildId: interaction.guild.id, channelId: channel.id });
            try {
                if (interaction.deferred || interaction.replied) {
                    return interaction.followUp({ content: 'ما عندي صلاحية الدخول للفويس هذا 3:', flags: MessageFlags.Ephemeral });
                }
                return interaction.reply({ content: 'ما عندي صلاحية الدخول للفويس هذا 3:', flags: MessageFlags.Ephemeral });
            } catch { return; }
        }
        if (!botPerms.has(PermissionsBitField.Flags.Speak)) {
            logError('Music playback - missing SPEAK permission', null, { guildId: interaction.guild.id, channelId: channel.id });
            try {
                if (interaction.deferred || interaction.replied) {
                    return interaction.followUp({ content: 'ما عندي صلاحية التكلم بالفويس هذا 3:', flags: MessageFlags.Ephemeral });
                }
                return interaction.reply({ content: 'ما عندي صلاحية التكلم بالفويس هذا 3:', flags: MessageFlags.Ephemeral });
            } catch { return; }
        }
    }

    let joinVoiceChannel;
    let createAudioPlayer;
    let createAudioResource;
    let AudioPlayerStatus;
    let NoSubscriberBehavior;
    let entersState;
    let VoiceConnectionStatus;
    let StreamType;
    try {
        ({
            joinVoiceChannel,
            createAudioPlayer,
            createAudioResource,
            AudioPlayerStatus,
            NoSubscriberBehavior,
            entersState,
            VoiceConnectionStatus,
            StreamType
        } = require('@discordjs/voice'));
    } catch {
        try {
            return interaction.followUp({ content: 'نقص حزمة الفويس. ثبتها: `npm i @discordjs/voice` ثم أعد تشغيل البوت.', flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    }

    let ffmpegPath;
    try {
        ffmpegPath = require('ffmpeg-static');
    } catch {
        ffmpegPath = null;
    }
    if (!ffmpegPath) {
        try {
            return interaction.followUp({ content: 'آسف بس ما اقدر اشغل الصوت بدون FFmpeg… ثبّت الحزمة: `npm i ffmpeg-static prism-media` ثم أعد تشغيل البوت 3:', flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    }

    const session = getOrCreateVoiceSession(interaction.guild.id);
    try {
        session.voiceChannelId = channel.id;
        session.guildRef = interaction.guild;
        session.voiceChannelRef = channel;
        session.__guildId = interaction.guild.id;
    } catch {
        // ignore
    }

    try {
        const currentSource = trackSource(session.currentTrack);
        const sameFile = !!(currentSource && String(currentSource) === String(filePath));
        const isResume = !!(session.paused && sameFile);
        const isSeek = !!session.__seekRestart && sameFile;
        if (!isResume && !isSeek) {
            session.trackOffsetMs = 0;
            session.trackDurationMs = 0;
        }
        session.__seekRestart = false;
        // A new (non-resume) playback invalidates any stale suppress flag
        if (!isResume) session.__suppressNextIdle = false;
    } catch {
        // ignore
    }

    // yt-dlp already knows the duration; keep it for the progress bar since
    // piped streams don't always expose a Duration line to ffmpeg.
    try {
        if (meta && Number(meta.durationMs) > 0) session.trackDurationMs = Number(meta.durationMs);
    } catch { /* ignore */ }

    const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
    const isAbortErr = (err) => {
        try {
            return !!(err && (err.code === 'ABORT_ERR' || err.name === 'AbortError' || String(err.message || '').includes('aborted')));
        } catch {
            return false;
        }
    };

    const attachConnLogsOnce = () => {
        try {
            if (session.__voiceLogAttached) return;
            if (!session.connection || typeof session.connection.on !== 'function') return;
            session.__voiceLogAttached = true;
            session.connection.on('stateChange', (oldState, newState) => {
                try {
                    const o = oldState && oldState.status ? String(oldState.status) : 'unknown';
                    const n = newState && newState.status ? String(newState.status) : 'unknown';
                    if (o !== n) console.log(`[voice:${interaction.guild.id}] ${o} -> ${n}`);
                } catch {
                    // ignore
                }
            });
        } catch {
            // ignore
        }
    };

    const waitForReadyWithRecovery = async (connection) => {
        const maxWaitMs = 90_000;
        const stepReadyMs = 45_000;

        const start = Date.now();
        while (true) {
            const left = maxWaitMs - (Date.now() - start);
            if (left <= 0) {
                await entersState(connection, VoiceConnectionStatus.Ready, 1);
                return;
            }

            try {
                await entersState(connection, VoiceConnectionStatus.Ready, Math.min(stepReadyMs, left));
                return;
            } catch (e) {
                const status = connection?.state?.status;
                if (status === VoiceConnectionStatus.Disconnected) {
                    try {
                        if (typeof connection.rejoin === 'function') {
                            connection.rejoin();
                        }
                    } catch {
                        // ignore
                    }
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
                        ]);
                        continue;
                    } catch {
                        try { connection.destroy(); } catch { /* ignore */ }
                        throw e;
                    }
                }

                if (!isAbortErr(e)) throw e;

                await sleepMs(500);
            }
        }
    };

    try {
        if (!session.player) {
            session.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
            session.player.on('error', (e) => {
                logError('Music playback - audio player error', e, { guildId: interaction.guild.id });
            });
        }

        const connStatus = session.connection?.state?.status;
        const connectionLooksInvalid =
            !session.connection ||
            !session.connection.joinConfig ||
            !session.connection.state ||
            typeof session.connection.subscribe !== 'function';

        const needNewConnection =
            connectionLooksInvalid ||
            session.connection.joinConfig.channelId !== channel.id ||
            connStatus !== VoiceConnectionStatus.Ready;

        const connectOnce = async () => {
            session.connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: true
            });

            attachConnLogsOnce();
            await waitForReadyWithRecovery(session.connection);
        };

        const ensureVoiceReady = async () => {
            const attempts = 3;
            for (let i = 0; i < attempts; i += 1) {
                try {
                    const currentStatus = session.connection?.state?.status;
                    const connInvalid =
                        !session.connection ||
                        !session.connection.joinConfig ||
                        !session.connection.state ||
                        typeof session.connection.subscribe !== 'function';

                    const wrongChannel = !connInvalid && session.connection.joinConfig.channelId !== channel.id;
                    const notReady = !connInvalid && currentStatus !== VoiceConnectionStatus.Ready;

                    if (connInvalid || wrongChannel) {
                        try { if (session.connection) session.connection.destroy(); } catch { /* ignore */ }
                        await connectOnce();
                        return;
                    }

                    if (!notReady) return;

                    if (currentStatus === VoiceConnectionStatus.Disconnected) {
                        try { session.connection.destroy(); } catch { /* ignore */ }
                        await connectOnce();
                        return;
                    }

                    attachConnLogsOnce();
                    await waitForReadyWithRecovery(session.connection);
                    return;
                } catch (e) {
                    if (!isAbortErr(e) || i === attempts - 1) throw e;
                    try { if (session.connection) session.connection.destroy(); } catch { /* ignore */ }
                    await sleepMs(500 + i * 750);
                }
            }
        };

        if (needNewConnection) {
            try {
                if (session.connection) session.connection.destroy();
            } catch {
                // ignore
            }
            await ensureVoiceReady();
        } else {
            await ensureVoiceReady();
        }

        session.connection.subscribe(session.player);

        try {
            if (session.ffmpeg) {
                session.ffmpeg.removeAllListeners();
                try { session.ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
                session.ffmpeg = null;
            }
        } catch {
            // ignore
        }

        const startOffsetMs = Math.max(0, Math.floor(Number(session.trackOffsetMs) || 0));
        const startOffsetSec = startOffsetMs ? (startOffsetMs / 1000) : 0;

        const isUrl = isHttpSource(filePath);
        const ffmpegArgs = [
            ...(!isUrl ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
            ...(startOffsetSec ? ['-ss', String(startOffsetSec)] : []),
            '-i', isUrl ? 'pipe:0' : filePath,
            '-vn',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            'pipe:1'
        ];

        // This static ffmpeg can't open HTTPS reliably on this server, but
        // Node's fetch can. Stream the bytes into ffmpeg over stdin instead.
        const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
            stdio: [isUrl ? 'pipe' : 'ignore', 'pipe', 'pipe']
        });
        session.ffmpeg = ffmpeg;

        if (isUrl) {
            (async () => {
                try {
                    const { Readable } = require('stream');
                    const resp = await fetch(filePath);
                    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp && resp.status}`);
                    Readable.fromWeb(resp.body).pipe(ffmpeg.stdin);
                } catch (err) {
                    logError('Music playback - stream fetch failed', err, { guildId: interaction.guild.id });
                    try { ffmpeg.kill('SIGKILL'); } catch { /* ignore */ }
                }
            })();
        }

        ffmpeg.on('error', (e) => logError('Music playback - ffmpeg spawn error', e, { guildId: interaction.guild.id, filePath }));
        ffmpeg.stderr.on('data', (buf) => {
            const msg = String(buf || '').trim();
            if (!msg) return;
            try {
                const m = msg.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
                if (m) {
                    const hh = Number(m[1] || 0);
                    const mm = Number(m[2] || 0);
                    const ss = Number(m[3] || 0);
                    const dur = Math.max(0, Math.floor(((hh * 3600) + (mm * 60) + ss) * 1000));
                    if (dur) session.trackDurationMs = dur;
                }
            } catch { /* ignore */ }
            console.error('ffmpeg:', msg);
        });

        const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw, inlineVolume: true });
        const vol = clampNumber(session.volume, 0, 2);
        try {
            resource.volume.setVolume(vol);
        } catch {
            // ignore
        }
        session.currentResource = resource;
        const extra = {
            ...(isUrl ? { url: filePath, source: 'url' } : {}),
            ...(meta && meta.discBuffer ? { discBuffer: meta.discBuffer } : {})
        };
        session.lastTrack = { filePath, displayName, ...extra };
        session.currentTrack = {
            filePath, displayName, ...extra,
            requestedBy: interaction.user && interaction.user.id ? String(interaction.user.id) : null
        };
        try {
            session.paused = false;
            if (typeof session.trackOffsetMs !== 'number') session.trackOffsetMs = 0;
            session.trackStartedAt = Date.now();
        } catch {
            // ignore
        }
        session.player.play(resource);

        try {
            await entersState(session.player, AudioPlayerStatus.Playing, 5000).catch(() => null);
        } catch { /* ignore */ }

        const idleHandler = async (oldState, newState) => {
            if (newState.status !== AudioPlayerStatus.Idle) return;
            const wasSkip = !!session.__skipRequested;
            session.__skipRequested = false; // consumed only on real Idle transitions
            try {
                if (session.__suppressNextIdle) {
                    session.__suppressNextIdle = false;
                    return;
                }
                if (session.paused) return;

                const repeatMode = session.repeatMode || (session.repeat ? 'one' : 'off');

                // Repeat-one: replay the current track (unless this end came from a manual skip)
                if (repeatMode === 'one' && !wasSkip) {
                    const lastSource = trackSource(session.lastTrack);
                    if (!lastSource) return;
                    await startPlaybackFromFile(makeInternalInteraction(interaction.guild.id, session.currentTrack && session.currentTrack.requestedBy), lastSource, session.lastTrack.displayName || lastSource);
                    return;
                }

                // Repeat-all: cycle the finished track to the back of the queue
                if (repeatMode === 'all' && trackSource(session.lastTrack) && !wasSkip) {
                    session.queue.push({ ...session.lastTrack, requestedBy: session.currentTrack && session.currentTrack.requestedBy });
                }

                if (session.queue && session.queue.length) {
                    await playNextFromQueue(interaction.guild.id);
                    return;
                }

                if (session.autoplayShuffle) {
                    await startAutoplayNext(interaction.guild.id);
                }
            } catch (e) {
                logError('Music playback - idle handler failed', e, { guildId: interaction.guild.id });
            }
        };
        if (!session.__idleHandlerAttached) {
            session.player.on('stateChange', idleHandler);
            session.__idleHandlerAttached = true;
        }

        if (session.__progressInterval) clearInterval(session.__progressInterval);
        session.__progressInterval = setInterval(async () => {
            try {
                const currentStatus = session.player?.state?.status;
                if (currentStatus !== AudioPlayerStatus.Playing) {
                    clearInterval(session.__progressInterval);
                    session.__progressInterval = null;
                    return;
                }
                await refreshPanelSafe(session.__guildId);
            } catch { /* ignore */ }
        }, 5000);
    } catch (e) {
        logError('Music playback - startPlaybackFromFile failed', e, { guildId: interaction.guild.id, filePath });
        try {
            return interaction.followUp({ content: 'صار خطأ وأنا أحاول أشغّل الصوت 3:', flags: MessageFlags.Ephemeral });
        } catch {
            return;
        }
    }
}

function fmtMmSs(ms) {
    const totalSec = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Online playback reuses the local-file pipeline: ffmpeg takes either a path
// or an http(s) stream URL, so only the source representation differs.
async function startPlaybackFromUrl(interaction, url, displayName, meta = {}) {
    return startPlaybackFromFile(interaction, String(url), displayName || String(url), meta);
}

module.exports = {
    startPlaybackFromUrl,
    getOrCreateVoiceSession,
    normalizeTrackTitle,
    buildMusicState,
    getPlaybackProgressMs,
    renderProgressBar,
    pickRandomAudioFile,
    stopGuildPlayback,
    pauseGuildPlayback,
    resumeGuildPlayback,
    seekByMs,
    skipGuildTrack,
    shiftNextQueuedTrack,
    playNextFromQueue,
    startAutoplayNext,
    putPlayBrowseCache,
    getPlayBrowseCache,
    startPlaybackFromFile,
    makeInternalInteraction,
    setPanelRefresher,
    AUDIO_CATEGORIES,
    listCategoryFiles,
    listFolderFiles,
    refreshFolderListing,
    resolveCategoryTrack,
    addToQueue,
    removeFromQueue,
    clearQueue,
    shuffleQueue,
    setRepeatMode,
    cycleRepeatMode,
    setVolumeLevel,
    fmtMmSs,
    voiceSessions
};
