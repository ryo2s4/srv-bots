const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');
const path = require('path');
const fs = require('fs');

// NOTE: src/data/ — legacy location, kept for data continuity (do not move to <root>/data/).
const dbPath = path.join(__dirname, '..', 'data', 'admin_reports.db');

let reportsDb = null;

function getReportsDb() {
    if (reportsDb) return reportsDb;
    const Database = require('better-sqlite3');
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS admin_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            date TEXT NOT NULL,
            tickets INTEGER DEFAULT 0,
            timeouts INTEGER DEFAULT 0,
            bans INTEGER DEFAULT 0,
            improvements TEXT DEFAULT '',
            total_points INTEGER DEFAULT 0,
            submitted_at INTEGER NOT NULL,
            UNIQUE(guild_id, user_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_admin_reports_guild_date ON admin_reports(guild_id, date);
        CREATE INDEX IF NOT EXISTS idx_admin_reports_guild_user ON admin_reports(guild_id, user_id);
    `);
    reportsDb = db;
    return db;
}

function dayKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function hasSubmittedToday(guildId, userId) {
    const db = getReportsDb();
    const today = dayKey();
    const row = db.prepare('SELECT 1 FROM admin_reports WHERE guild_id = ? AND user_id = ? AND date = ?').get(String(guildId), String(userId), today);
    return !!row;
}

function saveReport(guildId, userId, data) {
    const db = getReportsDb();
    const today = dayKey();
    const points = calculatePoints(data);
    db.prepare(`
        INSERT OR REPLACE INTO admin_reports (guild_id, user_id, date, tickets, timeouts, bans, improvements, total_points, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(guildId), String(userId), today, data.tickets, data.timeouts, data.bans, data.improvements, points, Date.now());
    return points;
}

function calculatePoints(data) {
    const tickets = Math.max(0, Number(data.tickets) || 0);
    const timeouts = Math.max(0, Number(data.timeouts) || 0);
    const bans = Math.max(0, Number(data.bans) || 0);
    const improvements = String(data.improvements || '').trim();
    
    let points = tickets * 2 + timeouts * 1 + bans * 3;
    if (improvements.length > 10) points += 1;
    if (improvements.length > 50) points += 1;
    if (improvements.length > 150) points += 1;
    if (improvements.length > 300) points += 1;
    if (improvements.length > 500) points += 1;
    return points;
}

function getTodayReports(guildId) {
    const db = getReportsDb();
    const today = dayKey();
    return db.prepare('SELECT * FROM admin_reports WHERE guild_id = ? AND date = ? ORDER BY total_points DESC').all(String(guildId), today);
}

function getLeaderboard(guildId, days = 7) {
    const db = getReportsDb();
    const since = dayKey(Date.now() - days * 24 * 60 * 60 * 1000);
    return db.prepare(`
        SELECT user_id, SUM(tickets) as tickets, SUM(timeouts) as timeouts, SUM(bans) as bans, SUM(total_points) as total_points, COUNT(*) as reports
        FROM admin_reports 
        WHERE guild_id = ? AND date >= ? 
        GROUP BY user_id 
        ORDER BY total_points DESC
    `).all(String(guildId), since);
}

function getMissingAdmins(guild) {
    const cfg = getGuildConfig(guild.id);
    const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
    const adminRoleIds = Array.isArray(ar.adminRoleIds) ? ar.adminRoleIds : [];
    
    const today = dayKey();
    const db = getReportsDb();
    const submittedIds = db.prepare('SELECT user_id FROM admin_reports WHERE guild_id = ? AND date = ?').all(String(guild.id), today).map(r => r.user_id);
    
    const missing = [];
    for (const [, member] of guild.members.cache) {
        if (member.user.bot) continue;
        
        // Check if member has any of the configured admin roles, or Administrator/ModerateMembers permission
        const hasAdminRole = adminRoleIds.length > 0 && member.roles.cache.some(r => adminRoleIds.includes(r.id));
        const hasAdminPerm = member.permissions.has(PermissionFlagsBits.Administrator) || 
            member.permissions.has(PermissionFlagsBits.ModerateMembers);
        
        if (!hasAdminRole && !hasAdminPerm) continue;
        if (!submittedIds.includes(member.id)) {
            missing.push(member);
        }
    }
    return missing;
}

function getAdminList(guild) {
    const cfg = getGuildConfig(guild.id);
    const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
    const adminRoleIds = Array.isArray(ar.adminRoleIds) ? ar.adminRoleIds : [];
    
    const admins = [];
    for (const [, member] of guild.members.cache) {
        if (member.user.bot) continue;
        
        const hasAdminRole = adminRoleIds.length > 0 && member.roles.cache.some(r => adminRoleIds.includes(r.id));
        const hasAdminPerm = member.permissions.has(PermissionFlagsBits.Administrator) || 
            member.permissions.has(PermissionFlagsBits.ModerateMembers);
        
        if (hasAdminRole || hasAdminPerm) {
            admins.push(member);
        }
    }
    return admins;
}

async function fetchAuditLogStats(guild, userId, sinceTs) {
    try {
        const logs = await guild.fetchAuditLogs({ limit: 100 });
        const userLogs = logs.entries.filter(e => e.executorId === userId && e.createdTimestamp >= sinceTs);
        
        let timeouts = 0, bans = 0;
        for (const entry of userLogs.values()) {
            if (entry.action === 'MEMBER_UPDATE' && entry.changes?.some(c => c.key === 'communication_disabled_until')) timeouts++;
            if (entry.action === 'MEMBER_BAN_ADD') bans++;
        }
        return { timeouts, bans };
    } catch {
        return { timeouts: 0, bans: 0 };
    }
}

function exportReports(guildId, format = 'csv', days = 30) {
    const db = getReportsDb();
    const since = dayKey(Date.now() - days * 24 * 60 * 60 * 1000);
    const reports = db.prepare('SELECT * FROM admin_reports WHERE guild_id = ? AND date >= ? ORDER BY date DESC').all(String(guildId), since);
    
    if (reports.length === 0) return null;
    
    const dataDir = path.join(__dirname, '..', 'data', 'exports');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    
    const filename = `admin_reports_${guildId}_${Date.now()}.${format}`;
    const filepath = path.join(dataDir, filename);
    
    if (format === 'csv') {
        const header = 'date,user_id,tickets,timeouts,bans,improvements,total_points\n';
        const rows = reports.map(r => 
            `${r.date},${r.user_id},${r.tickets},${r.timeouts},${r.bans},"${(r.improvements || '').replace(/"/g, '""')}",${r.total_points}`
        ).join('\n');
        fs.writeFileSync(filepath, header + rows);
    } else {
        fs.writeFileSync(filepath, JSON.stringify(reports, null, 2));
    }
    
    return { filepath, filename, count: reports.length };
}

function buildConfigEmbed(guildId, guild) {
    const cfg = getGuildConfig(guildId);
    const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
    
    const formChannel = ar.formChannelId ? `<#${ar.formChannelId}>` : 'غير محدد';
    const reportChannel = ar.reportChannelId ? `<#${ar.reportChannelId}>` : 'غير محدد';
    const reminderTime = ar.reminderHour !== undefined && ar.reminderHour >= 0 ? `${String(ar.reminderHour).padStart(2, '0')}:00 UTC` : 'معطل';
    
    const adminRoleIds = Array.isArray(ar.adminRoleIds) ? ar.adminRoleIds : [];
    const adminRolesText = adminRoleIds.length > 0 
        ? adminRoleIds.map(id => `<@&${id}>`).join(' | ')
        : 'غير محدد (يعتمد على صلاحيات)';
    
    const todayReports = getTodayReports(guildId);
    const totalPoints = todayReports.reduce((sum, r) => sum + r.total_points, 0);
    
    let missingText = '';
    if (guild && ar.enabled) {
        const missing = getMissingAdmins(guild);
        if (missing.length > 0) {
            missingText = `\n⚠️ **${missing.length}** أدمن ما قدم تقريره بعد`;
        }
    }
    
    return UI.embed({
        title: '⚙️ إعدادات نظام التقارير الإدارية',
        color: UI.COLORS.info,
        description:
            `> **الحالة:** ${ar.enabled ? 'شغال ✅' : 'مقفل ⛔'}\n` +
            `> **روم الفورم:** ${formChannel}\n` +
            `> **روم التقارير:** ${reportChannel}\n` +
            `> **وقت التذكير:** ${reminderTime}\n\n` +
            `**📊 إحصائيات اليوم:**\n` +
            `> تقارير: **${UI.fmtNum(todayReports.length)}** | نقاط: **${UI.fmtNum(totalPoints)}**${missingText}`,
        fields: [
            { name: '👔 رتب الإدارة', value: adminRolesText, inline: false },
            { name: '🏅 نظام النقاط', value: 'تكتة = 2 | تايم أوت = 1 | باند = 3\nتحسينات = 1-5 حسب الوصف', inline: false }
        ]
    });
}

function buildConfigRows(ownerId, guildId) {
    const cfg = getGuildConfig(guildId);
    const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
    
    return [
        UI.row(
            UI.btn(`adminreport:toggle:${ownerId}`, '⏯️ تشغيل/إيقاف', { style: ButtonStyle.Primary }),
            UI.btn(`adminreport:settings:${ownerId}`, '⚙️ الإعدادات', { style: ButtonStyle.Secondary }),
            UI.btn(`adminreport:roles:${ownerId}`, '👔 رتب الإدارة', { style: ButtonStyle.Secondary }),
            UI.btn(`adminreport:postform:${ownerId}`, '📢 نشر الفورم', { style: ButtonStyle.Primary, disabled: !ar.formChannelId }),
            UI.btn(`adminreport:refresh:${ownerId}`, '🔄 تحديث', { style: ButtonStyle.Secondary })
        ),
        UI.row(
            UI.btn(`adminreport:admins:${ownerId}`, '👥 قائمة الإدارة', { style: ButtonStyle.Primary }),
            UI.btn(`adminreport:today:${ownerId}`, '📄 تقارير اليوم', { style: ButtonStyle.Secondary }),
            UI.btn(`adminreport:leaderboard:${ownerId}`, '🏆 المتصدرين', { style: ButtonStyle.Secondary }),
            UI.btn(`adminreport:missing:${ownerId}`, '👀 الغائبين', { style: ButtonStyle.Secondary })
        )
    ];
}

function buildFormEmbed() {
    return UI.embed({
        title: '📋 تقرير الأدمن اليومي',
        color: UI.COLORS.info,
        description:
            'اضغط الزر تحت عشان تقدم تقريرك اليومي.\n\n' +
            '**تذكر:** كل أدمن يقدم تقريره مرة باليوم فقط.\n\n' +
            '**🏅 نظام النقاط:**\n' +
            '• تكتة = 2 نقطة\n' +
            '• تايم أوت = 1 نقطة\n' +
            '• باند = 3 نقاط\n' +
            '• تحسينات = 1-5 نقاط'
    });
}

function buildFormButton() {
    return UI.row(
        UI.btn('adminreport:submit:public', '📋 قدم تقريرك', { style: ButtonStyle.Primary })
    );
}

function buildFormModal(userId, prefilled = {}) {
    const modal = new ModalBuilder()
        .setCustomId(`adminreportModal:submit:${userId}`)
        .setTitle('📋 تقريرك اليومي');
    
    const tickets = new TextInputBuilder()
        .setCustomId('tickets')
        .setLabel('عدد التكتات اللي استلمتها اليوم')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(prefilled.tickets || 0));
    
    const timeouts = new TextInputBuilder()
        .setCustomId('timeouts')
        .setLabel('عدد التايم أوتات اللي عطيتها')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(prefilled.timeouts || 0));
    
    const bans = new TextInputBuilder()
        .setCustomId('bans')
        .setLabel('عدد الباندات اللي عطيتها')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(prefilled.bans || 0));
    
    const improvements = new TextInputBuilder()
        .setCustomId('improvements')
        .setLabel('التحسينات اللي سويتها (اذكرها)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('مثال: اضفت رول جديد، غيرت بالرومات، سويت إيفنت...');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(tickets),
        new ActionRowBuilder().addComponents(timeouts),
        new ActionRowBuilder().addComponents(bans),
        new ActionRowBuilder().addComponents(improvements)
    );
    
    return modal;
}

function buildSettingsModal(ownerId, guildId) {
    const cfg = getGuildConfig(guildId);
    const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
    
    const modal = new ModalBuilder()
        .setCustomId(`adminreportModal:settings:${ownerId}`)
        .setTitle('⚙️ إعدادات نظام التقارير');
    
    const formChannel = new TextInputBuilder()
        .setCustomId('formChannelId')
        .setLabel('ID روم الفورم (أو none)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(ar.formChannelId || 'none');
    
    const reportChannel = new TextInputBuilder()
        .setCustomId('reportChannelId')
        .setLabel('ID روم التقارير (أو none)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(ar.reportChannelId || 'none');
    
    const reminderHour = new TextInputBuilder()
        .setCustomId('reminderHour')
        .setLabel('ساعة التذكير UTC (0-23، أو -1 للتعطيل)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(String(ar.reminderHour ?? -1));
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(formChannel),
        new ActionRowBuilder().addComponents(reportChannel),
        new ActionRowBuilder().addComponents(reminderHour)
    );
    
    return modal;
}

function buildAdminRolesModal(ownerId, guildId) {
    const cfg = getGuildConfig(guildId);
    const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
    const adminRoleIds = Array.isArray(ar.adminRoleIds) ? ar.adminRoleIds : [];
    
    const modal = new ModalBuilder()
        .setCustomId(`adminreportModal:roles:${ownerId}`)
        .setTitle('👔 رتب الإدارة');
    
    const rolesInput = new TextInputBuilder()
        .setCustomId('adminRoleIds')
        .setLabel('IDs رتب الإدارة (كل سطر = رتبة)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('ضع كل ID في سطر منفصل\nمثال:\n123456789\n987654321\n(اتركه فاضي للاعتماد على الصلاحيات)')
        .setValue(adminRoleIds.join('\n'));
    
    modal.addComponents(new ActionRowBuilder().addComponents(rolesInput));
    return modal;
}

function buildAdminsListEmbed(guild) {
    const admins = getAdminList(guild);
    const cfg = getGuildConfig(guild.id);
    const ar = cfg.adminReport && typeof cfg.adminReport === 'object' ? cfg.adminReport : {};
    const adminRoleIds = Array.isArray(ar.adminRoleIds) ? ar.adminRoleIds : [];
    
    const today = dayKey();
    const db = getReportsDb();
    const submittedIds = db.prepare('SELECT user_id FROM admin_reports WHERE guild_id = ? AND date = ?').all(String(guild.id), today).map(r => r.user_id);
    
    const adminList = admins.slice(0, 20).map(m => {
        const submitted = submittedIds.includes(m.id);
        const status = submitted ? '✅' : '❌';
        return `${status} <@${m.id}> - ${m.user.username}`;
    }).join('\n') || 'لا يوجد إدارة';
    
    const moreText = admins.length > 20 ? `\n... و ${admins.length - 20} آخرين` : '';
    
    return UI.embed({
        title: '👥 قائمة الإدارة',
        color: UI.COLORS.info,
        description:
            `> **عدد الإدارة:** ${UI.fmtNum(admins.length)}\n` +
            `> **قدموا تقاريرهم:** ${UI.fmtNum(submittedIds.length)}\n` +
            `> **لم يقدموا:** ${UI.fmtNum(Math.max(0, admins.length - submittedIds.length))}\n\n` +
            `${adminList}${moreText}`,
        fields: [
            { name: '👔 رتب الإدارة المحددة', value: adminRoleIds.length > 0 ? adminRoleIds.map(id => `<@&${id}>`).join(' | ') : 'غير محدد (يعتمد على صلاحيات)', inline: false }
        ]
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminreport')
        .setDescription('إعدادات نظام التقارير الإدارية (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'آسف بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        const embed = buildConfigEmbed(interaction.guild.id, interaction.guild);
        const components = buildConfigRows(interaction.user.id, interaction.guild.id);
        return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    },

    // Exported functions for handlers
    buildConfigEmbed,
    buildConfigRows,
    buildFormEmbed,
    buildFormButton,
    buildFormModal,
    buildSettingsModal,
    buildAdminRolesModal,
    buildAdminsListEmbed,
    hasSubmittedToday,
    saveReport,
    getTodayReports,
    getLeaderboard,
    getMissingAdmins,
    getAdminList,
    exportReports,
    fetchAuditLogStats,
    dayKey
};
