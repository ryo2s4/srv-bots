// Welcome / leave message helpers — shared by /welcome and the guild events.
const { EmbedBuilder } = require('discord.js');

const DEFAULT_TITLE = 'أهلاً بك في السيرفر! 🌙';
const DEFAULT_MESSAGE = 'مرحباً {mention} 👋\nنورت السيرفر! اقرأ القوانين واستمتع بوقتك ✨';
const DEFAULT_LEAVE_TITLE = 'ودّعنا السيرفر 👋';
const DEFAULT_LEAVE_MESSAGE = 'ودّعنا {user} 🌙\nكان وجودك شرف، بالتوفيق دايمًا ✨';

function formatWelcome(text, { member = null, guild = null, count = 0, noMention = false } = {}) {
    const user = member && member.user ? member.user : (member && member.id ? member : null);
    const username = user ? String(user.username || 'عضو') : 'عضو';
    const tag = user && typeof user.tag === 'string' ? user.tag : username;
    const mention = noMention || !user || !user.id ? '' : `<@${user.id}>`;
    const guildName = guild ? String(guild.name || 'السيرفر') : 'السيرفر';
    const memberCount = Number(count) || (guild && Number(guild.memberCount)) || 0;

    return String(text == null ? '' : text)
        .replace(/\{mention\}/gi, mention)
        .replace(/\{user\}/gi, tag)
        .replace(/\{username\}/gi, username)
        .replace(/\{server\}/gi, guildName)
        .replace(/\{count\}/gi, String(memberCount));
}

function buildWelcomePayload(cfg, { member = null, guild = null, count = 0, forcePing = false } = {}, kind = 'welcome') {
    const isLeave = kind === 'leave';
    const ctx = { member, guild, count, noMention: isLeave };
    const titleTemplate = isLeave
        ? (cfg && cfg.leaveTitle ? cfg.leaveTitle : DEFAULT_LEAVE_TITLE)
        : (cfg && cfg.title ? cfg.title : DEFAULT_TITLE);
    const messageTemplate = isLeave
        ? (cfg && cfg.leaveMessage ? cfg.leaveMessage : DEFAULT_LEAVE_MESSAGE)
        : (cfg && cfg.message ? cfg.message : DEFAULT_MESSAGE);
    const imageUrl = isLeave
        ? (cfg && typeof cfg.leaveImageUrl === 'string' ? cfg.leaveImageUrl : null)
        : (cfg && typeof cfg.imageUrl === 'string' ? cfg.imageUrl : null);

    const title = formatWelcome(titleTemplate, ctx).slice(0, 256) || (isLeave ? DEFAULT_LEAVE_TITLE : DEFAULT_TITLE);
    let text = formatWelcome(messageTemplate, ctx);
    if (!text.trim()) text = isLeave ? DEFAULT_LEAVE_MESSAGE : DEFAULT_MESSAGE;
    text = text.slice(0, 4000);

    const shouldPing = !isLeave && (forcePing || !!(cfg && cfg.ping));
    const pingId = shouldPing && member && member.user && member.user.id ? String(member.user.id) : '';
    const ping = pingId ? `<@${pingId}>` : '';
    const allowedMentions = pingId ? { parse: [], users: [pingId] } : { parse: [] };

    if (cfg && cfg.embed === false) {
        return { content: (ping ? `${ping} ` : '') + text, allowedMentions };
    }

    const embed = new EmbedBuilder()
        .setColor(isLeave ? '#E85B5B' : '#E7D3B0')
        .setTitle(title)
        .setDescription(text)
        .setTimestamp();
    if (member && member.user && typeof member.user.displayAvatarURL === 'function') {
        embed.setThumbnail(member.user.displayAvatarURL({ size: 128 }));
    }
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
        embed.setImage(imageUrl.slice(0, 2000));
    }
    embed.setFooter({ text: count ? `🌙 لونا • الآن ${count} عضو` : '🌙 لونا' });

    const payload = { embeds: [embed], allowedMentions };
    if (ping) payload.content = ping;
    return payload;
}

module.exports = {
    DEFAULT_TITLE, DEFAULT_MESSAGE, DEFAULT_LEAVE_TITLE, DEFAULT_LEAVE_MESSAGE,
    formatWelcome, buildWelcomePayload
};
