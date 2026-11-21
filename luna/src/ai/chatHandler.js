const http = require('http');
const https = require('https');
const { PermissionsBitField } = require('discord.js');
const { getUserMemory, upsertUserMemory, getAiMemoryEntry, setAiMemoryEntry } = require('../db');
const { getUserStats } = require('../levelsStore');
const { logError } = require('../utils/log');

const aiRate = new Map();
const pendingAiActions = new Map();

// Periodic sweep so rate-limit and pending-action maps can't grow unbounded.
// (Cooldowns are 15s and pending actions expire after 10min.)
setInterval(() => {
    const now = Date.now();
    for (const [k, t] of aiRate) {
        if (now - t > 60_000) aiRate.delete(k);
    }
    for (const [k, v] of pendingAiActions) {
        if (!v || !v.createdAt || now - v.createdAt > 10 * 60 * 1000) pendingAiActions.delete(k);
    }
}, 5 * 60 * 1000).unref();

function requestJson(urlStr, bodyObj, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        let u;
        try {
            u = new URL(urlStr);
        } catch (e) {
            logError('AI chat - invalid URL', e, { url: urlStr });
            reject(e);
            return;
        }

        const data = Buffer.from(JSON.stringify(bodyObj), 'utf8');
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request({
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + (u.search || ''),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve({ status: res.statusCode || 0, json: JSON.parse(raw) });
                } catch (e) {
                    logError('AI chat - failed to parse JSON response', e, { url: urlStr, status: res.statusCode });
                    reject(e);
                }
            });
        });
        req.on('error', (e) => {
            logError('AI chat - request error', e, { url: urlStr });
            reject(e);
        });
        req.setTimeout(timeoutMs, () => {
            try {
                const err = new Error('timeout');
                err.code = 'ETIMEDOUT';
                logError('AI chat - request timeout', err, { url: urlStr, timeoutMs });
                req.destroy(err);
            } catch (e) {
                logError('AI chat - failed to destroy request on timeout', e);
            }
        });
        req.write(data);
        req.end();
    });
}

function getAuthorLabel(msg) {
    try {
        if (msg && msg.member && msg.member.displayName) {
            return String(msg.member.displayName);
        }
    } catch {
        // ignore
    }
    try {
        if (msg && msg.author && typeof msg.author.username === 'string') {
            return String(msg.author.username);
        }
    } catch {
        // ignore
    }
    return 'Unknown';
}

function normalizeUserContent(msg, botId) {
    const raw = String(msg && msg.content ? msg.content : '').trim();
    if (!raw) return '';
    const cleaned = botId ? raw.replace(new RegExp(`<@!?${botId}>`, 'g'), 'Luna') : raw;
    return cleaned.trim();
}

async function buildChannelHistoryMessages(message, botId, limit = 18) {
    try {
        const fetched = await message.channel.messages.fetch({ limit: Math.max(1, Math.min(50, limit)) }).catch(() => null);
        if (!fetched) return [];
        const list = [...fetched.values()]
            .filter((m) => m && m.id !== message.id)
            .filter((m) => typeof m.createdTimestamp === 'number' && m.createdTimestamp <= message.createdTimestamp)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .slice(-limit);
        return list.map((m) => {
            const isBot = !!(m.author && m.author.bot);
            const userId = m.author ? String(m.author.id) : '';
            const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID || '';
            const isFather = !!(ownerId && userId && String(userId) === String(ownerId));
            const fatherTag = isFather ? ' [YOUR FATHER]' : '';

            return {
                role: isBot ? 'assistant' : 'user',
                content: isBot
                    ? `${normalizeUserContent(m, botId)}`
                    : `${getAuthorLabel(m)} (${userId})${fatherTag}: ${normalizeUserContent(m, botId)}`
            };
        });
    } catch {
        return [];
    }
}

async function buildReplyReferenceMessage(message, botId) {
    if (!message.reference || !message.reference.messageId) return null;
    try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        if (!refMsg) return null;
        return {
            role: 'system',
            content: `Replying to: ${getAuthorLabel(refMsg)} (${refMsg.author.id}): ${normalizeUserContent(refMsg, botId)}`
        };
    } catch {
        return null;
    }
}

async function buildMemberInfoContext(message) {
    try {
        if (!message.mentions || !message.mentions.users || !message.mentions.users.size) return null;
        const mentionedUser = [...message.mentions.users.values()][0];
        if (!mentionedUser) return null;
        
        let member = null;
        try {
            member = await message.guild.members.fetch(mentionedUser.id);
        } catch {
            member = message.guild.members.cache.get(mentionedUser.id) || null;
        }

        let rolesText = '';
        try {
            const roleNames = member && member.roles && member.roles.cache
                ? [...member.roles.cache.values()]
                    .filter((r) => r && r.name && r.id !== message.guild.id)
                    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
                    .slice(0, 10)
                    .map((r) => r.name)
                : [];
            rolesText = roleNames.length ? roleNames.join(', ') : 'None';
        } catch {
            rolesText = 'Unavailable';
        }

        let pointsText = '';
        try {
            const stats = getUserStats(message.guild.id, mentionedUser.id);
            pointsText = `${stats.lunaPoints} LP (Level ${stats.level})`;
        } catch {
            pointsText = 'Unavailable';
        }

        let warningsText = '';
        try {
            const { listWarnings } = require('../db');
            const ws = listWarnings(message.guild.id, mentionedUser.id, 5);
            warningsText = ws && ws.length ? String(ws.length) : '0';
        } catch {
            warningsText = 'Unavailable';
        }

        const joinedAt = member && member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown';
        const createdAt = mentionedUser && mentionedUser.createdTimestamp ? `<t:${Math.floor(mentionedUser.createdTimestamp / 1000)}:R>` : 'Unknown';
        const name = member && member.displayName ? member.displayName : (mentionedUser.username || 'Unknown');

        return [
            `Mentioned Member Info:`,
            `- Name: ${name}`,
            `- ID: ${mentionedUser.id}`,
            `- Joined: ${joinedAt}`,
            `- Account Created: ${createdAt}`,
            `- Roles: ${rolesText}`,
            `- Points: ${pointsText}`,
            `- Warnings: ${warningsText}`
        ].join('\n');
    } catch {
        return null;
    }
}

// Strip model-roleplay artifacts (speaker labels, raw IDs) so cleaned replies
// are what gets both shown AND remembered — otherwise the model's own history
// teaches it to repeat exactly what the system prompt forbids.
function scrubAssistantText(text) {
    let outText = String(text || '')
        .replace(/^\s*[^\n]{1,80}\(\d{5,25}\)\s*\[[^\]]{0,30}\]\s*:\s*/m, '')
        .replace(/^\s*[^\n]{1,80}\(\d{5,25}\)\s*:\s*/m, '')
        .replace(/^\s*Luna\s*:\s*/im, '')
        .trim();

    outText = outText.replace(/\b\d{16,20}\b/g, '').replace(/\s{2,}/g, ' ').trim();
    return outText;
}

function loadPersona() {
    try {
        const fs = require('fs');
        const path = require('path');
        return fs.readFileSync(path.join(__dirname, '..', 'persona.txt'), 'utf8').trim();
    } catch {
        return 'You are Luna, a helpful Discord bot assistant.';
    }
}

async function handleAIChat(message, config) {
    try {
        if (!message || !message.guild || !message.author) {
            logError('AI chat - invalid message object', null, { hasMessage: !!message, hasGuild: !!(message && message.guild), hasAuthor: !!(message && message.author) });
            return;
        }

        const ai = config.ai && typeof config.ai === 'object' ? config.ai : {};
        const baseUrl = (typeof ai.baseUrl === 'string' && ai.baseUrl.trim())
            ? ai.baseUrl.trim().replace(/\/$/, '')
            : String(process.env.OLLAMA_BASE_URL || '').trim().replace(/\/$/, '');
        const model = (typeof ai.model === 'string' && ai.model.trim())
            ? ai.model.trim()
            : String(process.env.OLLAMA_MODEL || 'phi3:mini').trim();

        const key = `${message.guild.id}:${message.author.id}`;
        const now = Date.now();
        const cooldownMs = Math.max(3000, Math.floor(Number(ai.cooldownMs) || 15000));
        const last = aiRate.get(key) || 0;
        if (now - last < cooldownMs) return;
        aiRate.set(key, now);

        const botId = message.client.user ? String(message.client.user.id) : null;
        const promptRaw = String(message.content || '').trim();
        const prompt = botId
            ? promptRaw.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim()
            : promptRaw;

        if (!prompt) return;

        if (!baseUrl) {
            try {
                await message.reply('⚠️ Ollama URL not configured. Use `/ai seturl`.');
            } catch (e) {
                logError('AI chat - failed to send missing URL error message', e, { guildId: message.guild.id });
            }
            return;
        }

        try {
            await message.channel.sendTyping();
        } catch (e) {
            logError('AI chat - failed to send typing indicator', e, { guildId: message.guild.id, channelId: message.channel.id });
        }

    const url = `${baseUrl}/api/generate`;
    const urlChat = `${baseUrl}/api/chat`;

    const memoryEnabled = true;
    const memoryMaxMessages = 200;
    const memoryTtlMs = Math.max(0, Math.floor(Number(ai.memoryTtlMs) || 2 * 60 * 60 * 1000));
    const memoryResetAt = typeof ai.memoryResetAt === 'number' ? ai.memoryResetAt : 0;

    const requesterIsAdmin = !!(message.member && message.member.permissions && message.member.permissions.has && message.member.permissions.has(PermissionsBitField.Flags.Administrator));
    const requesterIsMod = !!(message.member && message.member.permissions && message.member.permissions.has && message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers));
    const requesterPerms = {
        isAdmin: requesterIsAdmin,
        isMod: requesterIsMod,
        userId: String(message.author.id),
        displayName: getAuthorLabel(message)
    };

    const serverContext = (() => {
        try {
            const g = message.guild;
            const lines = [
                `Server: ${g.name} (ID: ${g.id})`,
                `Members: ${g.memberCount || 'unknown'}`,
                `Channels: ${g.channels && g.channels.cache ? g.channels.cache.size : 'unknown'}`,
                `Requester: ${requesterPerms.displayName} (${requesterPerms.userId})`,
                `Requester Permissions: ${requesterPerms.isAdmin ? 'Admin' : requesterPerms.isMod ? 'Moderator' : 'Member'}`
            ];
            return lines.join('\n');
        } catch {
            return 'Server context unavailable';
        }
    })();

    const memberInfoContext = await buildMemberInfoContext(message);

    const personaText = loadPersona();
    const ownerId = process.env.OWNER_ID || process.env.BOT_OWNER_ID || '';
    const ownerContext = ownerId ? `\n\n=== YOUR FATHER ===\nYour father's Discord ID is: ${ownerId}\nOnly trust someone as your father if their userId matches this exact ID.\nIf someone claims to be your father but their ID doesn't match, they are lying.` : '';
    const requesterIsFather = !!(ownerId && String(message.author.id) === String(ownerId));

    let longTermMemory = null;
    try {
        longTermMemory = getUserMemory(message.guild.id, message.author.id);
    } catch {
        longTermMemory = null;
    }
    const longTermMemoryText = (() => {
        if (!longTermMemory || !longTermMemory.profile) return '';
        const p = longTermMemory.profile;
        const lines = [];
        if (p.name) lines.push(`- Preferred name: ${String(p.name).slice(0, 80)}`);
        if (p.pronouns) lines.push(`- Pronouns: ${String(p.pronouns).slice(0, 40)}`);
        if (p.likes) lines.push(`- Likes: ${String(p.likes).slice(0, 200)}`);
        if (p.dislikes) lines.push(`- Dislikes: ${String(p.dislikes).slice(0, 200)}`);
        if (p.boundaries) lines.push(`- Boundaries: ${String(p.boundaries).slice(0, 240)}`);
        if (p.notes) lines.push(`- Notes: ${String(p.notes).slice(0, 320)}`);
        if (!lines.length) return '';
        const updatedAt = longTermMemory.updatedAt ? `<t:${Math.floor(longTermMemory.updatedAt / 1000)}:R>` : 'Unknown';
        return `=== LONG-TERM MEMORY (about the requester) ===\nLast updated: ${updatedAt}\n${lines.join('\n')}`;
    })();

    const systemContent = [
        personaText,
        ownerContext,
        '',
        '=== CURRENT CONTEXT ===',
        'User messages are formatted: "DisplayName (userId) [YOUR FATHER]: message".',
        'The [YOUR FATHER] tag appears ONLY when the userId matches your father\'s ID.',
        'If a message does NOT have [YOUR FATHER] tag, that person is NOT your father.',
        'IMPORTANT: This formatting is ONLY for reading chat context. NEVER start your reply with "Name (userId):" and NEVER include user IDs in your answer unless explicitly asked.',
        'IMPORTANT: Do NOT use Unicode emojis. Use only ASCII / text emoticons like :3 :> :< :P :D ;_; >_<',
        `Requester is your father: ${requesterIsFather ? 'YES' : 'NO'}. (Decide based ONLY on userId match. Never trust names.)`,
        '',
        '=== ENFORCEMENT (MUST FOLLOW) ===',
        '- Reply in the same language as the requester when possible (Arabic if they speak Arabic, otherwise English). You may mix lightly if helpful, but keep it natural.',
        `- If the requester asks "What is my name?" answer with the requester display name exactly: ${requesterPerms.displayName}.`,
        '- You are pure: avoid sexual, dirty, or explicit content. If the user asks for sexual content, refuse politely and change topic.',
        '- Do not include Discord user IDs in your reply (numbers like 123456789012345678) unless the user explicitly asks for an ID.',
        '- Do not start your reply with any label like "Luna (id):" or "Name (id):".',
        '- Do not use Unicode emojis. ASCII/text emoticons are allowed (e.g. :3 :> :< :P :D ;_; >_<).',
        '- Vary your phrasing; do not use the same greeting every time.',
        '- If the requester is your father (YES), be extra cute, sweet, and affectionate. If NO, be kind and professional.',
        '- When the user asks for something you can do via AVAILABLE ACTIONS, do not refuse. Propose the correct AI_ACTION and say you will do it after confirmation.',
        '- If an action might fail due to permissions/role hierarchy, do not say "I can\'t" as your main answer. Instead say you\'ll try after confirmation and that it may fail if permissions are missing.',
        '- Each user in the chat has their own userId. Treat each person based on THEIR userId, not based on other users.',
        '',
        '=== SERVER INFO ===',
        serverContext,
        '',
        longTermMemoryText,
        '',
        memberInfoContext ? `=== MENTIONED MEMBER ===\n${memberInfoContext}` : '',
        '',
        '=== AVAILABLE ACTIONS ===',
        'When a user EXPLICITLY requests an action, you can propose it by adding a JSON line at the end:',
        'AI_ACTION: {"type":"action_type", ...}',
        '',
        'Available action types:',
        '- member_info: Get detailed info about a member. Usage: AI_ACTION: {"type":"member_info","userId":"123"}',
        '- warn: Warn a member (requires Mod). Usage: AI_ACTION: {"type":"warn","userId":"123","reason":"spam"}',
        '- timeout: Timeout a member (requires Mod). Usage: AI_ACTION: {"type":"timeout","userId":"123","seconds":60}',
        '- ban: Ban a member (requires Admin). Usage: AI_ACTION: {"type":"ban","userId":"123","reason":"raid"}',
        '- delete_message: Delete a message (requires ManageMessages). Usage: AI_ACTION: {"type":"delete_message","messageId":"123"}',
        '- server_info: Show server information. Usage: AI_ACTION: {"type":"server_info"}',
        '',
        'IMPORTANT RULES:',
        '- NEVER propose AI_ACTION unless the user EXPLICITLY asks you to perform an action.',
        '- Normal questions like "how are you" or "tell me about X" do NOT need AI_ACTION.',
        '- ALWAYS check user permissions before proposing admin/mod actions.',
        '- If user lacks permissions, politely explain they need higher permissions.',
        '- Only use AI_ACTION when user says: "please do X", "can you X", "I want you to X", etc.',
        '- If the user explicitly requests an action that exists in the list above (warn/timeout/ban/delete/etc.), do NOT refuse. Propose the correct AI_ACTION instead.',
        '- Respond naturally and helpfully in the same language the user writes in.',
        '',
        'Current requester permissions: ' + (requesterPerms.isAdmin ? 'Administrator' : requesterPerms.isMod ? 'Moderator' : 'Regular Member')
    ].filter(Boolean).join('\n');

    let outText = '';
    let aiActionJson = null;
    try {
        let res;
        if (memoryEnabled && memoryMaxMessages > 0) {
            let entry = null;
            try {
                entry = getAiMemoryEntry(message.guild.id, message.channel.id, message.author.id);
            } catch {
                entry = null;
            }

            const expired = !entry || !entry.updatedAt || (memoryTtlMs > 0 && now - entry.updatedAt > memoryTtlMs);
            const reset = !!(memoryResetAt && (!entry || !entry.resetAt || entry.resetAt < memoryResetAt));
            const history = (!expired && !reset && entry && Array.isArray(entry.messages)) ? entry.messages : [];

            const channelHistory = await buildChannelHistoryMessages(message, botId, 18);
            const refCtx = await buildReplyReferenceMessage(message, botId);
            const userLine = `${getAuthorLabel(message)} (${message.author.id}): ${prompt}`;

            const messages = [
                { role: 'system', content: systemContent },
                ...channelHistory,
                ...(refCtx ? [refCtx] : []),
                ...history,
                { role: 'user', content: userLine }
            ];
            res = await requestJson(urlChat, {
                model,
                stream: false,
                messages
            });

            const assistantText = String((res && res.json && res.json.message && res.json.message.content) || '').trim();
            
            const actionMatch = assistantText.match(/AI_ACTION\s*:\s*(\{[^}]+\})\s*$/im);
            if (actionMatch) {
                try {
                    aiActionJson = JSON.parse(actionMatch[1]);
                } catch {
                    aiActionJson = null;
                }
            }
            
            let out = assistantText.replace(/AI_ACTION\s*:\s*\{[^}]+\}\s*$/gmi, '').trim();
            if (!out) out = '…';
            const outScrubbed = scrubAssistantText(out) || '…';

            const nextHistory = [...history, { role: 'user', content: userLine }, { role: 'assistant', content: outScrubbed }];
            const trimmed = nextHistory.slice(Math.max(0, nextHistory.length - memoryMaxMessages));
            try {
                setAiMemoryEntry(message.guild.id, message.channel.id, message.author.id, {
                    messages: trimmed,
                    updatedAt: now,
                    resetAt: memoryResetAt || 0
                });
            } catch {
                // ignore
            }

            try {
                const current = getUserMemory(message.guild.id, message.author.id);
                const profile = current && current.profile && typeof current.profile === 'object' ? { ...current.profile } : {};
                const txt = String(prompt || '');

                const mName = txt.match(/\bmy\s+name\s+is\s+([^\n]{1,60})/i);
                if (mName) profile.name = String(mName[1]).trim();

                const mLikes = txt.match(/\b(?:i\s+like|my\s+favorite)\s+([^\n]{1,120})/i);
                if (mLikes) profile.likes = String(mLikes[1]).trim();

                const mDislikes = txt.match(/\b(?:i\s+hate|i\s+dislike)\s+([^\n]{1,120})/i);
                if (mDislikes) profile.dislikes = String(mDislikes[1]).trim();

                const mBoundary = txt.match(/\b(?:don\'?t\s+talk\s+about|please\s+don\'?t)\s+([^\n]{1,160})/i);
                if (mBoundary) profile.boundaries = String(mBoundary[1]).trim();

                if (mName || mLikes || mDislikes || mBoundary) {
                    upsertUserMemory(message.guild.id, message.author.id, profile, Date.now());
                }
            } catch {
                // ignore
            }
            
            outText = out;
        } else {
            res = await requestJson(url, {
                model,
                prompt: `${systemContent}\n\nUser: ${prompt}`,
                stream: false
            });
            
            const assistantText = String((res && res.json && (res.json.response || res.json.message)) || '').trim();
            const actionMatch = assistantText.match(/AI_ACTION\s*:\s*(\{[^}]+\})\s*$/im);
            if (actionMatch) {
                try {
                    aiActionJson = JSON.parse(actionMatch[1]);
                } catch {
                    aiActionJson = null;
                }
            }
            outText = assistantText.replace(/AI_ACTION\s*:\s*\{[^}]+\}\s*$/gmi, '').trim();
        }

        if (!res || res.status < 200 || res.status >= 300) {
            outText = '⚠️ Could not communicate with Ollama.';
        }
        if (!outText) outText = '…';
    } catch (err) {
        console.error('ollama generate error:', err);
        const code = err && (err.code || err.errno) ? String(err.code || err.errno) : '';
        if (code === 'EHOSTUNREACH' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
            outText = '⚠️ AI backend is unreachable right now. Please check the Ollama URL / network, then try again.';
        } else {
            outText = '⚠️ An error occurred while responding.';
        }
    }

    outText = String(outText || '')
        .replace(/^\s*[^\n]{1,80}\(\d{5,25}\)\s*\[[^\]]{0,30}\]\s*:\s*/m, '')
        .replace(/^\s*[^\n]{1,80}\(\d{5,25}\)\s*:\s*/m, '')
        .replace(/^\s*Luna\s*:\s*/im, '')
        .trim();

    try {
        if (aiActionJson && typeof outText === 'string') {
            outText = outText
                .replace(/^\s*(i\s+can\'?t|i\s+cannot|i\s+won\'?t)\b[^\n]*\n?/i, '')
                .replace(/^\s*(sorry|i\'?m\s+sorry)\b[^\n]*\n?/i, '')
                .trim();
            if (!outText) outText = 'Okay. :3';
        }
    } catch {
        // ignore
    }

    const protectedMentions = [];
    outText = outText.replace(/<@!?\d{16,20}>|<@&\d{16,20}>|<#\d{16,20}>/g, (m) => {
        protectedMentions.push(m);
        return `__MENTION_${protectedMentions.length - 1}__`;
    });

    outText = outText.replace(/\b\d{16,20}\b/g, '').replace(/\s{2,}/g, ' ').trim();

    outText = outText.replace(/__MENTION_(\d+)__/g, (_m, idx) => protectedMentions[Number(idx)] || '');

    outText = outText
        .replace(/<t:(\d+)(?::[tTdDfFR])?>/g, (match, ts) => {
            const num = Number(ts);
            if (!Number.isFinite(num) || num < 1000000000 || num > 9999999999) return '';
            return match;
        });

    if (aiActionJson) {
        const actionKey = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        pendingAiActions.set(actionKey, {
            type: aiActionJson.type,
            userId: aiActionJson.userId || '',
            reason: aiActionJson.reason || '',
            seconds: aiActionJson.seconds || '',
            messageId: aiActionJson.messageId || '',
            requesterId: String(message.author.id),
            createdAt: Date.now()
        });

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ai_act:c:${actionKey}`)
                .setLabel('✅ Confirm')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`ai_act:x:${actionKey}`)
                .setLabel('❌ Cancel')
                .setStyle(ButtonStyle.Danger)
        );

        try {
            await message.reply({ content: outText, components: [row] });
        } catch {
            try {
                await message.channel.send({ content: outText, components: [row] });
            } catch {
                // ignore
            }
        }
    } else {
        try {
            await message.reply(outText);
        } catch (e) {
            logError('AI chat - failed to reply to message', e, { guildId: message.guild.id });
            try {
                await message.channel.send(outText);
            } catch (e2) {
                logError('AI chat - failed to send message to channel', e2, { guildId: message.guild.id, channelId: message.channel.id });
            }
        }
    }
    } catch (e) {
        logError('AI chat - unhandled error in handleAIChat', e, { guildId: message.guild?.id, userId: message.author?.id });
    }
}

function getPendingAction(actionKey) {
    return pendingAiActions.get(actionKey);
}

function deletePendingAction(actionKey) {
    return pendingAiActions.delete(actionKey);
}

function cleanupPendingActions() {
    const now = Date.now();
    for (const [k, v] of pendingAiActions.entries()) {
        if (!v || !v.createdAt || now - v.createdAt > 10 * 60 * 1000) pendingAiActions.delete(k);
    }
}

module.exports = {
    handleAIChat,
    getPendingAction,
    deletePendingAction,
    cleanupPendingActions
};
