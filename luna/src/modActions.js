// نواة أوامر الإشراف الموحدة 🛡️
// كل أمر (حظر/طرد/تايم آوت/تحذير) يمر من هنا: فحص الصلاحيات + التنفيذ +
// التسجيل بسجل العقوبات الموحّد (ثريد + رتب تحذير + باند تلقائي) + إشعار العضو.

const { ActionRowBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const UI = require('./utils/ui');

const TYPE_META = {
    ban: { label: 'حظر', icon: '🔨' },
    kick: { label: 'طرد', icon: '👢' },
    timeout: { label: 'تايم آوت', icon: '🔇' },
    untimeout: { label: 'إزالة التايم آوت', icon: '🔊' },
    warn: { label: 'تحذير', icon: '⚠️' }
};

function typeLabel(type) {
    const m = TYPE_META[type];
    return m ? `${m.icon} ${m.label}` : String(type || 'عقوبة');
}

// مدد: 30s / 10m / 2h / 3d — و "0" أو "remove" لإزالة التايم آوت
function parseDurationSpec(input) {
    const raw = String(input || '').trim().toLowerCase();
    if (['0', 'remove', 'off', 'none', 'ازالة', 'إزالة'].includes(raw)) {
        return { ok: true, ms: 0, remove: true, reason: '' };
    }
    const m = raw.match(/^([0-9]+)\s*(s|m|h|d)$/);
    if (!m) return { ok: false, ms: 0, remove: false, reason: 'صيغة المدة غير صحيحة. مثال: 30s أو 10m أو 2h أو 3d (واكتب 0 لإزالة التايم آوت)' };
    const n = Math.floor(Number(m[1]) || 0);
    if (!n || n < 1) return { ok: false, ms: 0, remove: false, reason: 'المدة لازم تكون رقم أكبر من 0' };
    const mult = m[2] === 's' ? 1000 : m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
    const ms = n * mult;
    const maxMs = 28 * 24 * 60 * 60 * 1000;
    if (ms > maxMs) return { ok: false, ms: 0, remove: false, reason: 'أقصى تايم آوت هو 28 يوم' };
    return { ok: true, ms, remove: false, reason: '' };
}

// فحصات قبل التنفيذ — ترجع { ok } أو { ok:false, error }
function preflight({ guild, moderator, targetMember, targetUser, action }) {
    if (!guild) return { ok: false, error: 'هالأمر يشتغل بالسيرفر بس 3:' };
    if (!moderator) return { ok: false, error: 'ما قدرت أحدد من ينفذ الأمر 3:' };
    if (!targetUser) return { ok: false, error: 'ما قدرت ألاقي هالعضو 3:' };
    if (String(targetUser.id) === String(moderator.id)) return { ok: false, error: 'ما تقدر تطبق هالإجراء على نفسك 3:' };
    if (String(targetUser.id) === String(guild.ownerId)) return { ok: false, error: 'ما أقدر على مالك السيرفر 🫣' };

    if (targetMember) {
        // تسلسل الرتب: الهدف لازم يكون تحت المُنفّذ (إلا مالك السيرفر)
        const modIsOwner = String(moderator.id) === String(guild.ownerId);
        if (!modIsOwner) {
            const modRoles = moderator.roles && moderator.roles.highest ? moderator.roles.highest : null;
            const targetRoles = targetMember.roles && targetMember.roles.highest ? targetMember.roles.highest : null;
            if (modRoles && targetRoles && targetRoles.comparePositionTo(modRoles) >= 0) {
                return { ok: false, error: 'رتبة العضو أعلى منك (أو مساوية) — ما تقدر تطبق عليه 3:' };
            }
        }

        if (action === 'ban' && targetMember.bannable === false) {
            return { ok: false, error: 'ما أقدر أحظره… رتبته/صلاحياته أعلى مني >:' };
        }
        if (action === 'kick' && targetMember.kickable === false) {
            return { ok: false, error: 'ما أقدر أطرده… رتبته/صلاحياته أعلى مني >:' };
        }
        if ((action === 'timeout' || action === 'untimeout') && targetMember.moderatable === false) {
            return { ok: false, error: 'ما أقدر أعطيه تايم آوت… رتبته/صلاحياته أعلى مني >:' };
        }
    }

    return { ok: true };
}

// تسجيل موحّد في سجل العقوبات (ثريد + لوق + رتب تحذير + باند تلقائي)
async function recordPunishment({ guild, moderator, targetUser, type, reason, durationMinutes = 0 }) {
    const punishLog = require('./punishLog');
    const out = { caseId: null, count: 0, didAutoBan: false, recorded: false };

    let config;
    try {
        config = punishLog.getPunishConfig(guild.id);
    } catch {
        return out;
    }
    if (!config || !config.enabled) return out;

    try {
        const thread = await punishLog.getOrCreateUserThread(guild, targetUser.id);
        const caseId = punishLog.addPunishment(
            guild.id,
            targetUser.id,
            moderator.id,
            type,
            reason || 'بدون سبب',
            Math.max(0, Math.floor(durationMinutes || 0)),
            thread ? thread.id : null
        );

        const embed = punishLog.buildPunishEmbed({
            id: caseId,
            user_id: targetUser.id,
            moderator_id: moderator.id,
            type,
            reason: reason || 'بدون سبب',
            duration_minutes: Math.max(0, Math.floor(durationMinutes || 0)),
            created_at: Date.now()
        }, guild);

        if (thread) await thread.send({ embeds: [embed] }).catch(() => null);

        if (config.logChannelId) {
            const logChannel = guild.channels.cache.get(config.logChannelId) ||
                await guild.channels.fetch(config.logChannelId).catch(() => null);
            if (logChannel && logChannel.isTextBased()) {
                await logChannel.send({ embeds: [embed] }).catch(() => null);
            }
        }

        const count = punishLog.getPunishmentCount(guild.id, targetUser.id);
        await punishLog.applyWarningRole(guild, targetUser.id, count);
        const didAutoBan = await punishLog.checkAndAutoBan(guild, targetUser.id);

        out.caseId = caseId;
        out.count = count;
        out.didAutoBan = !!didAutoBan;
        out.recorded = true;
    } catch {
        // ما نفشل الأمر كله إذا فشل التسجيل
    }
    return out;
}

// مسح سجل العضو (العقوبات + رتب التحذير + التحذيرات القديمة)
async function clearUserRecord(guild, targetUser) {
    const punishLog = require('./punishLog');
    const summary = { punishments: 0, legacy: 0, rolesRemoved: 0 };

    try {
        const db = punishLog.getDb();
        const r1 = db.prepare('DELETE FROM punishments WHERE guild_id = ? AND user_id = ?').run(String(guild.id), String(targetUser.id));
        summary.punishments = r1.changes || 0;
        db.prepare('DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ?').run(String(guild.id), String(targetUser.id));
    } catch {
    }

    try {
        const { clearWarnings, listWarnings } = require('./db');
        const legacy = listWarnings(guild.id, targetUser.id, 500);
        summary.legacy = legacy.length;
        if (legacy.length) clearWarnings(guild.id, targetUser.id);
    } catch {
    }

    try {
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        const config = punishLog.getPunishConfig(guild.id);
        if (member && config && Array.isArray(config.warningRoles)) {
            for (const wr of config.warningRoles) {
                if (wr && wr.roleId && member.roles.cache.has(wr.roleId)) {
                    await member.roles.remove(wr.roleId, 'تم مسح سجل العقوبات').catch(() => null);
                    summary.rolesRemoved++;
                }
            }
        }
    } catch {
    }

    return summary;
}

function dmMessage({ guild, type, reason, durationMs }) {
    const label = typeLabel(type);
    const lines = [
        `**${guild.name}** — ${label}`,
        `السبب: **${reason || 'بدون سبب'}**`
    ];
    if (type === 'timeout' && durationMs) lines.push(`المدة: **${UI.fmtDuration(durationMs)}**`);
    if (type === 'warn') lines.push('انتبه، التحذيرات المتكررة توصل لرتب تحذير وحتى باند 😅');
    return lines.join('\n');
}

function buildResultEmbed({ type, targetUser, moderator, reason, durationMs, deleteDays, record }) {
    const fields = [
        { name: '👤 العضو', value: `${targetUser} (\`${targetUser.id}\`)`, inline: true },
        { name: '🛡️ المُنفّذ', value: `${moderator}`, inline: true },
        { name: '📄 السبب', value: String(reason || 'بدون سبب').slice(0, 1000), inline: false }
    ];
    if (type === 'timeout' && durationMs) fields.push({ name: '⏳ المدة', value: UI.fmtDuration(durationMs), inline: true });
    if (type === 'ban' && deleteDays) fields.push({ name: '🗑️ حذف الرسائل', value: `${deleteDays} يوم`, inline: true });
    if (record && record.recorded) {
        fields.push({ name: '🧾 رقم القضية', value: `#${record.caseId}`, inline: true });
        fields.push({ name: '📊 عدد العقوبات', value: UI.fmtNum(record.count), inline: true });
    }

    const desc = record && record.didAutoBan
        ? `${typeLabel(type)} تم تطبيقه ✅\n\n🔨 **تم حظر العضو تلقائيًا لتجاوز حد التحذيرات!**`
        : `${typeLabel(type)} تم تطبيقه ✅`;

    return UI.embed({
        title: `🛡️ ${TYPE_META[type] ? TYPE_META[type].label : 'إجراء إداري'}`,
        description: desc,
        color: UI.COLORS.mod,
        fields
    });
}

// ===== تأكيد الحظر =====
const PENDING_BANS = new Map(); // `${ownerId}:${targetId}` -> { ... }
const PENDING_TTL_MS = 3 * 60 * 1000;

function sweepPending() {
    const now = Date.now();
    for (const [k, v] of PENDING_BANS) {
        if (!v || now > v.expiresAt) PENDING_BANS.delete(k);
    }
}

function buildBanConfirmEmbed({ guild, moderator, targetUser, reason, deleteDays, targetMember }) {
    const fields = [
        { name: '👤 سيتم حظر', value: `${targetUser} (\`${targetUser.id}\`)`, inline: true },
        { name: '🛡️ بواسطة', value: `${moderator}`, inline: true },
        { name: '📄 السبب', value: String(reason || 'بدون سبب').slice(0, 1000), inline: false },
        { name: '🗑️ حذف الرسائل', value: `${deleteDays || 0} يوم`, inline: true }
    ];
    if (targetMember) fields.push({ name: '🎖️ أعلى رتبة', value: targetMember.roles && targetMember.roles.highest ? `${targetMember.roles.highest}` : '—', inline: true });

    return UI.embed({
        title: '🔨 تأكيد الحظر',
        description: 'متأكد تبي تـ**حظر** هالعضو؟ الإجراء فوري ⚡',
        color: UI.COLORS.danger,
        fields
    });
}

function buildBanConfirmRows(ownerId, targetId) {
    return [UI.row(
        UI.btn(`modact:ok:${ownerId}:${targetId}`, 'تأكيد الحظر', { style: ButtonStyle.Danger, emoji: '🔨' }),
        UI.btn(`modact:no:${ownerId}`, 'إلغاء', { style: ButtonStyle.Secondary, emoji: '✖️' })
    )];
}

// تنفيذ إجراء كامل (أمر + تسجيل + إشعار)
async function executePunishment({ client, guild, moderator, targetUser, targetMember, type, reason, durationMs = 0, deleteDays = 0, silent = false }) {
    const cleanReason = String(reason || 'بدون سبب').slice(0, 1000);

    if (type === 'ban') {
        await guild.members.ban(targetUser.id, {
            deleteMessageSeconds: Math.max(0, Math.floor((deleteDays || 0) * 86400)),
            reason: `${cleanReason} — بواسطة ${moderator.user ? moderator.user.tag : moderator.tag}`
        });
    } else if (type === 'kick') {
        await targetMember.kick(`${cleanReason} — بواسطة ${moderator.user ? moderator.user.tag : moderator.tag}`);
    } else if (type === 'timeout') {
        await targetMember.timeout(durationMs, cleanReason);
    } else if (type === 'untimeout') {
        await targetMember.timeout(null, cleanReason);
    }
    // warn: ما فيه إجراء جانبي — التسجيل والإشعار فقط

    const record = await recordPunishment({
        guild,
        moderator: moderator.user ? moderator.user : moderator,
        targetUser,
        type,
        reason: cleanReason,
        durationMinutes: type === 'timeout' ? Math.round(durationMs / 60000) : 0
    });

    if (!silent) {
        try {
            await targetUser.send({ embeds: [UI.embed({
                title: `${typeLabel(type)} — ${guild.name}`,
                description: dmMessage({ guild, type, reason: cleanReason, durationMs }),
                color: UI.COLORS.mod
            })] });
        } catch {
            // العضو مقفل الدي إم
        }
    }

    try {
        const { sendGuildLog } = require('./guildLog');
        await sendGuildLog(guild, {
            embeds: [UI.embed({
                title: `${typeLabel(type)} ${record.recorded ? `#${record.caseId}` : ''}`,
                description: `**العضو:** ${targetUser} (\`${targetUser.id}\`)\n**المُنفّذ:** ${moderator.user ? moderator.user : moderator}\n**السبب:** ${cleanReason}`,
                color: UI.COLORS.mod
            })]
        }, { category: 'moderation' });
    } catch {
    }

    return record;
}

// ===== معالجة أزرار التأكيد =====
async function handle({ client, interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('modact:'))) return false;

    sweepPending();
    const parts = interaction.customId.split(':');
    const action = parts[1] || '';

    const reply = async (payload) => {
        try {
            return await interaction.reply({ ...payload, ephemeral: true });
        } catch {
            return;
        }
    };

    if (action === 'no') {
        const ownerId = parts[2] || '';
        if (ownerId && String(interaction.user.id) !== String(ownerId)) {
            return reply({ content: 'هالتأكيد مو لك 3:' });
        }
        for (const k of [...PENDING_BANS.keys()]) {
            if (k.startsWith(`${ownerId}:`)) PENDING_BANS.delete(k);
        }
        try {
            return await interaction.update({ embeds: [UI.warn('تم إلغاء الحظر ✅', { title: '✖️ أُلغي' })], components: [] });
        } catch {
            return reply({ content: '✅ تم الإلغاء.' });
        }
    }

    if (action === 'hist') {
        const targetId = parts[3] || '';
        try {
            const punishLog = require('./punishLog');
            const embed = punishLog.buildUserHistoryEmbed(interaction.guild.id, targetId, interaction.guild);
            return await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch {
            return reply({ content: 'آسف بس ما قدرت أجيب السجل 3:' });
        }
    }

    if (action === 'ok') {
        const ownerId = parts[2] || '';
        const targetId = parts[3] || '';
        if (ownerId && String(interaction.user.id) !== String(ownerId)) {
            return reply({ content: 'هالتأكيد مو لك 3:' });
        }
        const pending = PENDING_BANS.get(`${ownerId}:${targetId}`);
        if (!pending) {
            try {
                return await interaction.update({ embeds: [UI.warn('انتهت صلاحية التأكيد — استخدم /ban مرة ثانية.', { title: '⏳ انتهت المهلة' })], components: [] });
            } catch {
                return reply({ content: '⏳ انتهت صلاحية التأكيد — استخدم /ban مرة ثانية.' });
            }
        }
        PENDING_BANS.delete(`${ownerId}:${targetId}`);

        const guild = client.guilds.cache.get(pending.guildId) || interaction.guild;
        if (!guild) return reply({ content: 'ما قدرت ألاقي السيرفر 3:' });

        const moderator = await guild.members.fetch(ownerId).catch(() => null);
        const targetUser = await client.users.fetch(targetId).catch(() => null);
        if (!moderator || !targetUser) return reply({ content: 'صار خطأ وأنا أجهز الحظر 3:' });

        const targetMember = await guild.members.fetch(targetId).catch(() => null);
        const check = preflight({ guild, moderator, targetMember, targetUser, action: 'ban' });
        if (!check.ok) {
            try {
                return await interaction.update({ embeds: [UI.error(check.error)], components: [] });
            } catch {
                return reply({ content: check.error });
            }
        }

        try {
            const record = await executePunishment({
                client, guild, moderator, targetUser, targetMember,
                type: 'ban',
                reason: pending.reason,
                deleteDays: pending.deleteDays,
                silent: pending.silent
            });
            const embed = buildResultEmbed({
                type: 'ban', targetUser, moderator: moderator.user,
                reason: pending.reason, deleteDays: pending.deleteDays, record
            });
            try {
                return await interaction.update({ embeds: [embed], components: [] });
            } catch {
                return reply({ embeds: [embed] });
            }
        } catch (err) {
            try {
                return await interaction.update({ embeds: [UI.error(`صار خلل وأنا أحظر: ${String(err && err.message ? err.message : err).slice(0, 200)}`)], components: [] });
            } catch {
                return reply({ content: 'صار خلل وأنا أحظر 3:' });
            }
        }
    }

    return false;
}

module.exports = {
    TYPE_META,
    typeLabel,
    parseDurationSpec,
    preflight,
    recordPunishment,
    clearUserRecord,
    executePunishment,
    buildResultEmbed,
    buildBanConfirmEmbed,
    buildBanConfirmRows,
    PENDING_BANS,
    handle
};
