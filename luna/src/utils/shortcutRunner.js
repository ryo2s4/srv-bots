const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// Commands that must never be reachable through text shortcuts.
const EXCLUDED_COMMANDS = new Set(['owner']);

// Legacy shortcut names mapped to real slash commands.
const COMMAND_ALIASES = {
    balance: 'profile'
};

// Optional emoji per command in the picker (cosmetic only).
const COMMAND_EMOJIS = {
    ping: '🏓', help: '❓', mechanics: '📖', user: '👤', avatar: '🖼️', serverinfo: '🏠',
    profile: '🪪', level: '📈', leaderboard: '🏆', topshop: '🛍️', inventory: '🎒', use: '✨',
    shop: '🛒', daily: '🎁', gift: '🎁', boosts: '⚡', runes: '🔮', lootboxes: '📦',
    timeout: '⏱️', kick: '🦶', ban: '🔨', warn: '⚠️', warnings: '📋', warnings_clear: '🧽',
    clear: '🧹', automod: '🛡️', aimod: '🤖', security: '🔐', punishlog: '🗃️', adminreport: '📊',
    logs: '📜', tickets: '🎫', events: '🎉', levelrewards: '🎖️', togglelevels: '🎚️', backup: '💾',
    setupcheck: '✅', adminui: '🧰', shopadminui: '🏪', ai: '🧠', specialchannels: '📢',
    suggestions: '💡', reactionrole: '🔘', shortcuts: '⚡', whispers: '🤫', autoreact: '😀',
    replies: '↩️', forum: '📰', music: '🎵', joinvc: '🔊',
    '8ball': '🎱', roll: '🎲', coinflip: '🪙', poll: '📊'
};

const SELECT_PAGE_SIZE = 25;

const OPTION_TYPE = {
    SUB_COMMAND: 1,
    SUB_COMMAND_GROUP: 2,
    STRING: 3,
    INTEGER: 4,
    BOOLEAN: 5,
    USER: 6,
    CHANNEL: 7,
    ROLE: 8,
    MENTIONABLE: 9,
    NUMBER: 10,
    ATTACHMENT: 11
};

/**
 * Scan every command loaded on the client and return the shortcut catalog.
 * Keeps itself in sync with src/commands automatically.
 */
function listShortcutCommands(client) {
    const cmds = client && client.commands;
    if (!cmds) return [];
    const out = [];
    for (const [name, cmd] of cmds.entries()) {
        if (!cmd || !cmd.data || EXCLUDED_COMMANDS.has(name)) continue;
        const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : {};
        const description = String(json.description || 'أمر').slice(0, 100);
        const entry = { name, label: name, description };
        if (COMMAND_EMOJIS[name]) entry.emoji = COMMAND_EMOJIS[name];
        out.push(entry);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

/**
 * Build the picker rows for one page of the full command catalog.
 * Returns ActionRows: a select menu (max 25 options) plus prev/next buttons.
 */
function buildShortcutCommandRows(client, page = 0) {
    const commands = listShortcutCommands(client);
    const totalPages = Math.max(1, Math.ceil(commands.length / SELECT_PAGE_SIZE));
    const p = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
    const slice = commands.slice(p * SELECT_PAGE_SIZE, (p + 1) * SELECT_PAGE_SIZE);

    const select = new StringSelectMenuBuilder()
        .setCustomId(`shortcuts:selectcmd:${p}`)
        .setPlaceholder(totalPages > 1 ? `اختر الأمر (صفحة ${p + 1} من ${totalPages})` : 'اختر الأمر المراد إنشاء اختصار له')
        .addOptions(slice.map((c) => {
            const opt = { label: c.label, value: c.name };
            if (c.description) opt.description = c.description;
            if (c.emoji) opt.emoji = c.emoji;
            return opt;
        }));

    const rows = [new ActionRowBuilder().addComponents(select)];

    if (totalPages > 1) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`shortcuts:page:${p - 1}`)
                .setLabel('السابق')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('◀️')
                .setDisabled(p <= 0),
            new ButtonBuilder()
                .setCustomId(`shortcuts:page:${p + 1}`)
                .setLabel('التالي')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('▶️')
                .setDisabled(p >= totalPages - 1)
        ));
    }

    return rows;
}

function tokenizeArgs(text) {
    const tokens = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        tokens.push(m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3]));
    }
    return tokens;
}

function resolveSubcommand(commandJson, tokens) {
    let options = Array.isArray(commandJson.options) ? commandJson.options : [];
    let subcommand = null;

    while (options.length && (options[0].type === OPTION_TYPE.SUB_COMMAND || options[0].type === OPTION_TYPE.SUB_COMMAND_GROUP)) {
        const wanted = String(tokens[0] || '').toLowerCase();
        let chosen = options.find((o) => String(o.name).toLowerCase() === wanted);
        if (chosen) {
            tokens.shift();
        } else {
            chosen = options[0];
        }
        if (chosen.type === OPTION_TYPE.SUB_COMMAND) {
            subcommand = chosen.name;
        }
        options = Array.isArray(chosen.options) ? chosen.options : [];
    }

    return { options, subcommand };
}

function takeToken(tokens, test) {
    for (let i = 0; i < tokens.length; i++) {
        if (test(tokens[i])) return tokens.splice(i, 1)[0];
    }
    return null;
}

const TOKEN_PATTERNS = {
    mentionUser: /^<@!?(\d+)>$/,
    mentionRole: /^<@&(\d+)>$/,
    mentionChannel: /^<#(\d+)>$/,
    snowflake: /^\d{15,20}$/,
    integer: /^-?\d+$/,
    number: /^-?\d+(?:\.\d+)?$/,
    boolean: /^(true|false|yes|no|on|off|نعم|لا)$/i
};

/**
 * Parse free text args into the declared slash-command options.
 * Mentions/IDs are matched positionally per option type; a trailing string
 * option swallows the remaining text.
 */
function parseCommandArgs(commandJson, argsText, message) {
    const tokens = tokenizeArgs(argsText);
    const { options, subcommand } = resolveSubcommand(commandJson, tokens);

    // Fill required options first, then optional ones (declaration order).
    const ordered = [
        ...options.filter((o) => o.required),
        ...options.filter((o) => !o.required)
    ];

    const values = {};

    for (const opt of ordered) {
        const name = opt.name;
        switch (opt.type) {
            case OPTION_TYPE.USER:
            case OPTION_TYPE.MENTIONABLE: {
                const raw = takeToken(tokens, (t) =>
                    TOKEN_PATTERNS.mentionUser.test(t) ||
                    TOKEN_PATTERNS.mentionRole.test(t) ||
                    TOKEN_PATTERNS.snowflake.test(t));
                if (!raw) break;
                const idMatch = raw.match(/(\d{15,20})/);
                values[name] = { name, type: opt.type, id: idMatch ? idMatch[1] : null, value: idMatch ? idMatch[1] : null };
                break;
            }
            case OPTION_TYPE.CHANNEL: {
                const raw = takeToken(tokens, (t) => TOKEN_PATTERNS.mentionChannel.test(t) || TOKEN_PATTERNS.snowflake.test(t));
                if (!raw) break;
                const idMatch = raw.match(/(\d{15,20})/);
                values[name] = { name, type: opt.type, id: idMatch ? idMatch[1] : null, value: idMatch ? idMatch[1] : null };
                break;
            }
            case OPTION_TYPE.ROLE: {
                const raw = takeToken(tokens, (t) => TOKEN_PATTERNS.mentionRole.test(t) || TOKEN_PATTERNS.snowflake.test(t));
                if (!raw) break;
                const idMatch = raw.match(/(\d{15,20})/);
                values[name] = { name, type: opt.type, id: idMatch ? idMatch[1] : null, value: idMatch ? idMatch[1] : null };
                break;
            }
            case OPTION_TYPE.INTEGER: {
                const raw = takeToken(tokens, (t) => TOKEN_PATTERNS.integer.test(t));
                if (raw == null) break;
                values[name] = { name, type: opt.type, value: parseInt(raw, 10) };
                break;
            }
            case OPTION_TYPE.NUMBER: {
                const raw = takeToken(tokens, (t) => TOKEN_PATTERNS.number.test(t));
                if (raw == null) break;
                values[name] = { name, type: opt.type, value: parseFloat(raw) };
                break;
            }
            case OPTION_TYPE.BOOLEAN: {
                const raw = takeToken(tokens, (t) => TOKEN_PATTERNS.boolean.test(t));
                if (raw == null) break;
                const v = raw.toLowerCase();
                values[name] = { name, type: opt.type, value: v === 'true' || v === 'yes' || v === 'on' || v === 'نعم' };
                break;
            }
            case OPTION_TYPE.ATTACHMENT: {
                const att = message && message.attachments ? message.attachments.first() : null;
                if (att) values[name] = { name, type: opt.type, value: att.url, attachment: att };
                break;
            }
            case OPTION_TYPE.STRING:
            default: {
                if (tokens.length === 0) break;
                // Last remaining string option takes the whole rest of the line.
                const restIsAllForThis = ordered.indexOf(opt) === ordered.length - 1 || ordered.slice(ordered.indexOf(opt) + 1).every((o) => o.type === OPTION_TYPE.ATTACHMENT);
                const raw = restIsAllForThis ? tokens.splice(0, tokens.length).join(' ') : tokens.shift();
                if (!raw) break;
                values[name] = { name, type: opt.type, value: raw };
                break;
            }
        }
    }

    return { values, subcommand };
}

function sanitizePayload(payload) {
    if (payload == null) return { content: '✅' };
    if (typeof payload === 'string') return { content: payload || '✅' };
    const p = { ...payload };
    delete p.flags;
    delete p.ephemeral;
    delete p.fetchReply;
    if (!p.content && !(Array.isArray(p.embeds) && p.embeds.length) && !(Array.isArray(p.components) && p.components.length) && !p.files) {
        p.content = '✅';
    }
    return p;
}

/**
 * Build an interaction-like shim so any slash command's execute() can run
 * against a plain message (used by text shortcuts).
 */
function buildShimInteraction({ client, message, commandName, values, subcommand }) {
    const state = { replied: false, deferred: false, lastMessage: null };

    const shim = {
        id: message.id,
        applicationId: client && client.user ? client.user.id : '',
        client,
        guild: message.guild,
        channel: message.channel,
        channelId: message.channel.id,
        user: message.author,
        member: message.member,
        memberPermissions: message.member ? message.member.permissions : null,
        commandName,
        customId: null,
        createdTimestamp: message.createdTimestamp,
        replied: false,
        deferred: false,

        isChatInputCommand: () => true,
        isCommand: () => true,
        isContextMenuCommand: () => false,
        isButton: () => false,
        isMessageComponent: () => false,
        isAnySelectMenu: () => false,
        isStringSelectMenu: () => false,
        isRoleSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isMentionableSelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        isRepliable: () => true,
        inGuild: () => true,
        isDMBased: () => false,

        options: {
            get: (name) => values[name] || null,
            getString: (name) => {
                const v = values[name];
                return v && v.value != null ? String(v.value) : null;
            },
            getUser: (name) => {
                const v = values[name];
                return (v && (v.user || (v.member && v.member.user))) || null;
            },
            getMember: (name) => {
                const v = values[name];
                return (v && v.member) || null;
            },
            getChannel: (name) => {
                const v = values[name];
                return (v && v.channel) || null;
            },
            getRole: (name) => {
                const v = values[name];
                return (v && v.role) || null;
            },
            getInteger: (name) => {
                const v = values[name];
                return v && v.value != null ? Math.trunc(Number(v.value)) : null;
            },
            getNumber: (name) => {
                const v = values[name];
                return v && v.value != null ? Number(v.value) : null;
            },
            getBoolean: (name) => {
                const v = values[name];
                return v && typeof v.value === 'boolean' ? v.value : null;
            },
            getAttachment: (name) => {
                const v = values[name];
                return (v && v.attachment) || null;
            },
            getSubcommand: (required = true) => {
                if (subcommand) return subcommand;
                if (required) throw new Error('No subcommand provided');
                return null;
            },
            getFocused: () => ''
        },

        async deferReply() {
            state.deferred = true;
            shim.deferred = true;
            if (message.channel && typeof message.channel.sendTyping === 'function') {
                await message.channel.sendTyping().catch(() => {});
            }
            return shim;
        },

        async reply(payload) {
            state.replied = true;
            shim.replied = true;
            const p = sanitizePayload(payload);
            let sent = null;
            try {
                sent = await message.reply(p);
            } catch {
                sent = await message.channel.send(p).catch(() => null);
            }
            state.lastMessage = sent;
            return sent;
        },

        async editReply(payload) {
            const p = sanitizePayload(payload);
            if (state.lastMessage) {
                return state.lastMessage.edit(p).catch(() => message.channel.send(p).catch(() => null));
            }
            return shim.reply(p);
        },

        async followUp(payload) {
            return message.channel.send(sanitizePayload(payload)).catch(() => null);
        },

        async deleteReply() {
            if (state.lastMessage) {
                await state.lastMessage.delete().catch(() => {});
            }
            state.lastMessage = null;
        },

        async showModal() {
            await message.reply('⚠️ هاد الأمر يحتاج نافذة تفاعلية وما ينفع يننفذ من اختصار نصي، استخدم الأمر كـ slash command 3:').catch(() => {});
            state.replied = true;
            shim.replied = true;
            return shim;
        },

        async update(payload) {
            return shim.reply(payload);
        }
    };

    return shim;
}

function missingRequiredUsage(options, values) {
    const missing = options.filter((o) => o.required && !values[o.name]);
    if (missing.length === 0) return null;
    return '❌ الاختصار يحتاج معطيات ناقصة: ' + missing.map((o) => `\`${o.name}\``).join(' ');
}

/**
 * Run a registered slash command from a text shortcut.
 * Returns true when the shortcut matched a command (regardless of success).
 */
async function runShortcutCommand(client, message, commandName, argsText) {
    const resolvedName = COMMAND_ALIASES[commandName] || commandName;
    const cmd = client && client.commands ? client.commands.get(resolvedName) : null;
    if (!cmd || typeof cmd.execute !== 'function') return false;

    const json = cmd.data && typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : {};

    // Respect the command's default member permissions.
    const defaultPerms = json.default_member_permissions;
    if (defaultPerms != null && message.member) {
        try {
            const needed = BigInt(defaultPerms);
            if (needed !== 0n && !message.member.permissions.has(needed)) {
                await message.reply('اسفة بس ما معك صلاحية تستخدم هالاختصار 3:').catch(() => {});
                return true;
            }
        } catch {
            // ignore unparsable permission bitfields
        }
    }

    const { values, subcommand } = parseCommandArgs(json, argsText, message);

    // Resolve referenced users/members/channels/roles up front (async).
    for (const v of Object.values(values)) {
        if (!v.id) continue;
        if (v.type === OPTION_TYPE.USER || v.type === OPTION_TYPE.MENTIONABLE) {
            v.user = (message.mentions && message.mentions.users && message.mentions.users.get(v.id))
                || client.users.cache.get(v.id)
                || await client.users.fetch(v.id).catch(() => null);
            if (!v.user && message.guild) {
                const member = await message.guild.members.fetch(v.id).catch(() => null);
                if (member) {
                    v.member = member;
                    v.user = member.user;
                }
            }
            if (!v.user && v.type === OPTION_TYPE.MENTIONABLE) {
                v.role = (message.mentions && message.mentions.roles && message.mentions.roles.get(v.id))
                    || (message.guild ? message.guild.roles.cache.get(v.id) : null)
                    || (message.guild ? await message.guild.roles.fetch(v.id).catch(() => null) : null);
            }
            if (v.user && message.guild && !v.member) {
                v.member = await message.guild.members.fetch(v.id).catch(() => null);
            }
        } else if (v.type === OPTION_TYPE.CHANNEL) {
            v.channel = (message.mentions && message.mentions.channels && message.mentions.channels.get(v.id))
                || (message.guild ? message.guild.channels.cache.get(v.id) : null)
                || (message.guild ? await message.guild.channels.fetch(v.id).catch(() => null) : null);
        } else if (v.type === OPTION_TYPE.ROLE) {
            v.role = (message.mentions && message.mentions.roles && message.mentions.roles.get(v.id))
                || (message.guild ? message.guild.roles.cache.get(v.id) : null)
                || (message.guild ? await message.guild.roles.fetch(v.id).catch(() => null) : null);
        }
    }

    const usage = missingRequiredUsage(
        (function finalOptions() {
            let options = Array.isArray(json.options) ? json.options : [];
            while (options.length && (options[0].type === OPTION_TYPE.SUB_COMMAND || options[0].type === OPTION_TYPE.SUB_COMMAND_GROUP)) {
                const wanted = String(subcommand || '').toLowerCase();
                let chosen = options.find((o) => String(o.name).toLowerCase() === wanted) || options[0];
                if (chosen.type === OPTION_TYPE.SUB_COMMAND_GROUP) {
                    chosen = (Array.isArray(chosen.options) ? chosen.options : [])[0] || chosen;
                }
                options = Array.isArray(chosen.options) ? chosen.options : [];
            }
            return options;
        })(),
        values
    );
    if (usage) {
        await message.reply(usage).catch(() => {});
        return true;
    }

    const shim = buildShimInteraction({ client, message, commandName: resolvedName, values, subcommand });

    try {
        await cmd.execute(shim);
    } catch (err) {
        console.error(`Shortcut command error (${resolvedName}):`, err);
        await message.reply('صار خطأ وأنا أنفذ الاختصار 3:').catch(() => {});
    }
    return true;
}

module.exports = {
    listShortcutCommands,
    buildShortcutCommandRows,
    runShortcutCommand
};
