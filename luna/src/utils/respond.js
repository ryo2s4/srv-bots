const { MessageFlags } = require('discord.js');

function stripExtraEmojisFromText(text, maxEmoji = 1) {
    const s = String(text || '');
    if (!s) return s;

    let count = 0;
    const re = /<a?:\w{2,}:\d{5,}>|\p{Extended_Pictographic}/gu;
    return s.replace(re, (m) => {
        count += 1;
        if (count > maxEmoji) return '';
        return m;
    });
}

function sanitizeDiscordPayload(payload, opts = {}) {
    if (!payload || typeof payload !== 'object') return payload;
    const maxEmoji = Number.isFinite(Number(opts.maxEmoji)) ? Number(opts.maxEmoji) : 1;

    const next = { ...payload };
    if (typeof next.content === 'string') {
        next.content = stripExtraEmojisFromText(next.content, maxEmoji);
    }

    if (Array.isArray(next.embeds)) {
        next.embeds = next.embeds.map((e) => {
            if (!e || typeof e !== 'object') return e;
            if (typeof e.toJSON === 'function') return e;
            const ee = { ...e };
            if (typeof ee.title === 'string') ee.title = stripExtraEmojisFromText(ee.title, maxEmoji);
            if (typeof ee.description === 'string') ee.description = stripExtraEmojisFromText(ee.description, maxEmoji);
            if (ee.author && typeof ee.author === 'object') {
                const a = { ...ee.author };
                if (typeof a.name === 'string') a.name = stripExtraEmojisFromText(a.name, maxEmoji);
                ee.author = a;
            }
            if (ee.footer && typeof ee.footer === 'object') {
                const f = { ...ee.footer };
                if (typeof f.text === 'string') f.text = stripExtraEmojisFromText(f.text, maxEmoji);
                ee.footer = f;
            }
            if (Array.isArray(ee.fields)) {
                ee.fields = ee.fields.map((fld) => {
                    if (!fld || typeof fld !== 'object') return fld;
                    const ff = { ...fld };
                    if (typeof ff.name === 'string') ff.name = stripExtraEmojisFromText(ff.name, maxEmoji);
                    if (typeof ff.value === 'string') ff.value = stripExtraEmojisFromText(ff.value, maxEmoji);
                    return ff;
                });
            }
            return ee;
        });
    }

    if (Array.isArray(next.components)) {
        next.components = next.components.map((row) => {
            if (!row || typeof row !== 'object') return row;
            if (typeof row.toJSON === 'function') return row;
            if (!Array.isArray(row.components)) return row;
            const rr = { ...row };
            rr.components = row.components.map((c) => {
                if (!c || typeof c !== 'object') return c;
                if (typeof c.toJSON === 'function') return c;
                const cc = { ...c };
                if (typeof cc.label === 'string') cc.label = stripExtraEmojisFromText(cc.label, maxEmoji);
                if (typeof cc.placeholder === 'string') cc.placeholder = stripExtraEmojisFromText(cc.placeholder, maxEmoji);
                return cc;
            });
            return rr;
        });
    }

    return next;
}

function withEphemeral(payload) {
    if (!payload || typeof payload !== 'object') return { flags: MessageFlags.Ephemeral };
    if ('flags' in payload) return payload;
    if ('ephemeral' in payload) {
        if (payload.ephemeral) {
            const { ephemeral, ...rest } = payload;
            return { ...rest, flags: MessageFlags.Ephemeral };
        }
        const { ephemeral, ...rest } = payload;
        return rest;
    }
    return { ...payload, flags: MessageFlags.Ephemeral };
}

async function replyEphemeral(interaction, payload) {
    try {
        if (interaction && (interaction.deferred || interaction.replied)) {
            return await interaction.followUp(withEphemeral(sanitizeDiscordPayload(payload)));
        }
    } catch {
        // ignore
    }
    try {
        return await interaction.reply(withEphemeral(sanitizeDiscordPayload(payload)));
    } catch {
        return null;
    }
}

async function editReplySafe(interaction, payload) {
    try {
        if (interaction && (interaction.deferred || interaction.replied)) {
            return await interaction.editReply(sanitizeDiscordPayload(payload));
        }
    } catch {
        // ignore
    }
    return null;
}

async function deferUpdateSafe(interaction) {
    try {
        return await interaction.deferUpdate();
    } catch {
        return null;
    }
}

module.exports = { replyEphemeral, editReplySafe, deferUpdateSafe, sanitizeDiscordPayload }; 
