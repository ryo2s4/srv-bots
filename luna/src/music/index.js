const {
    getOrCreateVoiceSession,
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
} = require('./voiceManager');
const { refreshMusicPanelMessage, buildNowPlayingEmbed, getQueueLines, buildPanelRows, buildCategoryBrowseView } = require('./musicUI');

function createMusicAPI(client) {
    // Let the playback engine refresh the panel embed (progress bar etc.)
    setPanelRefresher((guildId) => refreshMusicPanelMessage(guildId, client));

    return {
        __getSession(guildId) {
            return getOrCreateVoiceSession(guildId);
        },
        getState(guildId) {
            const session = getOrCreateVoiceSession(guildId);
            return buildMusicState(session);
        },
        getQueueLines(guildId, limit = 10) {
            return getQueueLines(guildId, limit);
        },
        buildNowPlayingEmbed(guildId) {
            return buildNowPlayingEmbed(guildId);
        },
        buildPanelRows,
        buildMusicPanelRows: buildPanelRows,
        async refreshPanel(guildId) {
            return refreshMusicPanelMessage(guildId, client);
        },
        async skip(guildId) {
            const session = getOrCreateVoiceSession(guildId);
            const playing = !!(session.player && session.player.state && session.player.state.status && session.player.state.status !== 'idle');
            const hasNext = Array.isArray(session.queue) && session.queue.length > 0;
            if (!playing && !hasNext && !session.paused) return { ok: false, error: 'ما فيه شي أتخطاه' };
            await skipGuildTrack(guildId);
            return { ok: true };
        },
        async stop(guildId) {
            const session = getOrCreateVoiceSession(guildId);
            const playing = !!(session.player && session.player.state && session.player.state.status && session.player.state.status !== 'idle');
            const hasNext = Array.isArray(session.queue) && session.queue.length > 0;
            if (!playing && !hasNext && !session.paused) return { ok: false, error: 'ما فيه شي شغال' };
            await stopGuildPlayback(guildId);
            return { ok: true };
        },
        async pause(guildId) {
            return pauseGuildPlayback(guildId);
        },
        async resume(interaction) {
            return resumeGuildPlayback(interaction);
        },
        async seek(guildId, deltaMs) {
            return seekByMs(guildId, deltaMs);
        },
        async play(interaction, filePath, displayName) {
            return startPlaybackFromFile(interaction, filePath, displayName);
        },
        addToQueue(guildId, track) {
            return addToQueue(guildId, track);
        },
        removeFromQueue(guildId, index) {
            return removeFromQueue(guildId, index);
        },
        clearQueue(guildId) {
            return clearQueue(guildId);
        },
        shuffleQueue(guildId) {
            return shuffleQueue(guildId);
        },
        setRepeat(guildId, enabled) {
            return setRepeatMode(guildId, enabled ? 'one' : 'off');
        },
        setRepeatMode(guildId, mode) {
            return setRepeatMode(guildId, mode);
        },
        cycleRepeatMode(guildId) {
            return cycleRepeatMode(guildId);
        },
        setAutoplay(guildId, enabled, userId) {
            const session = getOrCreateVoiceSession(guildId);
            session.autoplayShuffle = !!enabled;
            if (enabled) session.autoplayEnabledBy = userId;
        },
        setVolume(guildId, volume) {
            return setVolumeLevel(guildId, volume);
        },
        setMusicPanel(guildId, channelId, messageId, ownerId) {
            const session = getOrCreateVoiceSession(guildId);
            session.musicPanel = { channelId, messageId, ownerId };
            session.lastPanelOwnerId = ownerId;
        },
        clearMusicPanel(guildId) {
            const session = getOrCreateVoiceSession(guildId);
            session.musicPanel = null;
        },
        // Audio browsing helpers (categories / cached listings)
        categories: AUDIO_CATEGORIES,
        listCategoryFiles,
        refreshFolderListing,
        resolveCategoryTrack
    };
}

module.exports = {
    createMusicAPI,
    voiceSessions,
    getOrCreateVoiceSession,
    startPlaybackFromFile,
    stopGuildPlayback,
    pauseGuildPlayback,
    resumeGuildPlayback,
    skipGuildTrack,
    playNextFromQueue,
    startAutoplayNext,
    getPlayBrowseCache,
    putPlayBrowseCache
};
