const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const UI = require('../utils/ui');
const { getUserStats } = require('../levelsStore');
const { getUserInventory } = require('../shopStore');
const { xpForNextLevel } = require('../xpCurve');
const { getBoostNameAr, formatRemainingAr, getTotalBoostSummary } = require('../boostMeta');
const { getGuildConfig } = require('../guildConfig');
const { TIERS, getRuneBoosts, fmtPct: runePct, fmtRuneLine, getTotalRuneSummary } = require('../runes');
const { getProfileWebUrl } = require('../web/profileWeb');

function tierEmoji(tier) {
    const t = TIERS[tier];
    return t ? t.emoji : '⚪';
}

function boostsTypeName(type) {
    const map = {
        xp_boost: 'XP Boost',
        luna_boost: 'Luna Boost',
        levelup_reward_boost: 'Level-Up Boost'
    };
    return map[type] || type;
}

function boostPct(b) {
    if (!b || typeof b.type !== 'string') return '';
    if (b.multiplier && b.multiplier > 1) return `+${Math.round((b.multiplier - 1) * 100)}%`;
    if (b.type === 'xp_boost_25_1h' || b.type === 'luna_boost_25_1h') return '+25%';
    if (b.type === 'xp_boost_15_24h') return '+15%';
    if (b.type === 'levelup_reward_boost_50_1h') return '+50%';
    return '';
}

function rarityFromCollectiblesCount(count) {
    if (count >= 10) return 'Mythic Collector 🔮';
    if (count >= 6) return 'Legendary Collector 🏆';
    if (count >= 3) return 'Rare Collector 💎';
    if (count >= 1) return 'New Collector 🌿';
    return 'No Collection';
}

function computeShopPower(inv) {
    const titles = Array.isArray(inv.titles) ? inv.titles.length : 0;
    const roles = Array.isArray(inv.roles) ? inv.roles.length : 0;
    const collectibles = Array.isArray(inv.collectibles) ? inv.collectibles.length : 0;
    const boosts = Array.isArray(inv.boosts) ? inv.boosts.length : 0;
    const activeBoosts = Array.isArray(inv.activeBoosts) ? inv.activeBoosts.length : 0;
    const s = inv.services && typeof inv.services === 'object' ? inv.services : {};
    const services =
        (Number(s.renameOnce) || 0) +
        (Number(s.xpTransfer) || 0) +
        (Number(s.shield) || 0) +
        (Number(s.rebalance) || 0) +
        (Number(s.vipTitle) || 0) +
        (Number(s.rerollDaily) || 0);

    // Social value score for profile prestige
    return (
        titles * 8 +
        roles * 15 +
        collectibles * 25 +
        boosts * 6 +
        activeBoosts * 10 +
        services * 5
    );
}

function getProfileTier(score) {
    if (score >= 500) return '🌌 أسطورة لونا';
    if (score >= 300) return '👑 نخبة القمر';
    if (score >= 180) return '⚔️ فارس السوق';
    if (score >= 90) return '✨ هاوي المتجر';
    return '🌱 بداية الطريق';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('يعرض ملف العضو (تقدم + متجر + مقتنيات)')
        .setDMPermission(false)
        .addUserOption((opt) =>
            opt
                .setName('user')
                .setDescription('عضو آخر لعرض ملفه')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ embeds: [UI.error('آسف بس، هالأمر يشتغل بالسيرفر بس 3:')], flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const stats = getUserStats(interaction.guild.id, targetUser.id);
        const inv = getUserInventory(interaction.guild.id, targetUser.id);
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        const memberRoles = targetMember ? [...targetMember.roles.cache.keys()] : [];
        const cfg = getGuildConfig(interaction.guild.id);
        const roleBoosts = Array.isArray(cfg.roleBoosts) ? cfg.roleBoosts : [];
        const activeRoleBoosts = roleBoosts.filter((b) => b && b.roleId && memberRoles.includes(b.roleId));
        const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
        const equippedRuneIds = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
        const equippedRunes = allRunes.filter((r) => r && equippedRuneIds.includes(r.id));

        const lvl = Math.max(0, Math.floor(Number(stats.level) || 0));
        const xp = Math.max(0, Math.floor(Number(stats.xp) || 0));
        const nextXp = Math.max(1, Math.floor(Number(xpForNextLevel(lvl)) || 1));
        const luna = Math.max(0, Math.floor(Number(stats.lunaPoints) || 0));

        const titles = Array.isArray(inv.titles) ? inv.titles : [];
        const roles = Array.isArray(inv.roles) ? inv.roles : [];
        const collectibles = Array.isArray(inv.collectibles) ? inv.collectibles : [];
        const activeBoosts = Array.isArray(inv.activeBoosts) ? inv.activeBoosts : [];
        const boosts = Array.isArray(inv.boosts) ? inv.boosts : [];
        const s = inv.services && typeof inv.services === 'object' ? inv.services : {};

        const power = computeShopPower(inv);
        const tier = getProfileTier(power);
        const collectorTier = rarityFromCollectiblesCount(collectibles.length);
        const activeTitle = inv.activeTitle ? String(inv.activeTitle) : 'لا يوجد';

        const totalBoosts = getTotalBoostSummary(activeBoosts);
        const totalBoostText = [
            totalBoosts.xp.active ? `- ⚡ XP: **+${totalBoosts.xp.pct}%**` : null,
            totalBoosts.luna.active ? `- 💰 Luna: **+${totalBoosts.luna.pct}%**` : null,
            totalBoosts.levelup.active ? `- 🏅 Level-Up: **+${totalBoosts.levelup.pct}%**` : null
        ].filter(Boolean).join('\n') || 'لا يوجد';

        const totalRoleXpMult = activeRoleBoosts.filter((b) => b.type === 'xp_boost' || (typeof b.type === 'string' && b.type.startsWith('xp_boost'))).reduce((m, b) => m * (b.multiplier || 1), 1);
        const totalRoleLunaMult = activeRoleBoosts.filter((b) => b.type === 'luna_boost' || (typeof b.type === 'string' && b.type.startsWith('luna_boost'))).reduce((m, b) => m * (b.multiplier || 1), 1);
        const totalRoleLevelupMult = activeRoleBoosts.filter((b) => b.type === 'levelup_reward_boost' || (typeof b.type === 'string' && b.type.startsWith('levelup_reward_boost'))).reduce((m, b) => m * (b.multiplier || 1), 1);
        const totalRoleBoostText = [
            totalRoleXpMult > 1 ? `- ⚡ XP: **+${Math.round((totalRoleXpMult - 1) * 100)}%**` : null,
            totalRoleLunaMult > 1 ? `- 💰 Luna: **+${Math.round((totalRoleLunaMult - 1) * 100)}%**` : null,
            totalRoleLevelupMult > 1 ? `- 🏅 Level-Up: **+${Math.round((totalRoleLevelupMult - 1) * 100)}%**` : null
        ].filter(Boolean).join('\n') || 'لا يوجد';

        const totalRuneBoosts = getTotalRuneSummary(equippedRunes);
        const totalRuneBoostText = [
            totalRuneBoosts.xp.active ? `- ⚡ XP: **+${totalRuneBoosts.xp.pct}%**` : null,
            totalRuneBoosts.luna.active ? `- 💰 Luna: **+${totalRuneBoosts.luna.pct}%**` : null,
            totalRuneBoosts.levelup.active ? `- 🏅 Level-Up: **+${totalRuneBoosts.levelup.pct}%**` : null
        ].filter(Boolean).join('\n') || 'لا يوجد';

        const activeBoostText = activeBoosts.length
            ? activeBoosts
                .slice(0, 5)
                .map((b) => {
                    const pct = boostPct(b);
                    const duration = b.expiresAt ? ` (${formatRemainingAr(b.expiresAt)})` : ' (دائم)';
                    return `- ${getBoostNameAr(b.type)} ${pct}${duration}`;
                })
                .join('\n')
            : 'لا يوجد';

        const collectiblesText = collectibles.length
            ? collectibles
                .slice(0, 8)
                .map((c) => `- ${(c.emoji || '🏅')} ${c.name || c.id}`)
                .join('\n')
            : 'لا يوجد';

        const servicesText = [
            `- 📝 تغيير اسم: **${UI.fmtNum(Math.max(0, Number(s.renameOnce) || 0))}**`,
            `- 🎯 نقل XP: **${UI.fmtNum(Math.max(0, Number(s.xpTransfer) || 0))}**`,
            `- 🛡️ Shield: **${UI.fmtNum(Math.max(0, Number(s.shield) || 0))}**`,
            `- 🔄 Rebalance: **${UI.fmtNum(Math.max(0, Number(s.rebalance) || 0))}**`,
            `- 👑 VIP Title: **${UI.fmtNum(Math.max(0, Number(s.vipTitle) || 0))}**`,
            `- 🎲 Reroll يومي: **${UI.fmtNum(Math.max(0, Number(s.rerollDaily) || 0))}**`
        ].join('\n');

        const ownershipBadges = [
            collectibles.some((c) => c && c.id === 'bundle_power') ? '🚀 باقة القوة' : null,
            collectibles.some((c) => c && c.id === 'flash_spark') ? '💎 عنصر محدود' : null,
            titles.some((t) => t && t.title === '🌙 رفيق/ة البدايات') ? '📦 باقة البداية' : null
        ].filter(Boolean);

        const embed = UI.embed({
            color: UI.COLORS.profile,
            author: { name: `${targetUser.username} — البروفايل` },
            thumbnail: targetUser.displayAvatarURL({ size: 256 }),
            footerText: 'طلبات المتجر والمقتنيات تنعكس هنا مباشرة',
            description:
                `> 🌙 **الرتبة الشخصية:** ${tier}\n` +
                `> ⚡ **Shop Power:** \`${UI.fmtNum(power)}\`\n` +
                `> 🎖️ **Collector Rank:** ${collectorTier}`,
            fields: [
                {
                    name: '🌙 التقدم',
                    value:
                        `${UI.progressBar(xp, nextXp, 12)}\n` +
                        `> ✨ XP: **${UI.fmtNum(xp)} / ${UI.fmtNum(nextXp)}**\n` +
                        `> 🎖️ المستوى: **${UI.fmtNum(lvl)}**\n` +
                        `> 🌙 Luna Points: **${UI.fmtNum(luna)}**`,
                    inline: true
                },
                {
                    name: '🎭 الحالة الحالية',
                    value:
                        `- اللقب النشط: **${activeTitle}**\n` +
                        `- ألقاب مملوكة: **${UI.fmtNum(titles.length)}**\n` +
                        `- رتب شكلية: **${UI.fmtNum(roles.length)}**`,
                    inline: true
                },
                {
                    name: '⚡ البوستات',
                    value:
                        `**الإجمالي المتراكم:**\n${totalBoostText}\n\n` +
                        `- غير مفعلة: **${UI.fmtNum(boosts.length)}**\n` +
                        `- نشطة: **${UI.fmtNum(activeBoosts.length)}**\n` +
                        `${activeBoostText}` +
                        (activeRoleBoosts.length
                            ? '\n**من الرتب (إجمالي متراكم):**\n' + totalRoleBoostText + '\n' + activeRoleBoosts.map((b) => `- <@&${b.roleId}> → ${boostsTypeName(b.type)} ${boostPct(b)}`).join('\n')
                            : '') +
                        (allRunes.length
                            ? '\n**🔮 الرونات:**\n' + (equippedRunes.length ? '**مجهزة (إجمالي متراكم):**\n' + totalRuneBoostText + '\n' + equippedRunes.map((r) => `- ${fmtRuneLine(r)} ✅`).join('\n') : 'ما فيه رونات مجهزة') + '\n' + (allRunes.length > equippedRunes.length ? `**غير مجهزة:**\n` + allRunes.filter((r) => !equippedRuneIds.includes(r.id)).slice(0, 5).map((r) => `- ${fmtRuneLine(r)}`).join('\n') : '')
                            : ''),
                    inline: false
                },
                {
                    name: '🎖️ المقتنيات (لها قيمة في البروفايل والتفاخر)',
                    value: collectiblesText,
                    inline: false
                },
                {
                    name: '🤝 الخدمات المتاحة',
                    value: servicesText,
                    inline: false
                },
                {
                    name: '🏷️ إنجازات المتجر',
                    value: ownershipBadges.length ? ownershipBadges.map((x) => `- ${x}`).join('\n') : 'لا يوجد',
                    inline: false
                }
            ]
        });

        const profileUrl = getProfileWebUrl(interaction.guild.id, targetUser.id);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('فتح صفحة البروفايل 🌐')
                .setStyle(ButtonStyle.Link)
                .setURL(profileUrl)
        );

        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }
};

