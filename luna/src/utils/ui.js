// نظام تصميم لونا 🌙 — المصدر الوحيد للألوان والهوية البصرية
// استخدم هذي الـ helpers بكل الإمبادات عشان يصير الشكل موحد.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const COLORS = {
    // الهوية الأساسية
    primary: '#E7D3B0',   // رملي دافئ (اللون الأساسي)
    ink: '#2B2D42',       // ليل عميق
    night: '#2C2C54',     // نيلي
    gold: '#D9B26F',      // ذهبي

    // حالات
    success: '#57F287',
    danger: '#ED4245',
    warn: '#FEE75C',
    info: '#5865F2',
    muted: '#808080',

    // أقسام
    shop: '#D9B26F',
    economy: '#D9B26F',
    levels: '#7BC67E',
    events: '#B28DDE',
    tickets: '#5865F2',
    mod: '#E85B5B',
    logs: '#9AA0B4',
    music: '#9C6B3F',
    profile: '#E7D3B0',
    help: '#E7D3B0',
    docs: '#B28DDE'
};

const EMOJI = {
    success: '✅',
    error: '❌',
    warn: '⚠️',
    info: '💡',
    points: '🌙',
    xp: '✨',
    level: '🎖️',
    time: '⏳',
    shop: '🛒',
    music: '🎧',
    ticket: '🎫',
    shield: '🛡️'
};

// 🌙 لونا • نص
function footer(text, iconURL) {
    const f = { text: text ? `🌙 لونا • ${text}` : '🌙 لونا' };
    if (iconURL) f.iconURL = iconURL;
    return f;
}

// إمبد موحد: لون + فوتر + تايمستامب افتراضيًا
function embed({ title, description, color = COLORS.primary, footerText = null, timestamp = true, fields = [], thumbnail = null, image = null, author = null } = {}) {
    const e = new EmbedBuilder().setColor(color);
    if (title) e.setTitle(title);
    if (description) e.setDescription(description);
    if (fields && fields.length) e.addFields(fields.slice(0, 25));
    if (thumbnail) e.setThumbnail(thumbnail);
    if (image) e.setImage(image);
    if (author) e.setAuthor(author);
    e.setFooter(footer(footerText));
    if (timestamp) e.setTimestamp();
    return e;
}

function success(description, { title = `${EMOJI.success} تم!`, footerText = null, fields = [] } = {}) {
    return embed({ title, description, color: COLORS.success, footerText, fields });
}

function error(description, { title = `${EMOJI.error} صار خلل!`, footerText = null, fields = [] } = {}) {
    return embed({ title, description, color: COLORS.danger, footerText, fields });
}

function warn(description, { title = `${EMOJI.warn} تنبيه`, footerText = null, fields = [] } = {}) {
    return embed({ title, description, color: COLORS.warn, footerText, fields });
}

function info(description, { title = `${EMOJI.info} معلومة`, footerText = null, fields = [] } = {}) {
    return embed({ title, description, color: COLORS.info, footerText, fields });
}

// شريط تقدم: ▰▰▰▰▱▱▱
function progressBar(current, max, width = 12) {
    const w = Math.max(4, Math.min(24, Math.floor(Number(width) || 12)));
    const maxV = Number(max) > 0 ? Number(max) : 1;
    const cur = Math.max(0, Math.min(maxV, Number(current) || 0));
    const filled = Math.round((cur / maxV) * w);
    return '▰'.repeat(filled) + '▱'.repeat(w - filled);
}

// أرقام مفصولة بفواصل: 12,345
function fmtNum(n) {
    const x = Math.floor(Number(n) || 0);
    return x.toLocaleString('en-US');
}

// مدة عربية مختصرة: 1س 20د 5ث
function fmtDuration(ms) {
    let s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    const parts = [];
    if (d) parts.push(`${d}ي`);
    if (h) parts.push(`${h}س`);
    if (m) parts.push(`${m}د`);
    if (s || !parts.length) parts.push(`${s}ث`);
    return parts.join(' ');
}

// وقت نسبي ديسكورد
function fmtRelative(ts) {
    const t = Math.floor((Number(ts) || Date.now()) / 1000);
    return `<t:${t}:R>`;
}

// MM:SS
function fmtMmSs(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// زر موحد
function btn(customId, label, { style = ButtonStyle.Secondary, emoji = null, disabled = false, url = null } = {}) {
    const b = new ButtonBuilder();
    if (url) b.setURL(url);
    else b.setCustomId(customId);
    if (label) b.setLabel(label);
    if (emoji) b.setEmoji(emoji);
    b.setStyle(url ? ButtonStyle.Link : style);
    if (disabled) b.setDisabled(true);
    return b;
}

// صف أزرار
function row(...buttons) {
    return new ActionRowBuilder().addComponents(...buttons);
}

// زر نهاية معطّل (للفعاليات/الألعاب)
function disabledEndRow(customId = 'ui:ended', label = 'انتهت') {
    return row(btn(customId, label, { disabled: true }));
}

// تقسيم لأجزاء (للصفحات)
function chunk(arr, size) {
    const out = [];
    const s = Math.max(1, Math.floor(Number(size) || 10));
    for (let i = 0; i < (arr || []).length; i += s) out.push(arr.slice(i, i + s));
    return out.length ? out : [[]];
}

module.exports = {
    COLORS,
    EMOJI,
    footer,
    embed,
    success,
    error,
    warn,
    info,
    progressBar,
    fmtNum,
    fmtDuration,
    fmtRelative,
    fmtMmSs,
    btn,
    row,
    disabledEndRow,
    chunk
};
