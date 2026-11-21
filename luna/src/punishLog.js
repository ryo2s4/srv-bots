const { getGuildConfig, updateGuildConfig } = require('./guildConfig');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'data', 'punish_log.db');

const userThreadLocks = new Map();

let dbInstance = null;

function getDb() {
    if (dbInstance) return dbInstance;
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS punishments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            type TEXT NOT NULL,
            reason TEXT DEFAULT '',
            duration_minutes INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            post_id TEXT DEFAULT NULL,
            thread_id TEXT DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_punishments_guild_user ON punishments(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_punishments_guild_created ON punishments(guild_id, created_at);
        
        CREATE TABLE IF NOT EXISTS user_threads (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY(guild_id, user_id)
        );
        
        CREATE TABLE IF NOT EXISTS temp_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            removed INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_temp_roles_guild_user ON temp_roles(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_temp_roles_expires ON temp_roles(expires_at, removed);
    `);
    dbInstance = db;
    return db;
}

function getPunishConfig(guildId) {
    const cfg = getGuildConfig(guildId);
    const p = cfg.punishLog && typeof cfg.punishLog === 'object' ? cfg.punishLog : {};
    
    // warningRoles can be array of strings (old format) or array of objects (new format)
    let warningRoles = Array.isArray(p.warningRoles) ? p.warningRoles : [];
    // Convert old format (array of IDs) to new format
    if (warningRoles.length > 0 && typeof warningRoles[0] === 'string') {
        warningRoles = warningRoles.map(roleId => ({ roleId, durationMs: 0 }));
    }
    
    return {
        enabled: p.enabled === true,
        forumChannelId: typeof p.forumChannelId === 'string' ? p.forumChannelId : null,
        warningRoles,
        maxWarnings: Number.isFinite(Number(p.maxWarnings)) ? Math.max(0, Math.floor(Number(p.maxWarnings))) : 3,
        autoBanEnabled: p.autoBanEnabled === true,
        banReason: typeof p.banReason === 'string' && p.banReason.trim() ? p.banReason.trim() : 'تجاوز حد التحذيرات',
        logChannelId: typeof p.logChannelId === 'string' ? p.logChannelId : null
    };
}

async function getOrCreateUserThread(guild, userId) {
    const lockKey = `${guild.id}:${userId}`;
    const existingLock = userThreadLocks.get(lockKey);
    if (existingLock) return existingLock;

    const lockPromise = (async () => {
        const db = getDb();
        const existing = db.prepare('SELECT thread_id FROM user_threads WHERE guild_id = ? AND user_id = ?')
            .get(String(guild.id), String(userId));
        if (existing && existing.thread_id) {
            const thread = await guild.channels.fetch(existing.thread_id).catch(() => null);
            if (thread) return thread;

            db.prepare('DELETE FROM user_threads WHERE guild_id = ? AND user_id = ?')
                .run(String(guild.id), String(userId));
        }

        const config = getPunishConfig(guild.id);
        if (!config.forumChannelId) return null;

        const forumChannel = await guild.channels.fetch(config.forumChannelId).catch(() => null);
        if (!forumChannel || !forumChannel.isThreadOnly()) return null;

        const member = await guild.members.fetch(userId).catch(() => null);
        const userName = member ? member.user.username : userId;

        const thread = await forumChannel.threads.create({
            name: `📋 ${userName} (${userId})`,
            message: { content: `**سجل عقوبات العضو:** <@${userId}>\n**تاريخ الإنشاء:** <t:${Math.floor(Date.now() / 1000)}:F>` },
            reason: `سجل عقوبات لـ ${userName}`
        });

        db.prepare('INSERT OR REPLACE INTO user_threads (guild_id, user_id, thread_id, created_at) VALUES (?, ?, ?, ?)')
            .run(String(guild.id), String(userId), String(thread.id), Date.now());

        return thread;
    })();

    userThreadLocks.set(lockKey, lockPromise);
    try {
        return await lockPromise;
    } finally {
        userThreadLocks.delete(lockKey);
    }
}

function addPunishment(guildId, userId, moderatorId, type, reason, durationMinutes = 0, threadId = null) {
    const db = getDb();
    const result = db.prepare(`
        INSERT INTO punishments (guild_id, user_id, moderator_id, type, reason, duration_minutes, created_at, thread_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(guildId), String(userId), String(moderatorId), type, reason || '', durationMinutes, Date.now(), threadId);

    // كل عقوبة تتسجل بالمخالفات الموحدة (data/bot.sqlite) — case_ref = رقم العقوبة هنا.
    // الفشل هنا ما يفشل التسجيل الأصلي.
    try {
        const infractionStore = require('./stores/infractionStore');
        infractionStore.addInfraction({
            guildId: String(guildId),
            userId: String(userId),
            moderatorId: String(moderatorId),
            type,
            reason: reason || '',
            durationMinutes: Math.max(0, Math.floor(Number(durationMinutes) || 0)),
            caseRef: Number(result.lastInsertRowid) || null
        });
    } catch (err) {
        console.warn('punishLog: failed to mirror infraction:', err && err.message ? err.message : err);
    }

    return result.lastInsertRowid;
}

function getUserPunishments(guildId, userId) {
    const db = getDb();
    return db.prepare('SELECT * FROM punishments WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC').all(String(guildId), String(userId));
}

function getPunishmentCount(guildId, userId) {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId));
    return row ? row.count : 0;
}

async function applyWarningRole(guild, userId, count) {
    const config = getPunishConfig(guild.id);
    if (!config.warningRoles.length) return false;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    // Apply warning role based on count (index 0 = 1st warning, index 1 = 2nd, etc.)
    const roleIndex = Math.min(count - 1, config.warningRoles.length - 1);
    const warningRole = config.warningRoles[roleIndex];
    
    if (!warningRole || !warningRole.roleId) return false;
    
    await member.roles.add(warningRole.roleId, 'تحذير من العقوبات').catch(() => null);
    
    // If role has duration, schedule removal
    if (warningRole.durationMs && warningRole.durationMs > 0) {
        const db = getDb();
        const expiresAt = Date.now() + warningRole.durationMs;
        db.prepare(`
            INSERT INTO temp_roles (guild_id, user_id, role_id, added_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(String(guild.id), String(userId), String(warningRole.roleId), Date.now(), expiresAt);
    }

    return true;
}

async function removeExpiredRoles(client) {
    const db = getDb();
    const now = Date.now();
    const expired = db.prepare(`
        SELECT id, guild_id, user_id, role_id FROM temp_roles 
        WHERE expires_at <= ? AND removed = 0
    `).all(now);
    
    for (const row of expired) {
        const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id).catch(() => null);
        if (!guild) continue;

        let removedOk = true;
        const member = await guild.members.fetch(row.user_id).catch(() => null);
        if (member) {
            try {
                await member.roles.remove(row.role_id, 'انتهت مدة التحذير');
            } catch {
                removedOk = false; // ما انحذفت الرتبة (تسلسل/صلاحيات) — نجرب بعدين
            }
        }
        
        // Send notification to user's thread
        const thread = await getOrCreateUserThread(guild, row.user_id).catch(() => null);
        if (thread) {
            const { EmbedBuilder } = require('discord.js');
            const role = guild.roles.cache.get(row.role_id);
            const roleName = role ? role.name : row.role_id;
            
            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('⏰ انتهت مدة التحذير')
                .setDescription(
                    `تم إزالة رتبة التحذير **${roleName}** من العضو تلقائياً\n` +
                    `لأنتهاء المدة المحددة`
                )
                .addFields(
                    { name: '👤 العضو', value: `<@${row.user_id}>`, inline: true },
                    { name: '🏷️ الرتبة', value: role ? `<@&${row.role_id}>` : row.role_id, inline: true },
                    { name: '📅 تاريخ الإزالة', value: `<t:${Math.floor(now / 1000)}:F>`, inline: false }
                )
                .setTimestamp();
            
            await thread.send({ embeds: [embed] }).catch(() => null);
        }
        
        // نعلّمها منزالة بس إذا تمت الإزالة فعلاً (أو العضو مو موجود أصلًا)
        if (removedOk) {
            db.prepare('UPDATE temp_roles SET removed = 1 WHERE id = ?').run(row.id);
        }
    }
    
    return expired.length;
}

function startTempRoleChecker(client) {
    // Check every 30 seconds
    setInterval(() => {
        removeExpiredRoles(client).catch(() => null);
    }, 30_000);
    
    // Also check on startup
    removeExpiredRoles(client).catch(() => null);
}

async function checkAndAutoBan(guild, userId) {
    const config = getPunishConfig(guild.id);
    if (!config.autoBanEnabled || config.maxWarnings <= 0) return false;

    const count = getPunishmentCount(guild.id, userId);
    if (count >= config.maxWarnings) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && member.bannable) {
            await member.ban({ reason: config.banReason });
            return true;
        }
    }
    return false;
}

// UI Builders
function buildConfigEmbed(guildId, guild) {
    const config = getPunishConfig(guildId);
    
    const forumChannel = config.forumChannelId ? guild.channels.cache.get(config.forumChannelId) : null;
    const logChannel = config.logChannelId ? guild.channels.cache.get(config.logChannelId) : null;
    
    const warningRolesText = config.warningRoles.length > 0
        ? config.warningRoles.map((wr, i) => {
            const durationText = wr.durationMs > 0 
                ? ` (${formatDuration(wr.durationMs)})` 
                : ' (دائم)';
            return `التحذير ${i + 1}: <@&${wr.roleId}>${durationText}`;
        }).join('\n')
        : 'غير محدد';

    return new EmbedBuilder()
        .setColor('#E7D3B0')
        .setTitle('⚖️ نظام سجل العقوبات')
        .setDescription('نظام متقدم لتسجيل العقوبات وإدارة التحذيرات')
        .addFields(
            { name: '📊 الحالة', value: config.enabled ? '✅ مفعّل' : '❌ معطّل', inline: true },
            { name: '📝 روم السجلات', value: forumChannel ? `<#${forumChannel.id}>` : 'غير محدد', inline: true },
            { name: '📢 روم اللوق', value: logChannel ? `<#${logChannel.id}>` : 'غير محدد', inline: true },
            { name: '⚠️ رتب التحذير', value: warningRolesText, inline: false },
            { name: '🔢 الحد الأقصى', value: `${config.maxWarnings} عقوبات`, inline: true },
            { name: '🔨 الباند التلقائي', value: config.autoBanEnabled ? '✅ مفعّل' : '❌ معطّل', inline: true }
        )
        .setTimestamp();
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return 'دائم';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} يوم`;
    if (hours > 0) return `${hours} ساعة`;
    if (minutes > 0) return `${minutes} دقيقة`;
    return `${totalSeconds} ثانية`;
}

function parseDuration(input) {
    const str = String(input || '').trim().toLowerCase();
    if (!str || str === '0' || str === 'دائم' || str === 'permanent') return 0;

    let totalMs = 0;

    // عربي أول: يوم/أيام، ساعة/ساعات، دقيقة/دقائق، ثانية/ثوان (+ اختصارات)
    const patterns = [
        { regex: /(\d+)\s*(?:يوم|أيام|ايام|ي)/g, mult: 24 * 60 * 60 * 1000 },
        { regex: /(\d+)\s*(?:ساعة|ساعات|س)/g, mult: 60 * 60 * 1000 },
        { regex: /(\d+)\s*(?:دقيقة|دقائق|د)/g, mult: 60 * 1000 },
        { regex: /(\d+)\s*(?:ثانية|ثوان|ث)/g, mult: 1000 },
        { regex: /(\d+)\s*d(?:ays?)?/g, mult: 24 * 60 * 60 * 1000 },
        { regex: /(\d+)\s*h(?:ours?)?/g, mult: 60 * 60 * 1000 },
        { regex: /(\d+)\s*m(?:in(?:utes?)?)?/g, mult: 60 * 1000 },
        { regex: /(\d+)\s*s(?:ec(?:onds?)?)?/g, mult: 1000 }
    ];

    for (const { regex, mult } of patterns) {
        let match;
        while ((match = regex.exec(str)) !== null) {
            totalMs += parseInt(match[1]) * mult;
        }
    }

    // إذا ما فيه وحدات، الرقم الصريح = دقائق (بس إذا كان الرقم فقط)
    if (totalMs === 0 && /^\d+$/.test(str)) {
        const num = parseInt(str);
        if (!isNaN(num) && num > 0) totalMs = num * 60 * 1000;
    }

    return totalMs;
}

function parseWarningRolesInput(input) {
    const lines = String(input || '').split('\n').map(s => s.trim()).filter(Boolean);
    const roles = [];
    
    for (const line of lines) {
        // Format: roleId:duration or just roleId
        const parts = line.split(':');
        const roleId = parts[0].trim();
        
        if (!/^\d+$/.test(roleId)) continue;
        
        let durationMs = 0;
        if (parts.length > 1) {
            durationMs = parseDuration(parts.slice(1).join(':'));
        }
        
        roles.push({ roleId, durationMs });
    }
    
    return roles;
}

function buildConfigRows(userId, guildId) {
    const config = getPunishConfig(guildId);
    
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`punishlog:toggle:${userId}`)
                .setLabel(config.enabled ? 'إيقاف' : 'تشغيل')
                .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`punishlog:settings:${userId}`)
                .setLabel('الإعدادات')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`punishlog:roles:${userId}`)
                .setLabel('رتب التحذير')
                .setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`punishlog:autoban:${userId}`)
                .setLabel(config.autoBanEnabled ? 'إيقاف الباند التلقائي' : 'تفعيل الباند التلقائي')
                .setStyle(config.autoBanEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
        )
    ];
}

function buildSettingsModal(ownerId, guildId) {
    const config = getPunishConfig(guildId);
    
    const modal = new ModalBuilder()
        .setCustomId(`punishlogModal:settings:${ownerId}`)
        .setTitle('⚙️ إعدادات سجل العقوبات');
    
    const forumChannel = new TextInputBuilder()
        .setCustomId('forumChannelId')
        .setLabel('ID روم الفورم (للسجلات)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(config.forumChannelId || '');
    
    const logChannel = new TextInputBuilder()
        .setCustomId('logChannelId')
        .setLabel('ID روم اللوق العام')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(config.logChannelId || '');
    
    const maxWarnings = new TextInputBuilder()
        .setCustomId('maxWarnings')
        .setLabel('عدد العقوبات قبل الباند')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(String(config.maxWarnings));
    
    const banReason = new TextInputBuilder()
        .setCustomId('banReason')
        .setLabel('سبب الباند التلقائي')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(config.banReason);
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(forumChannel),
        new ActionRowBuilder().addComponents(logChannel),
        new ActionRowBuilder().addComponents(maxWarnings),
        new ActionRowBuilder().addComponents(banReason)
    );
    
    return modal;
}

function buildRolesModal(ownerId, guildId) {
    const config = getPunishConfig(guildId);
    
    const modal = new ModalBuilder()
        .setCustomId(`punishlogModal:roles:${ownerId}`)
        .setTitle('⚠️ رتب التحذير المؤقتة');
    
    // Format: roleId:duration (e.g., 123456789:1d or 123456789:2h or 123456789:30m)
    // نحفظ بصيغة إنجليزية دقيقة (d/h/m) عشان ما تنحرف المدد عند إعادة الحفظ
    const currentValue = config.warningRoles.map(wr => {
        if (wr.durationMs > 0) {
            const totalMinutes = Math.round(wr.durationMs / 60000);
            let durStr;
            if (totalMinutes % 1440 === 0) durStr = `${totalMinutes / 1440}d`;
            else if (totalMinutes % 60 === 0) durStr = `${totalMinutes / 60}h`;
            else durStr = `${totalMinutes}m`;
            return `${wr.roleId}:${durStr}`;
        }
        return wr.roleId;
    }).join('\n');
    
    const rolesInput = new TextInputBuilder()
        .setCustomId('warningRoles')
        .setLabel('رتبة:مدة (كل سطر = رتبة)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('الصيغة: ID:مدة\nمثال:\n123456789:1d (يوم)\n987654321:2h (ساعتين)\n555555:30m (30 دقيقة)\n444444 (دائم)')
        .setValue(currentValue);
    
    modal.addComponents(new ActionRowBuilder().addComponents(rolesInput));
    return modal;
}

function buildPunishEmbed(punishment, guild) {
    const moderator = guild.members.cache.get(punishment.moderator_id);
    const duration = punishment.duration_minutes > 0 
        ? `${punishment.duration_minutes} دقيقة` 
        : 'دائم';
    
    const typeEmojis = {
        'warn': '⚠️',
        'timeout': '⏱️',
        'kick': '👢',
        'ban': '🔨',
        'unban': '🔓'
    };
    
    return new EmbedBuilder()
        .setColor('#E7D3B0')
        .setTitle(`${typeEmojis[punishment.type] || '📜'} عقوبة جديدة`)
        .addFields(
            { name: '👤 العضو', value: `<@${punishment.user_id}>`, inline: true },
            { name: '👮 المشرف', value: moderator ? `<@${punishment.moderator_id}>` : punishment.moderator_id, inline: true },
            { name: '📋 النوع', value: punishment.type, inline: true },
            { name: '⏰ المدة', value: duration, inline: true },
            { name: '📝 السبب', value: punishment.reason || 'غير محدد', inline: false },
            { name: '📅 التاريخ', value: `<t:${Math.floor(punishment.created_at / 1000)}:F>`, inline: false }
        )
        .setTimestamp();
}

function buildUserHistoryEmbed(guildId, userId, guild) {
    const punishments = getUserPunishments(guildId, userId);
    const member = guild.members.cache.get(userId);
    
    const recentPunishments = punishments.slice(0, 10).map(p => {
        const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
        return `**${p.type}** - ${p.reason || 'بدون سبب'} (${date})`;
    }).join('\n') || 'لا توجد عقوبات';
    
    return new EmbedBuilder()
        .setColor('#E7D3B0')
        .setTitle(`📋 سجل العقوبات`)
        .setThumbnail(member ? member.user.displayAvatarURL({ dynamic: true, size: 128 }) : null)
        .addFields(
            { name: '👤 العضو', value: member ? `${member.user.username} (<@${userId}>)` : `<@${userId}>`, inline: false },
            { name: '📊 عدد العقوبات', value: `**${punishments.length}**`, inline: true },
            { name: '📜 آخر العقوبات', value: recentPunishments, inline: false }
        )
        .setTimestamp();
}

module.exports = {
    getDb,
    getPunishConfig,
    getOrCreateUserThread,
    addPunishment,
    getUserPunishments,
    getPunishmentCount,
    applyWarningRole,
    checkAndAutoBan,
    buildConfigEmbed,
    buildConfigRows,
    buildSettingsModal,
    buildRolesModal,
    buildPunishEmbed,
    buildUserHistoryEmbed,
    parseDuration,
    formatDuration,
    parseWarningRolesInput,
    startTempRoleChecker,
    removeExpiredRoles
};
