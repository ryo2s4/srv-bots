const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getGuildConfig, updateGuildConfig, getAllGuildConfigs } = require('../guildConfig');

const backupsDir = path.join(__dirname, '..', 'data', 'backups');

function ensureBackupsDir() {
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }
}

function getBackupFiles(guildId) {
    ensureBackupsDir();
    const files = fs.readdirSync(backupsDir)
        .filter(f => f.startsWith(guildId) && f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a));
    return files;
}

// اسم الملف: `${guildId}_${ISO بتوقيت UTC والنقاط replaced بشرطات}.json` مثال: 123_2026-10-17T12-30-00.json
function parseBackupTimestamp(f) {
    const match = String(f).match(/_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.json$/);
    if (!match) return null;
    const fileDate = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
    return Number.isNaN(fileDate.getTime()) ? null : fileDate;
}

function formatBackupTimestamp(f) {
    const fileDate = parseBackupTimestamp(f);
    if (!fileDate) return 'غير معروف';
    return `${fileDate.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function cleanOldBackups(guildId, retentionDays) {
    ensureBackupsDir();
    const files = getBackupFiles(guildId);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    for (const f of files) {
        const fileDate = parseBackupTimestamp(f);
        if (fileDate && fileDate.getTime() < cutoff) {
            try {
                fs.unlinkSync(path.join(backupsDir, f));
                deleted++;
            } catch {}
        }
    }
    return deleted;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup')
        .setDescription('إدارة النسخ الاحتياطي لإعدادات السيرفر (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('export')
                .setDescription('تصدير نسخة احتياطية')
        )
        .addSubcommand(sub =>
            sub.setName('import')
                .setDescription('استيراد نسخة احتياطية')
                .addAttachmentOption(opt =>
                    opt.setName('file')
                        .setDescription('ملف النسخة الاحتياطية (.json)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض النسخ الاحتياطية المحفوظة')
        )
        .addSubcommand(sub =>
            sub.setName('settings')
                .setDescription('إعدادات النسخ الاحتياطية التلقائية')
                .addIntegerOption(opt =>
                    opt.setName('retention')
                        .setDescription('عدد الأيام للاحتفاظ بالنسخ (0 = تعطيل الحذف التلقائي)')
                        .setMinValue(0)
                        .setMaxValue(365)
                )
                .addBooleanOption(opt =>
                    opt.setName('daily')
                        .setDescription('تفعيل النسخ اليومي التلقائي')
                )
        ),

    async execute(interaction) {
        // Note: 'backup:' button routing is external (index.js → handleBackupButton); nothing to register here.
        if (!interaction.guild) {
            return interaction.reply({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:', flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'export') {
            return this.handleExport(interaction);
        } else if (subcommand === 'import') {
            return this.handleImport(interaction);
        } else if (subcommand === 'list') {
            return this.handleList(interaction);
        } else if (subcommand === 'settings') {
            return this.handleSettings(interaction);
        }
    },

    async handleExport(interaction) {
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

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('💾 تم تصدير النسخة الاحتياطية')
            .setDescription(`تم حفظ نسخة من إعدادات السيرفر.\nالملف: \`${filename}\``)
            .setTimestamp();

        return interaction.editReply({ embeds: [embed], files: [attachment] });
    },

    async handleImport(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const attachment = interaction.options.getAttachment('file');
        if (!attachment) {
            return interaction.editReply({ content: 'من فضلك ارفع ملف النسخة الاحتياطية.' });
        }

        if (!attachment.name.endsWith('.json')) {
            return interaction.editReply({ content: 'الملف يجب أن يكون بصيغة `.json`.' });
        }

        try {
            const response = await fetch(attachment.url);
            const text = await response.text();
            const data = JSON.parse(text);

            if (!data.config || !data.guildId) {
                return interaction.editReply({ content: 'هذا الملف مو نسخة احتياطية صالحة.' });
            }

            if (String(data.guildId) !== String(interaction.guild.id)) {
                return interaction.editReply({ content: '⚠️ هذا الملف من سيرفر ثاني. استيراده ممكن يسبب مشاكل.\nلو متأكد، اضغط زر تأكيد الاستيراد.', components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`backup:force_import:${interaction.user.id}:${Buffer.from(attachment.url).toString('base64')}`)
                            .setLabel('تأكيد الاستيراد')
                            .setStyle(ButtonStyle.Danger)
                    )
                ]});
            }

            updateGuildConfig(interaction.guild.id, () => data.config);
            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('✅ تم استيراد النسخة الاحتياطية')
                .setDescription(`تم استعادة الإعدادات من نسخة بتاريخ: ${data.exportedAt || 'غير معروف'}`)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('Backup import error:', err);
            return interaction.editReply({ content: 'صار خطأ أثناء قراءة الملف. تأكد إنه ملف JSON صالح.' });
        }
    },

    async handleList(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guild.id;
        const files = getBackupFiles(guildId);

        if (files.length === 0) {
            return interaction.editReply({ content: 'ما في نسخ احتياطية محفوظة لهالسيرفر.' });
        }

        const recent = files.slice(0, 10);
        let desc = recent.map((f, i) => {
            return `\`${i + 1}.\` ${formatBackupTimestamp(f)}`;
        }).join('\n');

        if (files.length > 10) {
            desc += `\n\n... و ${files.length - 10} نسخة إضافية.`;
        }

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('📋 النسخ الاحتياطية المحفوظة')
            .setDescription(desc)
            .setFooter({ text: `إجمالي: ${files.length} نسخة` })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },

    async handleSettings(interaction) {
        const retention = interaction.options.getInteger('retention');
        const daily = interaction.options.getBoolean('daily');

        const cfg = getGuildConfig(interaction.guild.id);
        const currentRetention = cfg.backup?.retentionDays ?? 30;
        const currentDaily = cfg.backup?.dailyEnabled ?? false;

        if (retention === null && daily === null) {
            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('⚙️ إعدادات النسخ الاحتياطية')
                .setDescription(
                    `**الاحتفاظ:** ${currentRetention} يوم\n` +
                    `**النسخ اليومي:** ${currentDaily ? 'مفعل ✅' : 'معطل ❌'}`
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            backup: {
                ...(c.backup || {}),
                ...(retention !== null ? { retentionDays: retention } : {}),
                ...(daily !== null ? { dailyEnabled: daily } : {})
            }
        }));

        const embed = new EmbedBuilder()
            .setColor('#E7D3B0')
            .setTitle('✅ تم تحديث إعدادات النسخ الاحتياطية')
            .setDescription(
                `**الاحتفاظ:** ${retention !== null ? retention : currentRetention} يوم\n` +
                `**النسخ اليومي:** ${daily !== null ? (daily ? 'مفعل ✅' : 'معطل ❌') : (currentDaily ? 'مفعل ✅' : 'معطل ❌')}`
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },

    // Handles 'backup:*' button interactions (routing is external: index.js should call
    // client.commands.get('backup').handleBackupButton({ client, interaction }) for buttons
    // whose customId starts with 'backup:').
    // CustomId format: backup:force_import:<userId>:<base64url of attachment url>
    async handleBackupButton({ client, interaction }) {
        if (!(interaction.isButton && interaction.isButton())) return false;
        if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('backup:'))) return false;

        const respond = async (payload) => {
            try {
                if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
                return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
            } catch {}
            return true;
        };

        const parts = String(interaction.customId).split(':');
        const action = parts[1] || '';
        const ownerId = parts[2] || '';
        const encodedUrl = parts.slice(3).join(':');

        if (action !== 'force_import') {
            await respond({ content: 'هذا الزر غير معروف.' });
            return true;
        }

        if (!interaction.guild) {
            await respond({ content: 'اسفة بس هاد الشي بس بالسيرفر 3:' });
            return true;
        }

        if (!ownerId || String(interaction.user.id) !== String(ownerId)) {
            await respond({ content: '❌ هالزر مو لك… الشخص اللي طلب الاستيراد هو اللي يقدر يأكده.' });
            return true;
        }

        let attachmentUrl = '';
        try {
            attachmentUrl = Buffer.from(encodedUrl, 'base64').toString('utf8');
        } catch {}
        if (!/^https?:\/\//i.test(attachmentUrl)) {
            await respond({ content: '❌ الرابط غير صالح.' });
            return true;
        }

        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }
        } catch {}

        try {
            const response = await fetch(attachmentUrl);
            const text = await response.text();
            const data = JSON.parse(text);

            if (!data || !data.config || !data.guildId) {
                return respond({ content: 'هذا الملف مو نسخة احتياطية صالحة.' });
            }

            updateGuildConfig(interaction.guild.id, () => data.config);
            const embed = new EmbedBuilder()
                .setColor('#E7D3B0')
                .setTitle('✅ تم استيراد النسخة الاحتياطية')
                .setDescription(`تم استعادة الإعدادات من نسخة بتاريخ: ${data.exportedAt || 'غير معروف'}`)
                .setTimestamp();
            return respond({ embeds: [embed] });
        } catch (err) {
            console.error('Backup force import error:', err);
            return respond({ content: 'صار خطأ أثناء قراءة الملف. تأكد إنه ملف JSON صالح.' });
        }
    },

    // Called by scheduler for daily backups
    runDailyBackup: async function(guildId) {
        const cfg = getGuildConfig(guildId);
        if (!cfg.backup?.dailyEnabled) return null;

        ensureBackupsDir();
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
        const filename = `${guildId}_${timestamp}.json`;
        const filepath = path.join(backupsDir, filename);

        const backupData = {
            guildId,
            exportedAt: new Date().toISOString(),
            config: cfg
        };

        fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));

        const retentionDays = Math.max(0, Number(cfg.backup?.retentionDays) || 30);
        cleanOldBackups(guildId, retentionDays);

        return { filename, filepath };
    }
};
