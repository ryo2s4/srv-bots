const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');
const { getUserStats } = require('../levelsStore');
const { xpForNextLevel } = require('../xpCurve');
const { processXpGain } = require('../levelUpService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grantxp')
        .setDescription('إعطاء XP لعضو (للأدمن فقط)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('العضو')
                .setRequired(true))
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('كم XP تضيف')
                .setMinValue(1)
                .setMaxValue(1000000)
                .setRequired(true)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر يشتغل بالسيرفر بس 3:')], flags: MessageFlags.Ephemeral });
        }

        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ embeds: [UI.error('آسف بس، تحتاج صلاحية **Administrator** عشان تستخدم هالأمر 3:')], flags: MessageFlags.Ephemeral });
        }

        const target = interaction.options.getUser('user');
        const amount = Math.max(1, Math.floor(interaction.options.getInteger('amount') || 0));

        if (!target || target.bot) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر ما ينفع مع البوتات — اختار عضو بشري 3:')], flags: MessageFlags.Ephemeral });
        }

        const before = getUserStats(interaction.guild.id, target.id);

        const roleIds = target ? [...(interaction.guild.members.cache.get(target.id)?.roles?.cache?.keys() || [])] : [];
        const mults = computeUserMultipliers(interaction.guild.id, target.id, roleIds);
        const result = processXpGain(interaction.guild.id, target.id, amount, {
            lunaMult: mults.lunaMult,
            levelUpRewardMult: mults.levelUpRewardMult
        });
        const after = result.after;
        const gainedLuna = result.lunaGained;

        const lvlDelta = Math.max(0, (after.level || 0) - (before.level || 0));
        const lvlText = lvlDelta > 0 ? `\nورفع **${UI.fmtNum(lvlDelta)}** مستوى (صار ${UI.fmtNum(after.level)}).` : `\nالمستوى ما تغيّر (لسه ${UI.fmtNum(after.level)}).`;
        const lunaText = gainedLuna > 0 ? `\nوكسب **${UI.fmtNum(gainedLuna)}** Luna Points.` : '';
        const extraLines = [...result.milestoneLines, ...result.rewardLines, ...result.runeLines];
        const extraText = extraLines.length > 0 ? '\n' + extraLines.join('\n') : '';

        return interaction.reply({
            embeds: [
                UI.success(
                    `تمت إضافة **${UI.fmtNum(amount)} XP** لـ ${target}.` +
                    lvlText +
                    lunaText +
                    extraText +
                    `\n\n${UI.progressBar(after.xp || 0, xpForNextLevel(after.level || 0), 12)}` +
                    `\nXP الحالي داخل المستوى: **${UI.fmtNum(after.xp || 0)}** / **${UI.fmtNum(xpForNextLevel(after.level || 0))}**`,
                    { title: '✨ تم إضافة XP' }
                )
            ]
        });
    }
};
