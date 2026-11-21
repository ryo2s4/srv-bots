const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'monitors.json');

let cache = null;
// Set when the on-disk file could not be parsed; the next write must back the
// corrupted file up instead of silently overwriting it with an empty list.
let corruptOnDisk = false;

function ensureDir() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function backupCorruptFile() {
    if (!fs.existsSync(dataFile)) {
        corruptOnDisk = false;
        return true;
    }
    const backupPath = `${dataFile}.corrupt-${Date.now()}`;
    try {
        fs.copyFileSync(dataFile, backupPath);
        console.error(`[monitorStore] Backed up corrupted ${dataFile} to ${backupPath}`);
        corruptOnDisk = false;
        return true;
    } catch (err) {
        console.error(`[monitorStore] Failed to back up corrupted ${dataFile}:`, err);
        return false;
    }
}

function readMonitors() {
    ensureDir();
    if (!fs.existsSync(dataFile)) {
        cache = [];
        return cache;
    }
    try {
        const raw = fs.readFileSync(dataFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            console.error(`[monitorStore] ${dataFile} does not contain a JSON array; refusing to trust it, keeping it for backup on next write`);
            corruptOnDisk = true;
            cache = [];
            return cache;
        }
        // Filter valid entries
        cache = parsed.filter((m) =>
            m && typeof m === 'object' &&
            typeof m.sourceGuildId === 'string' &&
            typeof m.sourceChannelId === 'string' &&
            typeof m.targetChannelId === 'string'
        );
        return cache;
    } catch (err) {
        console.error(`[monitorStore] Failed to parse ${dataFile}; keeping it for backup on next write:`, err);
        corruptOnDisk = true;
        cache = [];
        return cache;
    }
}

function writeMonitors(monitors) {
    ensureDir();
    cache = monitors.filter((m) =>
        m && typeof m === 'object' &&
        typeof m.sourceGuildId === 'string' &&
        typeof m.sourceChannelId === 'string' &&
        typeof m.targetChannelId === 'string'
    );
    if (corruptOnDisk && !backupCorruptFile()) {
        // Never overwrite the corrupted file if we could not preserve it first.
        throw new Error(`[monitorStore] Refusing to overwrite unparseable ${dataFile} without a backup`);
    }
    // Atomic write: temp file + rename so a crash never leaves a half-written file.
    const tmpFile = `${dataFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmpFile, dataFile);
}

function getMonitors() {
    if (cache !== null) return cache;
    return readMonitors();
}

function addMonitor(sourceGuildId, sourceChannelId, targetChannelId) {
    const monitors = getMonitors();
    // Check if this exact source channel already has a monitor
    const existing = monitors.findIndex((m) => m.sourceChannelId === sourceChannelId && m.sourceGuildId === sourceGuildId);
    if (existing !== -1) {
        // Update target
        monitors[existing].targetChannelId = targetChannelId;
    } else {
        monitors.push({
            sourceGuildId: String(sourceGuildId),
            sourceChannelId: String(sourceChannelId),
            targetChannelId: String(targetChannelId),
            createdAt: Date.now()
        });
    }
    writeMonitors(monitors);
}

function removeMonitor(index) {
    const monitors = getMonitors();
    if (index >= 0 && index < monitors.length) {
        monitors.splice(index, 1);
        writeMonitors(monitors);
        return true;
    }
    return false;
}

function removeMonitorBySource(sourceChannelId, sourceGuildId) {
    const monitors = getMonitors();
    const idx = monitors.findIndex((m) =>
        m.sourceChannelId === sourceChannelId &&
        m.sourceGuildId === sourceGuildId
    );
    if (idx !== -1) {
        monitors.splice(idx, 1);
        writeMonitors(monitors);
        return true;
    }
    return false;
}

module.exports = {
    getMonitors,
    addMonitor,
    removeMonitor,
    removeMonitorBySource
};
