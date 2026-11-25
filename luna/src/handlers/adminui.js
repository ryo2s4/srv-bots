const {
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder
} = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
const { updateGuildShop, getGuildShop } = require('../shopStore');
const UI = require('../utils/ui');
const fs = require('fs');
const path = require('path');

const backupsDir = path.join(__dirname, '..', 'data', 'backups');
function ensureBackupsDir() {
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}
function getBackupFiles(guildId) {
    ensureBackupsDir();
    return fs.readdirSync(backupsDir)
        .filter((f) => f.startsWith(guildId) && f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a));
}
function cleanOldBackups(guildId, retentionDays) {
    ensureBackupsDir();
    const files = getBackupFiles(guildId);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    for (const f of files) {
        const match = f.match(/_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.json$/);
        if (match) {
            const fileDate = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
            if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoff) {
                try { fs.unlinkSync(path.join(backupsDir, f)); deleted++; } catch {}
            }
        }
    }
    return deleted;
}

const boostTypes = [
    { name: 'XP Boost', value: 'xp_boost' },
    { name: 'Luna Boost', value: 'luna_boost' },
    { name: 'Level-Up Reward Boost', value: 'levelup_reward_boost' }
];
function fmtPct(m) {
    return `+${Math.round((Number(m) - 1) * 100)}%`;
}
function parseDurationSpec(input) {
    const raw = String(input || '').trim().toLowerCase();
    const m = raw.match(/^(\d+)\s*([smhd])$/);
    if (!m) return { ok: false, reason: 'صيغة المدة غير صحيحة. مثال: 5s أو 10m أو 1h' };
    const n = Math.floor(Number(m[1]) || 0);
    if (!n || n < 1) return { ok: false, reason: 'المدة لازم تكون رقم أكبر من 0' };
    const unit = m[2];
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return { ok: true, ms: n * mult, reason: '' };
}

function isOwner(interaction, ownerId) {
    return String(interaction.user.id) === String(ownerId);
}
async function denyNotOwner(interaction) {
    try {
        if (interaction.deferred || interaction.replied) return await interaction.followUp({ content: 'هاللوحة مو مالك 3:', flags: MessageFlags.Ephemeral });
        return await interaction.reply({ content: 'هاللوحة مو مالك 3:', flags: MessageFlags.Ephemeral });
    } catch { return null; }
}

// ====== BACKUP PANEL ======
function buildBackupPanel(guildId) {
    const cfg = getGuildConfig(guildId);
    const r = cfg.backup && typeof cfg.backup === 'object' ? cfg.backup : {};
    const embed = UI.embed({
        title: '💾 النسخ الاحتياطي',
        color: UI.COLORS.info,
        description:
            'احمِ إعدادات سيرفرك بنسخة احتياطية 💾\n\n' +
            `> **الاحتفاظ:** ${UI.fmtNum(r.retentionDays ?? 30)} يوم\n` +
            `> **النسخ اليومي:** ${r.dailyEnabled ? '✅ مفعّل' : '❌ معطّل'}`
    });
    const row = UI.row(
        UI.btn('adminui:backup:export', '💾 تصدير', { style: ButtonStyle.Primary }),
        UI.btn('adminui:backup:list', '📋 قائمة', { style: ButtonStyle.Secondary }),
        UI.btn('adminui:backup:settings', '⚙️ إعدادات', { style: ButtonStyle.Secondary })
    );
    return { embeds: [embed], components: [row] };
}

// ====== RGB PANEL ======
function buildRgbPanel(guildId) {
    const cfg = getGuildConfig(guildId);
    const r = cfg.rgbRole && typeof cfg.rgbRole === 'object' ? cfg.rgbRole : {};
    const embed = UI.embed({
        title: '🌈 رتبة RGB',
        color: UI.COLORS.info,
        description: r.roleId
            ? 'الألوان المتحركة مفعّلة ✅\n\n' +
                `> **الرتبة:** <@&${r.roleId}>\n` +
                `> **التحديث كل:** ${UI.fmtDuration(Number(r.intervalMs || 0))}`
            : 'ما فيه رتبة RGB مفعّلة حاليًا ❌'
    });
    const row = UI.row(
        UI.btn('adminui:rgb:on', '🌈 تفعيل', { style: ButtonStyle.Primary }),
        UI.btn('adminui:rgb:off', '⛔ إيقاف', { style: ButtonStyle.Danger }),
        UI.btn('adminui:rgb:status', '📊 الحالة', { style: ButtonStyle.Secondary })
    );
    return { embeds: [embed], components: [row] };
}

// ====== ROLEBOOSTS PANEL ======
function buildRoleboostPanel(guildId) {
    const cfg = getGuildConfig(guildId);
    const boosts = Array.isArray(cfg.roleBoosts) ? cfg.roleBoosts : [];
    const embed = UI.embed({
        title: '⚡ بوستات الرتب',
        color: UI.COLORS.info,
        description: boosts.length
            ? 'المضاعفات المفعّلة على الرتب 👇\n\n' +
                boosts.map((b) => `> <@&${b.roleId}> → **${boostTypes.find((t) => t.value === b.type)?.name || b.type}** ${fmtPct(b.multiplier)}`).join('\n')
            : 'ما فيه بوستات رتب مضافة.'
    });
    const row = UI.row(
        UI.btn('adminui:roleboost:add', '➕ إضافة', { style: ButtonStyle.Primary }),
        UI.btn('adminui:roleboost:remove', '➖ حذف', { style: ButtonStyle.Danger }),
        UI.btn('adminui:roleboost:list', '📋 قائمة', { style: ButtonStyle.Secondary })
    );
    return { embeds: [embed], components: [row] };
}

async function handle({ client, interaction }) {
    if (!interaction.guild) return false;
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
    if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith('adminui')) return false;

    const id = interaction.customId;

    // ====== MODAL SUBMISSIONS ======
    if (interaction.isModalSubmit()) {
        if (!id.startsWith('adminuiModal:')) return false;
        if (id === 'adminuiModal:backup:settings') {
            const retentionRaw = interaction.fields.getTextInputValue('retention');
            const dailyRaw = interaction.fields.getTextInputValue('daily');
            const retention = retentionRaw ? parseInt(retentionRaw, 10) : null;
            const daily = dailyRaw ? dailyRaw.trim().toLowerCase() === 'true' : null;
            const cfg = getGuildConfig(interaction.guild.id);
            const currentRetention = cfg.backup?.retentionDays ?? 30;
            const currentDaily = cfg.backup?.dailyEnabled ?? false;
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                backup: {
                    ...(c.backup || {}),
                    ...(retention !== null && !isNaN(retention) ? { retentionDays: Math.max(0, retention) } : {}),
                    ...(daily !== null ? { dailyEnabled: daily } : {})
                }
            }));
            await interaction.reply({
                embeds: [
                    UI.success(
                        `> **الاحتفاظ:** ${UI.fmtNum(retention !== null && !isNaN(retention) ? retention : currentRetention)} يوم\n` +
                        `> **النسخ اليومي:** ${daily !== null ? (daily ? '✅' : '❌') : (currentDaily ? '✅' : '❌')}`,
                        { title: '✅ تم التحديث' }
                    )
                ],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        if (id === 'adminuiModal:rgb:on') {
            const intervalRaw = interaction.fields.getTextInputValue('interval');
            const roleName = interaction.fields.getTextInputValue('name');
            const interval = parseDurationSpec(intervalRaw);
            if (!interval.ok) {
                await interaction.reply({ content: interval.reason, flags: MessageFlags.Ephemeral });
                return true;
            }
            if (interval.ms < 2000) {
                await interaction.reply({ content: 'خلي المدة ثانيتين أو أكثر.', flags: MessageFlags.Ephemeral });
                return true;
            }
            const guild = interaction.guild;
            const botMember = guild.members.me;
            if (!botMember || !botMember.permissions.has(require('discord.js').PermissionFlagsBits.ManageRoles)) {
                await interaction.reply({ content: 'لازم أعطيني صلاحية Manage Roles.', flags: MessageFlags.Ephemeral });
                return true;
            }
            const cfg = getGuildConfig(guild.id);
            const current = cfg.rgbRole && typeof cfg.rgbRole === 'object' ? cfg.rgbRole : {};
            let role = current.roleId ? guild.roles.cache.get(String(current.roleId)) : null;
            if (!role) {
                try { role = await guild.roles.create({ name: (roleName || 'RGB').slice(0, 100), color: 0xff0000, reason: 'RGB role enabled' }); } catch { role = null; }
            } else if (roleName) {
                try { await role.setName(String(roleName).slice(0, 100)); } catch {}
            }
            if (!role) {
                await interaction.reply({ content: 'ما قدرت أنشئ الرتبة.', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (botMember.roles.highest.comparePositionTo(role) <= 0) {
                await interaction.reply({ content: 'رتبتي لازم تكون أعلى من رتبة RGB.', flags: MessageFlags.Ephemeral });
                return true;
            }
            const now = Date.now();
            updateGuildConfig(guild.id, (c) => ({ ...c, rgbRole: { roleId: role.id, intervalMs: interval.ms, nextAt: now + 1000, hue: typeof current.hue === 'number' ? current.hue : 0 } }));
            await interaction.reply({ content: `✅🌈 تم تفعيل رتبة RGB!\n- الرتبة: <@&${role.id}>\n- التغيير كل: **${intervalRaw}**`, flags: MessageFlags.Ephemeral });
            return true;
        }
        if (id === 'adminuiModal:roleboost:add') {
            const roleId = interaction.fields.getTextInputValue('roleid').trim().replace(/^<@&(\d+)>$/, '$1');
            if (!/^\d{15,20}$/.test(roleId)) {
                await interaction.reply({ content: '❌ اكتب ID رتبة صحيح أو منشن الرتبة (مثل <@&123456789012345678>) 3:', flags: MessageFlags.Ephemeral });
                return true;
            }
            const type = interaction.fields.getTextInputValue('type').trim();
            const percent = parseInt(interaction.fields.getTextInputValue('percent'), 10);
            if (!boostTypes.some((b) => b.value === type)) {
                await interaction.reply({ content: 'نوع البوست غير صحيح.', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (isNaN(percent) || percent < 1 || percent > 1000) {
                await interaction.reply({ content: 'النسبة لازم تكون بين 1 و 1000.', flags: MessageFlags.Ephemeral });
                return true;
            }
            const multiplier = 1 + percent / 100;
            const cfg = getGuildConfig(interaction.guild.id);
            const boosts = Array.isArray(cfg.roleBoosts) ? [...cfg.roleBoosts] : [];
            const existing = boosts.findIndex((b) => b && b.roleId === roleId && b.type === type);
            if (existing !== -1) boosts[existing] = { roleId, type, multiplier };
            else boosts.push({ roleId, type, multiplier });
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, roleBoosts: boosts }));
            await interaction.reply({ content: `✅ <@&${roleId}> → ${boostTypes.find((b) => b.value === type)?.name || type} **${fmtPct(multiplier)}**`, flags: MessageFlags.Ephemeral });
            return true;
        }
        return false;
    }

    // ====== SELECT MENU ======
    if (interaction.isStringSelectMenu()) {
        if (id !== 'adminuiSelect:roleboost:remove') return false;
        const roleId = interaction.values[0];
        const cfg = getGuildConfig(interaction.guild.id);
        const boosts = Array.isArray(cfg.roleBoosts) ? cfg.roleBoosts : [];
        const filtered = boosts.filter((b) => b && b.roleId !== roleId);
        if (filtered.length === boosts.length) {
            await interaction.reply({ content: 'مافي بوستات لهذي الرتبة 3:', flags: MessageFlags.Ephemeral });
            return true;
        }
        updateGuildConfig(interaction.guild.id, (c) => ({ ...c, roleBoosts: filtered }));
        await interaction.reply({ content: `✅ تم حذف بوستات <@&${roleId}>`, flags: MessageFlags.Ephemeral });
        return true;
    }

    // ====== BUTTONS ======
    if (!interaction.isButton()) return false;

    const parts = id.split(':');
    if (parts.length < 2) return false;
    const section = parts[1]; // backup | rgb | roleboost
    const action = parts[2];  // menu | export | list | settings | on | off | status | add | remove | confirm ...

    // Menu buttons from main panel
    if (action === 'menu') {
        const ownerId = parts[3];
        if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
        if (section === 'backup') {
            await interaction.reply({ ...buildBackupPanel(interaction.guild.id), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (section === 'rgb') {
            await interaction.reply({ ...buildRgbPanel(interaction.guild.id), flags: MessageFlags.Ephemeral });
            return true;
        }
        if (section === 'roleboost') {
            await interaction.reply({ ...buildRoleboostPanel(interaction.guild.id), flags: MessageFlags.Ephemeral });
            return true;
        }
        return false;
    }

    // BACKUP ACTIONS
    if (section === 'backup') {
        if (action === 'export') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const guildId = interaction.guild.id;
            const cfg = getGuildConfig(guildId);
            ensureBackupsDir();
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
            const filename = `${guildId}_${timestamp}.json`;
            const filepath = path.join(backupsDir, filename);
            const backupData = {
                guildId,
                guildName: interaction.guild.name,
                exportedAt: new Date().toISOString(),
                exportedBy: interaction.user.id,
                config: cfg
            };
            fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));
            const retentionDays = Math.max(0, Number(cfg.backup?.retentionDays) || 30);
            cleanOldBackups(guildId, retentionDays);
            const attachment = new AttachmentBuilder(filepath, { name: `backup_${interaction.guild.name}.json` });
            const embed = UI.success(`الملف: \`${filename}\``, { title: '💾 تم التصدير' });
            await interaction.editReply({ embeds: [embed], files: [attachment] });
            return true;
        }
        if (action === 'list') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const files = getBackupFiles(interaction.guild.id);
            if (files.length === 0) {
                await interaction.editReply({ content: 'ما في نسخ احتياطية محفوظة.' });
                return true;
            }
            const recent = files.slice(0, 10).map((f, i) => {
                const match = f.match(/_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.json$/);
                const dateStr = match ? `${match[1]} ${match[2]}:${match[3]}:${match[4]} UTC` : 'غير معروف';
                return `\`${i + 1}.\` ${dateStr}`;
            }).join('\n');
            const embed = UI.embed({
                title: '📋 النسخ الاحتياطية',
                color: UI.COLORS.info,
                description: recent,
                footerText: `إجمالي: ${UI.fmtNum(files.length)} نسخة`
            });
            await interaction.editReply({ embeds: [embed] });
            return true;
        }
        if (action === 'settings') {
            const modal = new ModalBuilder().setCustomId('adminuiModal:backup:settings').setTitle('⚙️ إعدادات النسخ الاحتياطي');
            const retentionInput = new TextInputBuilder().setCustomId('retention').setLabel('عدد أيام الاحتفاظ (0 = تعطيل)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('30');
            const dailyInput = new TextInputBuilder().setCustomId('daily').setLabel('النسخ اليومي (true/false)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('false');
            modal.addComponents(new ActionRowBuilder().addComponents(retentionInput), new ActionRowBuilder().addComponents(dailyInput));
            await interaction.showModal(modal);
            return true;
        }
        return false;
    }

    // RGB ACTIONS
    if (section === 'rgb') {
        if (action === 'on') {
            const modal = new ModalBuilder().setCustomId('adminuiModal:rgb:on').setTitle('🌈 تفعيل رتبة RGB');
            const intervalInput = new TextInputBuilder().setCustomId('interval').setLabel('مدة التغيير (مثال: 5s, 10s, 1m)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('5s');
            const nameInput = new TextInputBuilder().setCustomId('name').setLabel('اسم الرتبة (اختياري)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('RGB');
            modal.addComponents(new ActionRowBuilder().addComponents(intervalInput), new ActionRowBuilder().addComponents(nameInput));
            await interaction.showModal(modal);
            return true;
        }
        if (action === 'off') {
            updateGuildConfig(interaction.guild.id, (c) => ({ ...c, rgbRole: { roleId: null, intervalMs: 0, nextAt: 0, hue: 0 } }));
            await interaction.reply({ content: '⛈️ تم إيقاف رتبة RGB.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (action === 'status') {
            const cfg = getGuildConfig(interaction.guild.id);
            const r = cfg.rgbRole && typeof cfg.rgbRole === 'object' ? cfg.rgbRole : {};
            if (!r.roleId || !r.intervalMs) {
                await interaction.reply({ content: '🌈 رتبة RGB مو مفعّلة حاليًا.', flags: MessageFlags.Ephemeral });
                return true;
            }
            await interaction.reply({
                content: `🌈 إعدادات رتبة RGB:\n- الرتبة: <@&${r.roleId}>\n- التحديث كل: **${Math.round(Number(r.intervalMs) / 1000)}** ثانية`,
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        return false;
    }

    // ROLEBOOST ACTIONS
    if (section === 'roleboost') {
        if (action === 'add') {
            const modal = new ModalBuilder().setCustomId('adminuiModal:roleboost:add').setTitle('➕ إضافة بوست لرتبة');
            const roleInput = new TextInputBuilder().setCustomId('roleid').setLabel('ID الرتبة').setStyle(TextInputStyle.Short).setRequired(true);
            const typeInput = new TextInputBuilder()
                .setCustomId('type')
                .setLabel('نوع البوست')
                .setPlaceholder('xp_boost / luna_boost / levelup_reward_boost')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            const pctInput = new TextInputBuilder().setCustomId('percent').setLabel('النسبة المئوية (20 = +20%)').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(roleInput), new ActionRowBuilder().addComponents(typeInput), new ActionRowBuilder().addComponents(pctInput));
            await interaction.showModal(modal);
            return true;
        }
        if (action === 'remove') {
            const cfg = getGuildConfig(interaction.guild.id);
            const boosts = Array.isArray(cfg.roleBoosts) ? cfg.roleBoosts : [];
            if (boosts.length === 0) {
                await interaction.reply({ content: 'ما فيه بوستات رتب 3:', flags: MessageFlags.Ephemeral });
                return true;
            }
            const options = boosts.slice(0, 25).map((b) => ({
                label: `Boost ${b.roleId.slice(-6)}`,
                value: b.roleId,
                description: `${boostTypes.find((t) => t.value === b.type)?.name || b.type} ${fmtPct(b.multiplier)}`
            }));
            const select = new StringSelectMenuBuilder().setCustomId('adminuiSelect:roleboost:remove').setPlaceholder('اختار رتبة لحذف بوستاتها').addOptions(options);
            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ content: '➖ اختار الرتبة:', components: [row], flags: MessageFlags.Ephemeral });
            return true;
        }
        if (action === 'list') {
            const cfg = getGuildConfig(interaction.guild.id);
            const boosts = Array.isArray(cfg.roleBoosts) ? cfg.roleBoosts : [];
            if (boosts.length === 0) {
                await interaction.reply({ content: 'ما فيه بوستات رتب 3:', flags: MessageFlags.Ephemeral });
                return true;
            }
            const lines = boosts.map((b) => `<@&${b.roleId}> → **${boostTypes.find((t) => t.value === b.type)?.name || b.type}** ${fmtPct(b.multiplier)}`);
            const embed = UI.embed({
                title: '⚡ بوستات الرتب',
                color: UI.COLORS.info,
                description: lines.map((l) => `> ${l}`).join('\n')
            });
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            return true;
        }
        return false;
    }

    return false;
}

module.exports = { handle };
