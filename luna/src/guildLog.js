const { getGuildConfig } = require('./guildConfig');

const guildLogQueues = new Map();
const guildLogQueueTimers = new Map();

async function sendGuildLog(guild, payload, opts = {}) {
    try {
        if (!guild) return;
        const cfg = getGuildConfig(guild.id);

        if (cfg && cfg.logs && typeof cfg.logs === 'object' && cfg.logs.enabled === false) return;
        const category = opts && typeof opts.category === 'string' ? opts.category : null;
        if (category && cfg && cfg.logs && typeof cfg.logs === 'object' && cfg.logs.categories && typeof cfg.logs.categories === 'object') {
            if (cfg.logs.categories[category] === false) return;
        }

        const chId = cfg && typeof cfg.logsChannelId === 'string' ? cfg.logsChannelId : null;
        if (!chId) return;

        const excludeId = cfg && typeof cfg.logsExcludeChannelId === 'string' ? cfg.logsExcludeChannelId : null;
        let sourceChannelId = opts && typeof opts.sourceChannelId === 'string' ? opts.sourceChannelId : null;
        if (!sourceChannelId) {
            const embeds = payload && Array.isArray(payload.embeds) ? payload.embeds : [];
            const desc = embeds[0] && embeds[0].data && typeof embeds[0].data.description === 'string' ? embeds[0].data.description : '';
            const m = desc.match(/<#(\d{5,})>/);
            if (m) sourceChannelId = m[1];
        }
        if (excludeId && sourceChannelId && String(excludeId) === String(sourceChannelId)) return;

        const ch = await guild.channels.fetch(chId).catch(() => null);
        if (!ch || !ch.isTextBased || !ch.isTextBased()) return;

        const hasFiles = payload && payload.files && Array.isArray(payload.files) && payload.files.length > 0;
        const embeds = payload && Array.isArray(payload.embeds) ? payload.embeds : [];
        const content = payload && typeof payload.content === 'string' ? payload.content : null;

        const canBatch = !hasFiles && !content && embeds.length > 0;
        if (!canBatch) {
            await ch.send(payload);
            return;
        }

        const key = `${guild.id}:${ch.id}`;
        const q = guildLogQueues.get(key) || [];
        q.push(...embeds);
        guildLogQueues.set(key, q);

        if (!guildLogQueueTimers.has(key)) {
            const t = setTimeout(async () => {
                guildLogQueueTimers.delete(key);
                const queued = guildLogQueues.get(key) || [];
                guildLogQueues.delete(key);
                if (!queued.length) return;
                const chunks = [];
                let cur = [];
                for (const e of queued) {
                    cur.push(e);
                    if (cur.length >= 10) {
                        chunks.push(cur);
                        cur = [];
                    }
                }
                if (cur.length) chunks.push(cur);
                for (const chunk of chunks) {
                    try {
                        await ch.send({ embeds: chunk });
                    } catch {
                    }
                }
            }, 2500);
            guildLogQueueTimers.set(key, t);
        }
    } catch {
    }
}

module.exports = { sendGuildLog };
