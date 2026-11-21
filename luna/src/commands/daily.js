const {
    SlashCommandBuilder,
    ButtonStyle
} = require('discord.js');

const { getDailyTasksEntry, setDailyTasksEntry } = require('../db');
const { addLunaPoints } = require('../levelsStore');
const { processXpGain, computeUserMultipliers } = require('../levelUpService');
const { getGuildConfig } = require('../guildConfig');
const UI = require('../utils/ui');

function dayKeyUtc(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getDailyDefinition() {
    return {
        pickCount: 4,
        tasks: [
            { id: 'msg_50', name: 'ارسل 50 رسالة', kind: 'count', goal: 50, luna: 4, xp: 10 },
            { id: 'xp_200', name: 'اكسب 200 XP خلال اليوم', kind: 'count', goal: 200, luna: 5, xp: 12 },
            { id: 'levelup_1', name: 'ارفع مستوى واحد اليوم', kind: 'count', goal: 1, luna: 6, xp: 15 },
            { id: 'mentions_3', name: 'اذكر 3 أشخاص بدون سبام', kind: 'count', goal: 3, luna: 3, xp: 8 },
            { id: 'replies_5', name: 'رد على 5 رسائل', kind: 'count', goal: 5, luna: 3, xp: 8 },
            { id: 'media_3', name: 'ارسل 3 صور/ملفات في روم محدد', kind: 'count', goal: 3, luna: 4, xp: 10, requires: 'mediaChannel' },
            { id: 'voice_20m', name: 'تكلم بفويس 20 دقيقة على الأقل', kind: 'seconds', goal: 20 * 60, luna: 6, xp: 15, requires: 'voiceChannelOptional' },
            { id: 'suggest_1', name: 'اكتب اقتراح مفيد بروم محدد', kind: 'count', goal: 1, luna: 5, xp: 12, requires: 'suggestionsChannel' },
            { id: 'win_event_1', name: 'افز بفعالية مرة', kind: 'count', goal: 1, luna: 5, xp: 12 }
        ]
    };
}

function pickNStable(list, n, seedStr) {
    const crypto = require('crypto');
    const seed = crypto.createHash('sha256').update(String(seedStr)).digest();
    const items = [...list];
    const out = [];

    for (let i = 0; i < n && items.length; i += 1) {
        const b = seed[i % seed.length];
        const idx = b % items.length;
        out.push(items.splice(idx, 1)[0]);
    }
    return out;
}

function getSelectedTaskIds(guildId, userId, dayKey, entry) {
    const progress = entry && entry.progress && typeof entry.progress === 'object' ? entry.progress : {};
    const meta = progress._meta && typeof progress._meta === 'object' ? progress._meta : {};
    const existing = Array.isArray(meta.selected) ? meta.selected.map(String).filter(Boolean) : [];
    if (existing.length) return existing;

    const def = getDailyDefinition();
    const cfg = getGuildConfig(guildId);
    const mediaOk = !!(cfg && cfg.dailyTasks && typeof cfg.dailyTasks === 'object' && cfg.dailyTasks.mediaChannelId);
    const suggestionsOk = !!(cfg && cfg.suggestionsChannelId);

    const available = def.tasks
        .filter((t) => {
            if (!t || !t.id) return false;
            if (t.requires === 'mediaChannel') return mediaOk;
            if (t.requires === 'suggestionsChannel') return suggestionsOk;
            return true;
        })
        .map((t) => t.id);

    const pick = pickNStable(available, def.pickCount, `${guildId}:${dayKey}`);
    return pick;
}

function clampInt(n, min, max) {
    const x = Math.floor(Number(n) || 0);
    return Math.max(min, Math.min(max, x));
}

function buildDailyEmbed(guildId, userId) {
    const dk = dayKeyUtc();
    const entry = getDailyTasksEntry(guildId, userId, dk);
    const progress = entry && entry.progress && typeof entry.progress === 'object' ? entry.progress : {};
    const claimedMap = progress._claimed && typeof progress._claimed === 'object' ? progress._claimed : {};

    const def = getDailyDefinition();
    const selectedIds = getSelectedTaskIds(guildId, userId, dk, entry);
    const tasksById = new Map(def.tasks.map((t) => [t.id, t]));
    const tasks = selectedIds.map((id) => tasksById.get(id)).filter(Boolean);

    if (!progress._meta || typeof progress._meta !== 'object') {
        const nextProgress = { ...progress, _meta: { selected: selectedIds } };
        setDailyTasksEntry(guildId, userId, dk, {
            progress: nextProgress,
            claimedAt: entry && entry.claimedAt ? entry.claimedAt : 0,
            updatedAt: Date.now()
        });
    }

    const lines = tasks.map((t) => {
        const raw = Number(progress[t.id]) || 0;
        const cur = t.kind === 'seconds' ? clampInt(Math.floor(raw), 0, t.goal) : clampInt(raw, 0, t.goal);
        const ok = cur >= t.goal;
        const shown = t.kind === 'seconds' ? `${Math.floor(cur / 60)}/${Math.floor(t.goal / 60)} دقيقة` : `${cur}/${t.goal}`;
        const extra = t.requires === 'mediaChannel' ? ' (روم محدد)' : t.requires === 'suggestionsChannel' ? ' (روم الاقتراحات)' : '';
        const already = !!claimedMap[t.id];
        const claimMark = already ? ' (مستلمة)' : '';
        const bar = UI.progressBar(cur, t.goal, 8);
        return `${ok ? '🌟' : '🌙'} **${t.name}**${extra}: ${shown} ${bar}${claimMark}  (+${UI.fmtNum(t.luna)}🌙 +${UI.fmtNum(t.xp)}✨ XP)`;
    });

    const completedCount = tasks.reduce((acc, t) => {
        const raw = Number(progress[t.id]) || 0;
        return acc + (raw >= t.goal ? 1 : 0);
    }, 0);
    const claimedCount = tasks.reduce((acc, t) => acc + (claimedMap && claimedMap[t.id] ? 1 : 0), 0);

    const allDone = tasks.every((t) => {
        const raw = Number(progress[t.id]) || 0;
        return raw >= t.goal;
    });
    const totalLuna = tasks.reduce((a, t) => a + (Number(t.luna) || 0), 0);
    const totalXp = tasks.reduce((a, t) => a + (Number(t.xp) || 0), 0);
    const remainingLuna = tasks.reduce((a, t) => a + (!claimedMap[t.id] ? (Number(t.luna) || 0) : 0), 0);
    const remainingXp = tasks.reduce((a, t) => a + (!claimedMap[t.id] ? (Number(t.xp) || 0) : 0), 0);

    const embed = UI.embed({
        color: UI.COLORS.shop,
        title: '🗓️ مهامك اليومية 🌙',
        description: lines.join('\n'),
        fields: [
            { name: 'المكافآت المتبقية 🎁', value: `**${UI.fmtNum(remainingLuna)}**🌙 + **${UI.fmtNum(remainingXp)}** ✨ XP`, inline: true },
            {
                name: 'التقدم 📊',
                value: `${UI.progressBar(completedCount, tasks.length, 10)}\nمكتملة: **${completedCount}/${tasks.length}** | مستلمة: **${claimedCount}/${tasks.length}**`,
                inline: true
            }
        ],
        footerText: `اليوم (UTC): ${dk}`
    });

    return { embed, allDone, tasks, claimedMap, totalLuna, totalXp, selectedIds };
}

function buildClaimRow(ownerId, claimableCount) {
    return UI.row(
        UI.btn(`daily:claim:${ownerId}`, 'استلام المكافآت', {
            style: ButtonStyle.Primary,
            emoji: '🎁',
            disabled: claimableCount <= 0
        })
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('عرض المهام اليومية واستلام مكافأتها')
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true });
        }

        const ownerId = String(interaction.user.id);
        const { embed, tasks, claimedMap } = buildDailyEmbed(interaction.guild.id, ownerId);

        const entry = getDailyTasksEntry(interaction.guild.id, ownerId, dayKeyUtc());
        const progress = entry && entry.progress && typeof entry.progress === 'object' ? entry.progress : {};

        const claimableCount = (Array.isArray(tasks) ? tasks : []).reduce((acc, t) => {
            const cur = Number(progress[t.id]) || 0;
            const completed = cur >= t.goal;
            const claimed = !!(claimedMap && claimedMap[t.id]);
            return acc + (completed && !claimed ? 1 : 0);
        }, 0);

        const row = buildClaimRow(ownerId, claimableCount);

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    },

    buildDailyEmbed,
    dayKeyUtc,
    getDailyDefinition,

    async handleClaim(interaction) {
        if (!interaction.guild) return;

        const parts = String(interaction.customId || '').split(':');
        const ownerId = parts[2] || '';
        if (ownerId && String(interaction.user.id) !== String(ownerId)) {
            return interaction.reply({ content: '❌ آسف بس هذا الزر لصاحب الأمر بس 3:', ephemeral: true });
        }

        const dk = dayKeyUtc();
        const entry = getDailyTasksEntry(interaction.guild.id, interaction.user.id, dk);
        const progress = entry && entry.progress && typeof entry.progress === 'object' ? entry.progress : {};
        const claimedMap = progress._claimed && typeof progress._claimed === 'object' ? progress._claimed : {};

        const def = getDailyDefinition();
        const selectedIds = getSelectedTaskIds(interaction.guild.id, interaction.user.id, dk, entry);
        const tasksById = new Map(def.tasks.map((t) => [t.id, t]));
        const tasks = selectedIds.map((id) => tasksById.get(id)).filter(Boolean);

        const now = Date.now();
        const toClaim = tasks.filter((t) => {
            const cur = Number(progress[t.id]) || 0;
            const completed = cur >= t.goal;
            const claimed = !!(claimedMap && claimedMap[t.id]);
            return completed && !claimed;
        });

        if (toClaim.length === 0) {
            return interaction.reply({ content: '❌ ما عندك ولا مهمة جاهزة للاستلام 🌙 3:', ephemeral: true });
        }

        const luna = toClaim.reduce((a, t) => a + Math.max(0, Math.floor(Number(t.luna) || 0)), 0);
        const xp = toClaim.reduce((a, t) => a + Math.max(0, Math.floor(Number(t.xp) || 0)), 0);

        if (luna > 0) addLunaPoints(interaction.guild.id, interaction.user.id, luna);
        let bonusLines = [];
        let grantedXp = 0;
        if (xp > 0) {
            const roleIds = interaction.member ? [...interaction.member.roles.cache.keys()] : [];
            const mults = computeUserMultipliers(interaction.guild.id, interaction.user.id, roleIds);
            grantedXp = Math.max(1, Math.floor(xp * mults.xpMult));
            const xpResult = processXpGain(interaction.guild.id, interaction.user.id, grantedXp, {
                lunaMult: mults.lunaMult,
                levelUpRewardMult: mults.levelUpRewardMult
            });
            bonusLines = [...xpResult.milestoneLines, ...xpResult.rewardLines, ...xpResult.runeLines];
        }

        const nextClaimed = { ...(claimedMap && typeof claimedMap === 'object' ? claimedMap : {}) };
        for (const t of toClaim) {
            nextClaimed[t.id] = now;
        }

        const nextProgress = {
            ...progress,
            _meta: { selected: selectedIds },
            _claimed: nextClaimed
        };

        setDailyTasksEntry(interaction.guild.id, interaction.user.id, dk, {
            progress: nextProgress,
            claimedAt: entry && entry.claimedAt ? entry.claimedAt : 0,
            updatedAt: Date.now()
        });

        const { embed, tasks: refreshedTasks, claimedMap: refreshedClaimed } = buildDailyEmbed(interaction.guild.id, interaction.user.id);
        const refreshedEntry = getDailyTasksEntry(interaction.guild.id, interaction.user.id, dk);
        const refreshedProgress = refreshedEntry && refreshedEntry.progress && typeof refreshedEntry.progress === 'object' ? refreshedEntry.progress : {};
        const claimableCount = (Array.isArray(refreshedTasks) ? refreshedTasks : []).reduce((acc, t) => {
            const cur = Number(refreshedProgress[t.id]) || 0;
            const completed = cur >= t.goal;
            const claimed = !!(refreshedClaimed && refreshedClaimed[t.id]);
            return acc + (completed && !claimed ? 1 : 0);
        }, 0);

        const row = buildClaimRow(ownerId, claimableCount);

        const xpShown = grantedXp > 0 ? grantedXp : xp;
        const boostNote = grantedXp > xp ? ` (بدعم التعزيزات)` : '';
        const claimText = `✅ 🌙 أخذت **${UI.fmtNum(luna)}** Luna Points و **${UI.fmtNum(xpShown)}** ✨ XP${boostNote} لإتمامك **${toClaim.length}** من المهام 3:`
            + (bonusLines.length > 0 ? '\n' + bonusLines.join('\n') : '');

        try {
            await interaction.update({ embeds: [embed], components: [row] });
            try {
                await interaction.followUp({
                    content: claimText,
                    ephemeral: true
                });
            } catch {
                // ignore
            }
            return;
        } catch {
            try {
                await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
                try {
                    await interaction.followUp({
                        content: claimText,
                        ephemeral: true
                    });
                } catch {
                    // ignore
                }
                return;
            } catch {
                return;
            }
        }
    }
};
