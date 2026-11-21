const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require('discord.js');

const { updateGuildConfig, getGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

function parseDurationSpec(input) {
    const raw = String(input || '').trim().toLowerCase();
    const m = raw.match(/^([0-9]+)\s*([smhd])$/);
    if (!m) return { ok: false, ms: 0, reason: 'صيغة المدة غير صحيحة. مثال: 30s أو 10m أو 2h أو 1d' };
    const n = Math.floor(Number(m[1]) || 0);
    if (!n || n < 1) return { ok: false, ms: 0, reason: 'المدة لازم تكون رقم أكبر من 0' };

    const unit = m[2];
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    const ms = n * mult;
    return { ok: true, ms, reason: '' };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lootboxes')
        .setDescription('إعداد نظام اللوت بوكس (Admins)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sc) =>
            sc
                .setName('set')
                .setDescription('تحديد روم اللوت بوكس + مدة الإرسال + مدة انتهاء الصندوق')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('الروم اللي تنرسل فيه اللوت بوكس')
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('interval')
                        .setDescription('كل متى ينرسل؟ مثال: 30m / 2h / 1d / 45s')
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('duration')
                        .setDescription('كم يبقى الصندوق قبل ما يختفي؟ مثال: 30s / 2m / 10m')
                        .setRequired(true)
                )
        )
        .addSubcommand((sc) =>
            sc
                .setName('off')
                .setDescription('إيقاف نظام اللوت بوكس')
        )
        .addSubcommand((sc) =>
            sc
                .setName('show')
                .setDescription('عرض إعدادات اللوت بوكس الحالية')
        ),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });

        const respond = async (payload) => {
            try {
                if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
            } catch {
                // ignore
            }
            try {
                return await interaction.reply({ ...payload, ephemeral: true });
            } catch {
                return;
            }
        };

        try {
            await interaction.deferReply({ ephemeral: true });
        } catch {
            // ignore
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return respond({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:' });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'show') {
            const cfg = getGuildConfig(interaction.guild.id);
            const l = cfg.lootboxes && typeof cfg.lootboxes === 'object' ? cfg.lootboxes : {};
            if (!l.channelId || !l.intervalMs || !l.durationMs) {
                return respond({
                    embeds: [
                        UI.info('اللوت بوكس مو مفعّل حاليًا 🌙\n\n> فعّله من `/lootboxes set` عشان يبدأ ينشر الصناديق.', {
                            title: '🎁 إعدادات اللوت بوكس',
                            footerText: 'إعدادات اللوت بوكس'
                        })
                    ]
                });
            }
            return respond({
                embeds: [
                    UI.embed({
                        color: UI.COLORS.events,
                        title: '🎁 إعدادات اللوت بوكس الحالية',
                        description: [
                            `> 📺 **الروم:** <#${l.channelId}>`,
                            `> ⏱️ **مدة الإرسال:** كل ${UI.fmtDuration(l.intervalMs)}`,
                            `> ⏳ **مدة بقاء الصندوق:** ${UI.fmtDuration(l.durationMs)}`
                        ].join('\n'),
                        footerText: 'إعدادات اللوت بوكس'
                    })
                ]
            });
        }

        if (sub === 'off') {
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                lootboxes: {
                    channelId: null,
                    intervalMs: 0,
                    durationMs: 0,
                    nextAt: 0,
                    activeMessageId: null,
                    activeUntil: 0,
                    openedBy: null
                }
            }));
            return respond({
                embeds: [
                    UI.success('> ⛔ تم إيقاف نظام اللوت بوكس نهائيًا.', {
                        title: '✅🌙 تم إيقاف اللوت بوكس',
                        footerText: 'إعدادات اللوت بوكس'
                    })
                ]
            });
        }

        if (sub === 'set') {
            const ch = interaction.options.getChannel('channel', true);
            if (!ch || !ch.isTextBased()) {
                return respond({ content: '❌ اختر روم نصي (Text) 3:' });
            }

            const intervalRaw = interaction.options.getString('interval', true);
            const durationRaw = interaction.options.getString('duration', true);

            const interval = parseDurationSpec(intervalRaw);
            if (!interval.ok) return respond({ content: `❌ ${interval.reason}` });

            const duration = parseDurationSpec(durationRaw);
            if (!duration.ok) return respond({ content: `❌ ${duration.reason}` });

            if (interval.ms < 10_000) {
                return respond({ content: '❌ خلي مدة الإرسال 10 ثواني أو أكثر عشان ما يصير سبام 🙏' });
            }
            if (duration.ms < 5_000) {
                return respond({ content: '❌ مدة بقاء الصندوق لازم تكون 5 ثواني أو أكثر 3:' });
            }
            if (duration.ms >= interval.ms) {
                return respond({ content: '❌ مدة بقاء الصندوق لازم تكون أقل من مدة الإرسال.' });
            }

            const now = Date.now();
            updateGuildConfig(interaction.guild.id, (c) => ({
                ...c,
                lootboxes: {
                    ...(c.lootboxes && typeof c.lootboxes === 'object' ? c.lootboxes : {}),
                    channelId: ch.id,
                    intervalMs: interval.ms,
                    durationMs: duration.ms,
                    nextAt: now + 3000,
                    activeMessageId: null,
                    activeUntil: 0,
                    openedBy: null
                }
            }));

            return respond({
                embeds: [
                    UI.success([
                        `اللوت بوكس بينرسل في <#${ch.id}> 🎁`,
                        '',
                        `> 🔁 **كل:** ${UI.fmtDuration(interval.ms)} (\`${intervalRaw}\`)`,
                        `> ⏳ **وينتهي بعد:** ${UI.fmtDuration(duration.ms)} (\`${durationRaw}\`)`,
                        '',
                        '*ملاحظة: ما راح يكون فيه إلا صندوق واحد شغّال بنفس الوقت.*'
                    ].join('\n'), { title: '✅🌙 تم تفعيل اللوت بوكس', footerText: 'إعدادات اللوت بوكس' })
                ]
            });
        }

        return respond({ content: '❌ آسف بس ما فهمت 3:' });
    }
};
