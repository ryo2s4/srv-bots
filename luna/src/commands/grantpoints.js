const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addLunaPoints, getLunaPoints } = require('../levelsStore');
const { getUserInventory } = require('../shopStore');
const UI = require('../utils/ui');

function fmtUserWithTitle(guildId, userId) {
    if (!guildId || !userId) return `<@${userId}>`;
    const inv = getUserInventory(guildId, userId);
    const t = inv && inv.activeTitle ? ` 🎭 ${inv.activeTitle}` : '';
    return `<@${userId}>${t}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grantpoints')
        .setDescription('منح Luna Points لعضو أو للجميع (Administrator فقط)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('عدد النقاط المراد منحها')
                .setMinValue(1)
                .setMaxValue(100000)
                .setRequired(true))
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('العضو')
                .setRequired(false))
        .addBooleanOption(opt =>
            opt.setName('everyone')
                .setDescription('منح النقاط لكل أعضاء السيرفر (يستثني البوتات)')
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('reason')
                .setDescription('سبب المنح (اختياري)')
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Administrator عشان تستخدم هالامر 3:', ephemeral: true });
        }

        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }
        } catch {
            // ignore
        }

        const target = interaction.options.getUser('user');
        const everyone = Boolean(interaction.options.getBoolean('everyone'));
        const amount = interaction.options.getInteger('amount');
        const reason = (interaction.options.getString('reason') || '').trim();

        if (!amount || amount < 1) {
            return interaction.editReply({ content: '❌ آسف بس شي من البيانات مو مضبوط… شيّك/ي عليهم 3:' });
        }

        if (everyone) {
            let members;
            try {
                members = await interaction.guild.members.fetch();
            } catch {
                members = null;
            }

            if (!members) {
                return interaction.editReply({ content: '❌ آسف بس ما قدرت أجيب أعضاء السيرفر… جرب/ي مرة ثانية 3:' });
            }

            const humans = [...members.values()].filter((m) => m && m.user && !m.user.bot);
            if (humans.length === 0) {
                return interaction.editReply({ content: '❌ ما لقيت أعضاء (غير بوتات) عشان أعطيهم نقاط 3:' });
            }

            for (let i = 0; i < humans.length; i += 1) {
                const m = humans[i];
                addLunaPoints(interaction.guild.id, m.user.id, amount);
                if (i > 0 && i % 100 === 0) {
                    await new Promise((r) => setImmediate(r));
                }
            }

            return interaction.editReply({
                embeds: [
                    UI.success([
                        `تم منح **الجميع** ${UI.fmtNum(amount)} Luna Points ✨`,
                        '',
                        reason ? `> 📝 **السبب:** ${reason}` : null,
                        `> 👥 **عدد المستلمين (بدون بوتات):** ${UI.fmtNum(humans.length)}`,
                        `> 💰 **الإجمالي:** ${UI.fmtNum(humans.length * amount)} Luna Points`
                    ].filter(Boolean).join('\n'), { title: '✅ تم منح النقاط للجميع', footerText: 'منح نقاط' })
                ]
            });
        }

        if (!target) {
            return interaction.editReply({ content: '❌ اختاري عضو من خيار `user` أو فعّلي خيار `everyone` 3:' });
        }

        const before = getLunaPoints(interaction.guild.id, target.id);
        addLunaPoints(interaction.guild.id, target.id, amount);
        const after = getLunaPoints(interaction.guild.id, target.id);

        return interaction.editReply({
            embeds: [
                UI.success([
                    `تم منح ${fmtUserWithTitle(interaction.guild.id, target.id)} **${UI.fmtNum(amount)}** Luna Points ✨`,
                    '',
                    reason ? `> 📝 **السبب:** ${reason}` : null,
                    `> 💰 **الرصيد:** ${UI.fmtNum(before)} → ${UI.fmtNum(after)}`
                ].filter(Boolean).join('\n'), { title: '✅ تم منح النقاط', footerText: 'منح نقاط' })
            ]
        });
    }
};
