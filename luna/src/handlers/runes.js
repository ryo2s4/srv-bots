const {
    MessageFlags,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonStyle
} = require('discord.js');
const UI = require('../utils/ui');
const { getUserInventory, updateUserInventory } = require('../shopStore');
const { getLunaPoints, addLunaPoints, spendLunaPoints } = require('../levelsStore');
const {
    TIERS,
    TIER_LIST,
    getRuneBoosts,
    fmtPct,
    fmtRuneLine,
    getTotalRuneSummary,
    generateRuneForTier,
    getRuneValue,
    getRuneBuyPrice,
    getRerollPrice,
    rerollRune,
    REROLL_CAP,
    fuseRunes,
    FUSE_COST,
    getUpgradeCost,
    getUpgradeCap,
    getRuneStars,
    upgradeRune
} = require('../runes');

const MAX_EQUIPPED = 3;
const AR = {
    title: '🔮 الرونات',
    footer: '💰 **Luna Points** | 🎒 الرونات | ⬆️ الترقية',
    noRunes: 'ما عندك أي رونات!\nارفع مستواك عشان تحصلك رونات 3:',
    notYours: '❌ هذي الرونات مو مالك 3:',
    equip: 'تجهيز رونة',
    unequip: 'فك رونة',
    sellBtn: 'بيع رونة',
    buyBtn: 'شراء رونة',
    upgradeBtn: 'ترقية رونة',
    rerollBtn: 'إعادة تدوير',
    fuseBtn: 'دمج رونات'
};

function shortRuneLabel(rune) {
    const t = TIERS[rune.tier] || TIERS.common;
    const boosts = getRuneBoosts(rune);
    const parts = boosts.map((b) => fmtPct(b.multiplier));
    const stars = getRuneStars(rune);
    const starStr = stars > 0 ? ` ⭐${stars}` : '';
    return `${t.emoji} ${t.label}${starStr} ${parts.join('+')}`.slice(0, 100);
}

function sellOptionLabel(rune) {
    const t = TIERS[rune.tier] || TIERS.common;
    const boosts = getRuneBoosts(rune);
    const parts = boosts.map((b) => fmtPct(b.multiplier));
    const stars = getRuneStars(rune);
    const starStr = stars > 0 ? ` ⭐${stars}` : '';
    const value = getRuneValue(rune);
    return `${t.emoji} ${t.label}${starStr} (${parts.join('+')}) — 💰${value}`.slice(0, 100);
}

function upgradeOptionLabel(rune) {
    const t = TIERS[rune.tier] || TIERS.common;
    const boosts = getRuneBoosts(rune);
    const parts = boosts.map((b) => fmtPct(b.multiplier));
    const stars = getRuneStars(rune);
    const cap = getUpgradeCap(rune.tier);
    const cost = getUpgradeCost(rune);
    const costStr = cost != null ? `💰${cost}` : 'MAX';
    return `${t.emoji} ${t.label} ⭐${stars}/${cap} (${parts.join('+')}) — ${costStr}`.slice(0, 100);
}

function buildActionButtons(userId) {
    return UI.row(
        UI.btn(`runes:sell:menu:${userId}`, AR.sellBtn, { style: ButtonStyle.Danger, emoji: '💸' }),
        UI.btn(`runes:buy:menu:${userId}`, AR.buyBtn, { style: ButtonStyle.Primary, emoji: '🛒' }),
        UI.btn(`runes:upgrade:menu:${userId}`, AR.upgradeBtn, { style: ButtonStyle.Primary, emoji: '⬆️' }),
        UI.btn(`runes:reroll:menu:${userId}`, AR.rerollBtn, { style: ButtonStyle.Secondary, emoji: '🔁' }),
        UI.btn(`runes:fuse:menu:${userId}`, AR.fuseBtn, { style: ButtonStyle.Secondary, emoji: '🧬' })
    );
}

function buildRunesView(guildId, userId) {
    const inv = getUserInventory(guildId, userId);
    const runes = Array.isArray(inv.runes) ? inv.runes : [];
    const equipped = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
    const equippedRunes = runes.filter((r) => r && equipped.includes(r.id));
    const lunaPoints = getLunaPoints(guildId, userId);

    const totalLine = `> 📊 **${runes.length}** رونات مملوكة • **${equipped.length}/${MAX_EQUIPPED}** مجهزة • 💰 **${UI.fmtNum(lunaPoints)}** نقطة`;

    const rows = [];
    let embed;

    if (runes.length === 0) {
        embed = UI.embed({
            color: UI.COLORS.docs,
            title: AR.title,
            description: `${AR.noRunes}\n\n${totalLine}`,
            footerText: 'نظام الرونات'
        });
    } else {
        const sorted = runes.slice().sort((a, b) => {
            const aIdx = TIER_LIST.indexOf(a.tier);
            const bIdx = TIER_LIST.indexOf(b.tier);
            if (aIdx !== bIdx) return bIdx - aIdx;
            return (b.acquiredAt || 0) - (a.acquiredAt || 0);
        });

        const lines = sorted.slice(0, 25).map((r) => {
            const isEq = equipped.includes(r.id);
            const stars = getRuneStars(r);
            const starStr = stars > 0 ? ` ⭐${stars}` : '';
            return `${fmtRuneLine(r)}${starStr}${isEq ? ' ✅' : ''}  (\`${r.id}\`)`;
        });

        const totalRuneBoosts = getTotalRuneSummary(equippedRunes);
        const totalRuneBoostText = [
            totalRuneBoosts.xp.active ? `- ⚡ XP: **+${totalRuneBoosts.xp.pct}%**` : null,
            totalRuneBoosts.luna.active ? `- 💰 Luna: **+${totalRuneBoosts.luna.pct}%**` : null,
            totalRuneBoosts.levelup.active ? `- 🏅 Level-Up: **+${totalRuneBoosts.levelup.pct}%**` : null
        ].filter(Boolean).join('\n') || 'لا يوجد';

        embed = UI.embed({
            color: UI.COLORS.docs,
            title: AR.title,
            description: `${lines.join('\n')}\n\n${totalLine}`,
            fields: [
                equippedRunes.length > 0
                    ? { name: '⚡ التعزيزات المتراكمة من الرونات', value: totalRuneBoostText, inline: false }
                    : { name: '⚡ التعزيزات', value: 'جهّز رونات عشان تحصل تعزيزات!', inline: false }
            ],
            footerText: 'نظام الرونات'
        });

        const unequippable = equippedRunes.filter((r) => r && r.id);
        if (unequippable.length > 0) {
            const uneqSelect = new StringSelectMenuBuilder()
                .setCustomId(`runes:unequip:${userId}`)
                .setPlaceholder(AR.unequip)
                .addOptions(unequippable.slice(0, 25).map((r) => ({ label: shortRuneLabel(r), value: r.id })));
            rows.push(new ActionRowBuilder().addComponents(uneqSelect));
        }

        const unequippedRunes = runes.filter((r) => r && !equipped.includes(r.id));
        if (unequippedRunes.length > 0 && equipped.length < MAX_EQUIPPED) {
            const eqSelect = new StringSelectMenuBuilder()
                .setCustomId(`runes:equip:${userId}`)
                .setPlaceholder(AR.equip)
                .addOptions(unequippedRunes.slice(0, 25).map((r) => ({ label: shortRuneLabel(r), value: r.id })));
            rows.push(new ActionRowBuilder().addComponents(eqSelect));
        }
    }

    rows.push(buildActionButtons(userId));

    return { embeds: [embed], components: rows };
}

function buildSellMenu(guildId, userId) {
    const inv = getUserInventory(guildId, userId);
    const runes = Array.isArray(inv.runes) ? inv.runes : [];
    const equipped = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
    const lunaPoints = getLunaPoints(guildId, userId);

    if (runes.length === 0) {
        return {
            embeds: [
                UI.embed({
                    color: UI.COLORS.docs,
                    title: '💸 بيع رونة',
                    description: 'ما عندك أي رونات للبيع 3:',
                    footerText: 'الرونات'
                })
            ],
            components: [],
            ephemeral: true
        };
    }

    const sorted = runes.slice().sort((a, b) => {
        const aIdx = TIER_LIST.indexOf(a.tier);
        const bIdx = TIER_LIST.indexOf(b.tier);
        if (aIdx !== bIdx) return bIdx - aIdx;
        return (b.acquiredAt || 0) - (a.acquiredAt || 0);
    });

    const options = sorted.slice(0, 25).map((r) => {
        const isEq = equipped.includes(r.id);
        const value = getRuneValue(r);
        const desc = `${isEq ? '✅ مجهزة — راح تنفك تلقائياً' : 'غير مجهزة'} • بيع بـ ${value} نقطة`;
        return {
            label: sellOptionLabel(r),
            value: r.id,
            description: desc.slice(0, 100)
        };
    });

    const embed = UI.embed({
        color: UI.COLORS.docs,
        title: '💸 بيع رونة',
        description: [
            'اختر الرونة اللي تبي تبيعها من القائمة 👇',
            '',
            '⚠️ **ملاحظة:** لو الرونة مجهزة راح تنفك تلقائياً قبل البيع.',
            '',
            `> 💰 **رصيدك الحالي:** ${UI.fmtNum(lunaPoints)} نقطة`
        ].join('\n'),
        footerText: 'الرونات'
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId(`runes:sell:select:${userId}`)
        .setPlaceholder('اختر رونة للبيع...')
        .addOptions(options);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true
    };
}

function buildBuyMenu(guildId, userId) {
    const lunaPoints = getLunaPoints(guildId, userId);

    const options = TIER_LIST.map((tier) => {
        const t = TIERS[tier];
        if (!t) return null;
        const price = getRuneBuyPrice(tier);
        const desc = `سعر: ${price} نقطة`;
        return {
            label: `${t.emoji} ${t.label} — 💰${price}`,
            value: tier,
            description: desc.slice(0, 100)
        };
    }).filter(Boolean);

    const embed = UI.embed({
        color: UI.COLORS.docs,
        title: '🛒 شراء رونة',
        description: [
            'اختر الطبقة اللي تبي تشتري منها رونة عشوائية 👇',
            '',
            '🎲 الرونة المولّدة تتبع نفس قواعد الرونات العادية (نوع واحد أو ثنائي، مضاعفات عشوائية).',
            '',
            `> 💰 **رصيدك الحالي:** ${UI.fmtNum(lunaPoints)} نقطة`
        ].join('\n'),
        footerText: 'الرونات'
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId(`runes:buy:select:${userId}`)
        .setPlaceholder('اختر طبقة للشراء...')
        .addOptions(options);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true
    };
}

function buildUpgradeMenu(guildId, userId) {
    const inv = getUserInventory(guildId, userId);
    const runes = Array.isArray(inv.runes) ? inv.runes : [];
    const lunaPoints = getLunaPoints(guildId, userId);

    const upgradable = runes.filter((r) => {
        if (!r) return false;
        const cap = getUpgradeCap(r.tier);
        return getRuneStars(r) < cap;
    });

    if (upgradable.length === 0) {
        return {
            embeds: [
                UI.embed({
                    color: UI.COLORS.docs,
                    title: '⬆️ ترقية رونة',
                    description: 'ما عندك أي رونات قابلة للترقية (كلها وصلت الحد الأقصى) 3:',
                    footerText: 'الرونات'
                })
            ],
            components: [],
            ephemeral: true
        };
    }

    const sorted = upgradable.slice().sort((a, b) => {
        const aIdx = TIER_LIST.indexOf(a.tier);
        const bIdx = TIER_LIST.indexOf(b.tier);
        if (aIdx !== bIdx) return bIdx - aIdx;
        return (b.acquiredAt || 0) - (a.acquiredAt || 0);
    });

    const options = sorted.slice(0, 25).map((r) => {
        const cost = getUpgradeCost(r);
        const desc = `تكلفة الترقية: ${cost != null ? cost + ' نقطة' : 'MAX'}`;
        return {
            label: upgradeOptionLabel(r),
            value: r.id,
            description: desc.slice(0, 100)
        };
    });

    const embed = UI.embed({
        color: UI.COLORS.docs,
        title: '⬆️ ترقية رونة',
        description: [
            'اختر الرونة اللي تبي ترقيها 👇',
            '',
            '> ⭐ كل ترقية = نجمة إضافية.',
            '> 💸 التكلفة: `200 + (مؤشر الطبقة × 100) + (النجوم الحالية × 150)`.',
            '📈 التعزيزات تزيد +5% إلى +15% لكل ترقية.',
            '',
            `> 💰 **رصيدك الحالي:** ${UI.fmtNum(lunaPoints)} نقطة`
        ].join('\n'),
        footerText: 'الرونات'
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId(`runes:upgrade:select:${userId}`)
        .setPlaceholder('اختر رونة للترقية...')
        .addOptions(options);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true
    };
}

function buildUpgradeConfirm(rune, userId) {
    const t = TIERS[rune.tier] || TIERS.common;
    const stars = getRuneStars(rune);
    const cap = getUpgradeCap(rune.tier);
    const cost = getUpgradeCost(rune);
    const boosts = getRuneBoosts(rune);

    const previewLines = boosts.map((b) => {
        const name = { xp_boost: 'XP', luna_boost: 'Luna', levelup_reward_boost: 'Level-Up' }[b.type] || b.type;
        const cur = Number(b.multiplier) || 1;
        const minNext = cur + 0.05;
        const maxNext = cur + 0.15;
        return `• ${name}: ${fmtPct(cur)} → **${fmtPct(minNext)} – ${fmtPct(maxNext)}**`;
    }).join('\n');

    const embed = UI.embed({
        color: UI.COLORS.docs,
        title: '⬆️ تأكيد ترقية الرونة',
        description: [
            `**${t.emoji} ${t.label}** — ⭐ ${stars}/${cap}`,
            '',
            `> 🧩 **التعزيزات الحالية:** ${boosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`,
            '',
            '📈 **توقعات الترقية:**',
            previewLines,
            '',
            `> 💰 **التكلفة:** ${UI.fmtNum(cost)} نقطة`,
            '',
            'متأكد تبي ترقيها؟'
        ].join('\n'),
        footerText: 'الرونات'
    });

    const row = UI.row(
        UI.btn(`runes:upgrade:confirm:${userId}:${rune.id}`, 'ترقية ✅', { style: ButtonStyle.Danger }),
        UI.btn(`runes:upgrade:cancel:${userId}`, 'إلغاء', { style: ButtonStyle.Secondary })
    );

    return {
        embeds: [embed],
        components: [row],
        ephemeral: true
    };
}

function isOwner(interaction, ownerId) {
    return String(interaction.user.id) === String(ownerId);
}

function rerollOptionLabel(rune) {
    const t = TIERS[rune.tier] || TIERS.common;
    const boosts = getRuneBoosts(rune);
    const parts = boosts.map((b) => fmtPct(b.multiplier));
    const stars = getRuneStars(rune);
    const starStr = stars > 0 ? ` ⭐${stars}` : '';
    const price = getRerollPrice(rune.tier);
    const left = Math.max(0, REROLL_CAP - (Number(rune.rerolls) || 0));
    return `${t.emoji} ${t.label}${starStr} (${parts.join('+')}) — 🔁${price} • ${left}/${REROLL_CAP}`.slice(0, 100);
}

function buildRerollMenu(guildId, userId) {
    const inv = getUserInventory(guildId, userId);
    const runes = Array.isArray(inv.runes) ? inv.runes : [];
    const lunaPoints = getLunaPoints(guildId, userId);

    if (runes.length === 0) {
        return {
            embeds: [
                UI.embed({
                    color: UI.COLORS.docs,
                    title: '🔁 إعادة تدوير رونة',
                    description: 'ما عندك أي رونات لإعادة التدوير 3:',
                    footerText: 'الرونات'
                })
            ],
            components: []
        };
    }

    const sorted = runes.slice().sort((a, b) => {
        const aIdx = TIER_LIST.indexOf(a.tier);
        const bIdx = TIER_LIST.indexOf(b.tier);
        if (aIdx !== bIdx) return bIdx - aIdx;
        return (b.acquiredAt || 0) - (a.acquiredAt || 0);
    });

    const options = sorted.slice(0, 25).map((r) => {
        const price = getRerollPrice(r.tier);
        const left = Math.max(0, REROLL_CAP - (Number(r.rerolls) || 0));
        return {
            label: rerollOptionLabel(r),
            value: r.id,
            disabled: left === 0,
            description: (left === 0
                ? 'وصلت الحد الأقصى لإعادة التدوير 3:'
                : `تتغير التعزيزات عشوائياً • التكلفة ${price} نقطة`).slice(0, 100)
        };
    });

    const embed = UI.embed({
        color: UI.COLORS.docs,
        title: '🔁 إعادة تدوير رونة',
        description: [
            'اختر الرونة اللي تبي تعيد تدوير تعزيزاتها 👇',
            '',
            '🎲 **الفكرة:** نفس الطبقة والنجوم، بس التعزيزات (النوع + المضاعف) تتولد من جديد!',
            '⚠️ التعزيزات القديمة تروح — ممكن تطلع أقوى أو أضعف.',
            '',
            `> 💰 **رصيدك الحالي:** ${UI.fmtNum(lunaPoints)} نقطة`
        ].join('\n'),
        footerText: 'الرونات'
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId(`runes:reroll:select:${userId}`)
        .setPlaceholder('اختر رونة لإعادة التدوير...')
        .addOptions(options);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)]
    };
}

function buildRerollConfirm(rune, userId) {
    const t = TIERS[rune.tier] || TIERS.common;
    const stars = getRuneStars(rune);
    const cap = getUpgradeCap(rune.tier);
    const price = getRerollPrice(rune.tier);
    const boosts = getRuneBoosts(rune);

    const embed = UI.embed({
        color: UI.COLORS.docs,
        title: '🔁 تأكيد إعادة التدوير',
        description: [
            `**${t.emoji} ${t.label}** — ⭐ ${stars}/${cap}`,
            '',
            `> 🧩 **التعزيزات الحالية:** ${boosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`,
            '',
            `> 💰 **التكلفة:** ${UI.fmtNum(price)} نقطة`,
            '🎲 التعزيزات الجديدة تتولد عشوائياً (نوع واحد أو ثنائي حسب الطبقة).',
            '',
            'متأكد تبي تعيد التدوير؟'
        ].join('\n'),
        footerText: 'الرونات'
    });

    const row = UI.row(
        UI.btn(`runes:reroll:confirm:${userId}:${rune.id}`, 'إعادة التدوير ✅', { style: ButtonStyle.Danger }),
        UI.btn(`runes:reroll:cancel:${userId}`, 'إلغاء', { style: ButtonStyle.Secondary })
    );

    return {
        embeds: [embed],
        components: [row]
    };
}

function buildFuseMenu(guildId, userId) {
    const inv = getUserInventory(guildId, userId);
    const runes = Array.isArray(inv.runes) ? inv.runes : [];
    const lunaPoints = getLunaPoints(guildId, userId);

    // Group by tier for guidance
    const byTier = {};
    for (const r of runes) {
        if (!r || !r.tier) continue;
        byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    }
    const tierLines = TIER_LIST.map((tier) => {
        const t = TIERS[tier];
        const count = byTier[tier] || 0;
        return `${t.emoji} ${t.label}: **${count}**${count >= 3 ? ' ✅' : ''}`;
    }).join('\n');

    if (runes.length < 3) {
        return {
            embeds: [
                UI.embed({
                    color: UI.COLORS.docs,
                    title: '🧬 دمج رونات',
                    description: [
                        'الدمج يحتاج **3 رونات من نفس الطبقة**.',
                        '',
                        tierLines,
                        '',
                        `عندك حالياً **${runes.length}** رونات فقط — تحتاج 3 على الأقل 3:`
                    ].join('\n'),
                    footerText: 'الرونات'
                })
            ],
            components: []
        };
    }

    const sorted = runes.slice().sort((a, b) => {
        const aIdx = TIER_LIST.indexOf(a.tier);
        const bIdx = TIER_LIST.indexOf(b.tier);
        if (aIdx !== bIdx) return aIdx - bIdx; // group same tiers together
        return (a.acquiredAt || 0) - (b.acquiredAt || 0);
    });

    const options = sorted.slice(0, 25).map((r) => {
        const t = TIERS[r.tier] || TIERS.common;
        const boosts = getRuneBoosts(r);
        return {
            label: rerollOptionLabel(r).replace(/ — .*$/, ''),
            value: r.id,
            description: `${t.label} • ${boosts.map((b) => fmtPct(b.multiplier)).join('+')}`.slice(0, 100)
        };
    });

    const embed = UI.embed({
        color: UI.COLORS.docs,
        title: '🧬 دمج رونات',
        description: [
            'اختر **3 رونات من نفس الطبقة** لدمجها 👇',
            '',
            '⬆️ **3 رونات** → رونة واحدة من **الطبقة الأعلى** (بحظ أعلى!).',
            '🔴 دمج 3 رونات من أعلى طبقة (خرافي) → **ترقية نجمة + تقوية** للرونة الأقوى.',
            `💸 تكلفة الدمج: **${UI.fmtNum(FUSE_COST)}** نقطة`,
            '',
            tierLines,
            '',
            `> 💰 **رصيدك الحالي:** ${UI.fmtNum(lunaPoints)} نقطة`
        ].join('\n'),
        footerText: 'الرونات'
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId(`runes:fuse:select:${userId}`)
        .setPlaceholder('اختر 3 رونات من نفس الطبقة...')
        .setMinValues(3)
        .setMaxValues(3)
        .addOptions(options);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)]
    };
}

async function denyNotOwner(interaction) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.followUp({ content: AR.notYours, flags: MessageFlags.Ephemeral });
        }
        return await interaction.reply({ content: AR.notYours, flags: MessageFlags.Ephemeral });
    } catch {
        return null;
    }
}

function safeDeferUpdate(interaction) {
    try {
        return interaction.deferUpdate();
    } catch {
        return null;
    }
}

async function editMainView(interaction) {
    const payload = buildRunesView(interaction.guild.id, interaction.user.id);
    try {
        return await interaction.editReply(payload);
    } catch {
        return null;
    }
}

async function followUpEphemeral(interaction, payload) {
    try {
        // Select-menu/button interactions that haven't been acknowledged yet need reply(), not followUp()
        if (interaction.deferred || interaction.replied) {
            return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
        }
        return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch {
        return null;
    }
}

// --- Action handlers (return true if handled) ---

async function handleEquip(interaction, ownerId, value) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    await safeDeferUpdate(interaction);
    updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
        const next = { ...cur };
        const equipped = Array.isArray(next.equippedRuneIds) ? [...next.equippedRuneIds] : [];
        if (equipped.length >= MAX_EQUIPPED) return cur;
        if (!equipped.includes(value)) equipped.push(value);
        next.equippedRuneIds = equipped;
        return next;
    });
    await editMainView(interaction);
    return true;
}

async function handleUnequip(interaction, ownerId, value) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    await safeDeferUpdate(interaction);
    updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
        const next = { ...cur };
        const equipped = Array.isArray(next.equippedRuneIds) ? [...next.equippedRuneIds] : [];
        next.equippedRuneIds = equipped.filter((id) => id !== value);
        return next;
    });
    await editMainView(interaction);
    return true;
}

async function handleSellMenu(interaction, ownerId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    const payload = buildSellMenu(interaction.guild.id, interaction.user.id);
    delete payload.ephemeral;
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return true;
}

async function handleSellSelect(interaction, ownerId, runeId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    await safeDeferUpdate(interaction);

    let soldRune = null;
    let value = 0;
    let found = false;

    updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
        const next = { ...cur };
        const runes = Array.isArray(next.runes) ? [...next.runes] : [];
        const idx = runes.findIndex((r) => r && r.id === runeId);
        if (idx < 0) {
            // Rune not found — return current as-is.
            return cur;
        }
        found = true;
        const target = runes[idx];
        // Unequip first if needed
        const equipped = Array.isArray(next.equippedRuneIds) ? next.equippedRuneIds.filter((id) => id !== runeId) : [];
        next.equippedRuneIds = equipped;
        // Remove rune
        runes.splice(idx, 1);
        next.runes = runes;
        // Calculate sell value based on the removed rune
        soldRune = target;
        value = getRuneValue(target);
        return next;
    });

    if (!found || !soldRune) {
        await followUpEphemeral(interaction, { content: '❌ ما لقيت الرونة هذي 3:' });
        return true;
    }

    if (value > 0) {
        addLunaPoints(interaction.guild.id, interaction.user.id, value);
    }

    const t = TIERS[soldRune.tier] || TIERS.common;
    const stars = getRuneStars(soldRune);

    await followUpEphemeral(interaction, {
        embeds: [
            UI.success([
                `بعنا الرونة **${t.emoji} ${t.label}${stars > 0 ? ` ⭐${stars}` : ''}**`,
                '',
                `> 💰 **حصلت على:** +${UI.fmtNum(value)} نقطة`,
                `> 💳 **رصيدك الجديد:** ${UI.fmtNum(getLunaPoints(interaction.guild.id, interaction.user.id))} نقطة`
            ].join('\n'), { title: '✅ تم البيع', footerText: 'الرونات' })
        ]
    });

    await editMainView(interaction);
    return true;
}

async function handleBuyMenu(interaction, ownerId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    const payload = buildBuyMenu(interaction.guild.id, interaction.user.id);
    delete payload.ephemeral;
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return true;
}

async function handleBuySelect(interaction, ownerId, tier) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    if (!TIERS[tier]) {
        await followUpEphemeral(interaction, { content: '❌ طبقة غير صحيحة 3:' });
        return true;
    }
    const price = getRuneBuyPrice(tier);
    const balance = getLunaPoints(interaction.guild.id, interaction.user.id);
    if (balance < price) {
        await followUpEphemeral(interaction, {
            embeds: [
                UI.error([
                    `السعر: **${UI.fmtNum(price)}** نقطة`,
                    `> 💰 **رصيدك:** ${UI.fmtNum(balance)} نقطة`,
                    '',
                    'فش رصيد يكفي للشراء 3:'
                ].join('\n'), { title: '❌ ما فيه رصيد كافي', footerText: 'الرونات' })
            ]
        });
        return true;
    }

    await safeDeferUpdate(interaction);

    const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, price);
    if (!spend || !spend.ok) {
        await followUpEphemeral(interaction, { content: '❌ العملية فشلت، حاول مرة ثانية 3:' });
        return true;
    }

    const newRune = generateRuneForTier(tier);
    let added = false;
    updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
        const next = { ...cur };
        const runes = Array.isArray(next.runes) ? [...next.runes] : [];
        runes.push(newRune);
        next.runes = runes;
        added = true;
        return next;
    });

    if (!added) {
        // Roll back spend
        addLunaPoints(interaction.guild.id, interaction.user.id, price);
        await followUpEphemeral(interaction, { content: '❌ العملية فشلت، حاول مرة ثانية 3:' });
        return true;
    }

    const t = TIERS[tier] || TIERS.common;
    const boosts = getRuneBoosts(newRune);
    const newBalance = getLunaPoints(interaction.guild.id, interaction.user.id);

    await followUpEphemeral(interaction, {
        embeds: [
            UI.success([
                `اشتريت رونة جديدة **${t.emoji} ${t.label}**`,
                '',
                `> 🎁 **التعزيزات:** ${boosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`,
                `> 💸 **المدفوع:** ${UI.fmtNum(price)} نقطة`,
                `> 💳 **رصيدك الجديد:** ${UI.fmtNum(newBalance)} نقطة`,
                '',
                `🆔 ${newRune.id}`
            ].join('\n'), { title: '✅ تم الشراء', footerText: 'الرونات' })
        ]
    });

    await editMainView(interaction);
    return true;
}

async function handleUpgradeMenu(interaction, ownerId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    const payload = buildUpgradeMenu(interaction.guild.id, interaction.user.id);
    delete payload.ephemeral;
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return true;
}

async function handleUpgradeSelect(interaction, ownerId, runeId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    const inv = getUserInventory(interaction.guild.id, interaction.user.id);
    const rune = (Array.isArray(inv.runes) ? inv.runes : []).find((r) => r && r.id === runeId);
    if (!rune) {
        await followUpEphemeral(interaction, { content: '❌ ما لقيت الرونة هذي 3:' });
        return true;
    }
    const cost = getUpgradeCost(rune);
    if (cost == null) {
        await followUpEphemeral(interaction, { content: '❌ هذي الرونة وصلت الحد الأقصى من النجوم 3:' });
        return true;
    }
    const balance = getLunaPoints(interaction.guild.id, interaction.user.id);
    if (balance < cost) {
        const t = TIERS[rune.tier] || TIERS.common;
        await followUpEphemeral(interaction, {
            embeds: [
                UI.error([
                    `الترقية تكلف **${UI.fmtNum(cost)}** نقطة`,
                    `> 💰 **رصيدك:** ${UI.fmtNum(balance)} نقطة`,
                    '',
                    `الرونة: **${t.emoji} ${t.label}** ⭐ ${getRuneStars(rune)}/${getUpgradeCap(rune.tier)}`
                ].join('\n'), { title: '❌ ما فيه رصيد كافي', footerText: 'الرونات' })
            ]
        });
        return true;
    }
    const payload = buildUpgradeConfirm(rune, interaction.user.id);
    await followUpEphemeral(interaction, payload);
    return true;
}

async function handleUpgradeConfirm(interaction, ownerId, runeId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    await safeDeferUpdate(interaction);

    const inv = getUserInventory(interaction.guild.id, interaction.user.id);
    const rune = (Array.isArray(inv.runes) ? inv.runes : []).find((r) => r && r.id === runeId);
    if (!rune) {
        await followUpEphemeral(interaction, { content: '❌ ما لقيت الرونة هذي 3:' });
        return true;
    }
    const cost = getUpgradeCost(rune);
    if (cost == null) {
        await followUpEphemeral(interaction, { content: '❌ هذي الرونة وصلت الحد الأقصى من النجوم 3:' });
        return true;
    }
    const balance = getLunaPoints(interaction.guild.id, interaction.user.id);
    if (balance < cost) {
        await followUpEphemeral(interaction, {
            embeds: [
                UI.error([
                    `الترقية تكلف **${UI.fmtNum(cost)}** نقطة`,
                    `> 💰 **رصيدك:** ${UI.fmtNum(balance)} نقطة`
                ].join('\n'), { title: '❌ ما فيه رصيد كافي', footerText: 'الرونات' })
            ]
        });
        return true;
    }

    // Spend first
    const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, cost);
    if (!spend || !spend.ok) {
        await followUpEphemeral(interaction, { content: '❌ العملية فشلت، حاول مرة ثانية 3:' });
        return true;
    }

    const result = upgradeRune(rune);
    if (!result || !result.ok) {
        // Refund
        addLunaPoints(interaction.guild.id, interaction.user.id, cost);
        await followUpEphemeral(interaction, { content: '❌ الترقية فشلت، حاول مرة ثانية 3:' });
        return true;
    }

    let written = false;
    updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
        const next = { ...cur };
        const runes = Array.isArray(next.runes) ? [...next.runes] : [];
        const idx = runes.findIndex((r) => r && r.id === runeId);
        if (idx < 0) return cur;
        runes[idx] = result.rune;
        next.runes = runes;
        written = true;
        return next;
    });

    if (!written) {
        // Refund
        addLunaPoints(interaction.guild.id, interaction.user.id, cost);
        await followUpEphemeral(interaction, { content: '❌ ما قدرت ألقى الرونة، رجّعت لك النقاط 3:' });
        return true;
    }

    const t = TIERS[result.rune.tier] || TIERS.common;
    const newBoosts = getRuneBoosts(result.rune);
    const newBalance = getLunaPoints(interaction.guild.id, interaction.user.id);

    await followUpEphemeral(interaction, {
        embeds: [
            UI.success([
                `${t.emoji} **${t.label}** — ⭐ ${result.newStars}/${result.cap}`,
                '',
                `> 📈 **التعزيزات الجديدة:** ${newBoosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`,
                `> 💸 **التكلفة:** ${UI.fmtNum(cost)} نقطة`,
                `> 💳 **رصيدك الجديد:** ${UI.fmtNum(newBalance)} نقطة`
            ].join('\n'), { title: '✅ تمت الترقية', footerText: 'الرونات' })
        ]
    });

    await editMainView(interaction);
    return true;
}

async function handleUpgradeCancel(interaction, ownerId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    try {
        await interaction.message.delete();
    } catch {
        try {
            await interaction.update({ components: [] });
        } catch {
            // ignore
        }
    }
    return true;
}

async function handleRerollMenu(interaction, ownerId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    const payload = buildRerollMenu(interaction.guild.id, interaction.user.id);
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return true;
}

async function handleRerollSelect(interaction, ownerId, runeId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    const inv = getUserInventory(interaction.guild.id, interaction.user.id);
    const rune = (Array.isArray(inv.runes) ? inv.runes : []).find((r) => r && r.id === runeId);
    if (!rune) {
        await followUpEphemeral(interaction, { content: '❌ ما لقيت الرونة هذي 3:' });
        return true;
    }
    const price = getRerollPrice(rune.tier);
    const balance = getLunaPoints(interaction.guild.id, interaction.user.id);
    if (price == null) {
        await followUpEphemeral(interaction, { content: '❌ ما أقدر أعيد تدوير هذي الرونة 3:' });
        return true;
    }
    if (balance < price) {
        const t = TIERS[rune.tier] || TIERS.common;
        await followUpEphemeral(interaction, {
            embeds: [
                UI.error([
                    `إعادة التدوير تكلف **${UI.fmtNum(price)}** نقطة`,
                    `> 💰 **رصيدك:** ${UI.fmtNum(balance)} نقطة`,
                    '',
                    `الرونة: **${t.emoji} ${t.label}**`
                ].join('\n'), { title: '❌ ما فيه رصيد كافي', footerText: 'الرونات' })
            ]
        });
        return true;
    }
    const payload = buildRerollConfirm(rune, interaction.user.id);
    await followUpEphemeral(interaction, payload);
    return true;
}

async function handleRerollConfirm(interaction, ownerId, runeId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    await safeDeferUpdate(interaction);

    const inv = getUserInventory(interaction.guild.id, interaction.user.id);
    const rune = (Array.isArray(inv.runes) ? inv.runes : []).find((r) => r && r.id === runeId);
    if (!rune) {
        await followUpEphemeral(interaction, { content: '❌ ما لقيت الرونة هذي 3:' });
        return true;
    }

    const price = getRerollPrice(rune.tier);
    if (price == null) {
        await followUpEphemeral(interaction, { content: '❌ ما أقدر أعيد تدوير هذي الرونة 3:' });
        return true;
    }

    const balance = getLunaPoints(interaction.guild.id, interaction.user.id);
    if (balance < price) {
        await followUpEphemeral(interaction, {
            embeds: [
                UI.error([
                    `إعادة التدوير تكلف **${UI.fmtNum(price)}** نقطة`,
                    `> 💰 **رصيدك:** ${UI.fmtNum(balance)} نقطة`
                ].join('\n'), { title: '❌ ما فيه رصيد كافي', footerText: 'الرونات' })
            ]
        });
        return true;
    }

    const oldBoosts = getRuneBoosts(rune);
    const result = rerollRune(rune);
    if (!result || !result.ok) {
        if (result && result.reason === 'reroll_cap') {
            await followUpEphemeral(interaction, {
                embeds: [
                    UI.error([
                        `هذي الرونة وصلت الحد الأقصى لإعادة التدوير (**${REROLL_CAP}** مرات).`,
                        '> ما تقدر تعيد تدويرها مرة ثانية 3:'
                    ].join('\n'), { title: '🔁 الحد الأقصى', footerText: 'الرونات' })
                ]
            });
            return true;
        }
        await followUpEphemeral(interaction, { content: '❌ إعادة التدوير فشلت، حاول مرة ثانية 3:' });
        return true;
    }

    const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, price);
    if (!spend || !spend.ok) {
        await followUpEphemeral(interaction, { content: '❌ العملية فشلت، حاول مرة ثانية 3:' });
        return true;
    }

    let written = false;
    updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
        const next = { ...cur };
        const runes = Array.isArray(next.runes) ? [...next.runes] : [];
        const idx = runes.findIndex((r) => r && r.id === runeId);
        if (idx < 0) return cur;
        runes[idx] = result.rune;
        next.runes = runes;
        written = true;
        return next;
    });

    if (!written) {
        addLunaPoints(interaction.guild.id, interaction.user.id, price);
        await followUpEphemeral(interaction, { content: '❌ ما قدرت ألقى الرونة، رجّعت لك النقاط 3:' });
        return true;
    }

    const t = TIERS[result.rune.tier] || TIERS.common;
    const newBoosts = getRuneBoosts(result.rune);
    const newBalance = getLunaPoints(interaction.guild.id, interaction.user.id);

    await followUpEphemeral(interaction, {
        embeds: [
            UI.success([
                `${t.emoji} **${t.label}**`,
                '',
                `> 🔄 **قبل:** ${oldBoosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`,
                `> ✨ **بعد:** ${newBoosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`,
                '',
                `> 💸 **التكلفة:** ${UI.fmtNum(price)} نقطة`,
                `> 💳 **رصيدك الجديد:** ${UI.fmtNum(newBalance)} نقطة`
            ].join('\n'), { title: '✅ تمت إعادة التدوير', footerText: 'الرونات' })
        ]
    });

    await editMainView(interaction);
    return true;
}

async function handleFuseMenu(interaction, ownerId) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    const payload = buildFuseMenu(interaction.guild.id, interaction.user.id);
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return true;
}

async function handleFuseSelect(interaction, ownerId, runeIds) {
    if (!isOwner(interaction, ownerId)) { await denyNotOwner(interaction); return true; }
    await safeDeferUpdate(interaction);

    const inv = getUserInventory(interaction.guild.id, interaction.user.id);
    const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
    const selected = runeIds
        .map((id) => allRunes.find((r) => r && r.id === id))
        .filter(Boolean);

    if (selected.length !== 3) {
        await followUpEphemeral(interaction, { content: '❌ لازم تختار 3 رونات بالضبط 3:' });
        return true;
    }

    const tiers = new Set(selected.map((r) => r.tier));
    if (tiers.size !== 1) {
        await followUpEphemeral(interaction, {
            embeds: [
                UI.error('الدمج لازم يكون بين **3 رونات من نفس الطبقة** 3:', {
                    title: '❌ طبقات مختلفة',
                    footerText: 'الرونات'
                })
            ]
        });
        return true;
    }

    const balance = getLunaPoints(interaction.guild.id, interaction.user.id);
    if (balance < FUSE_COST) {
        await followUpEphemeral(interaction, {
            embeds: [
                UI.error([
                    `الدمج يكلف **${UI.fmtNum(FUSE_COST)}** نقطة`,
                    `> 💰 **رصيدك:** ${UI.fmtNum(balance)} نقطة`
                ].join('\n'), { title: '❌ ما فيه رصيد كافي', footerText: 'الرونات' })
            ]
        });
        return true;
    }

    const result = fuseRunes(selected);
    if (!result || !result.ok) {
        const reasonMsg = result && result.reason === 'max_stars'
            ? '❌ الرونة المختارة وصلت أعلى عدد نجوم — الدمج ما يضيف لها شيء 3:'
            : '❌ الدمج فشل، حاول مرة ثانية 3:';
        await followUpEphemeral(interaction, { content: reasonMsg });
        return true;
    }

    const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, FUSE_COST);
    if (!spend || !spend.ok) {
        await followUpEphemeral(interaction, { content: '❌ العملية فشلت، حاول مرة ثانية 3:' });
        return true;
    }

    const consumedIds = new Set(selected.map((r) => r.id));
    let written = false;
    updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
        const next = { ...cur };
        const runes = (Array.isArray(next.runes) ? next.runes : []).filter((r) => r && !consumedIds.has(r.id));
        runes.push(result.rune);
        next.runes = runes;
        const equipped = Array.isArray(next.equippedRuneIds) ? next.equippedRuneIds.filter((id) => !consumedIds.has(id)) : [];
        next.equippedRuneIds = equipped;
        written = true;
        return next;
    });

    if (!written) {
        addLunaPoints(interaction.guild.id, interaction.user.id, FUSE_COST);
        await followUpEphemeral(interaction, { content: '❌ العملية فشلت، رجّعت لك النقاط 3:' });
        return true;
    }

    const t = TIERS[result.rune.tier] || TIERS.common;
    const boosts = getRuneBoosts(result.rune);
    const stars = getRuneStars(result.rune);
    const newBalance = getLunaPoints(interaction.guild.id, interaction.user.id);

    const resultLine = result.mode === 'empower'
        ? `💎 رونتك الأقوى انترقت: **${t.emoji} ${t.label}** ${stars > 0 ? `⭐${stars}` : ''}\n✨ التعزيزات: ${boosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`
        : `⬆️ طلعنا رونة من **الطبقة الأعلى**: **${t.emoji} ${t.label}**\n✨ التعزيزات: ${boosts.map((b) => fmtPct(b.multiplier)).join(' + ')}`;

    const consumedTierLabel = (TIERS[selected[0].tier] || {}).label || '';

    await followUpEphemeral(interaction, {
        embeds: [
            UI.success([
                resultLine,
                '',
                `> 🔥 **اندمجت 3 رونات من طبقة:** ${consumedTierLabel}`,
                `> 💸 **التكلفة:** ${UI.fmtNum(FUSE_COST)} نقطة`,
                `> 💳 **رصيدك الجديد:** ${UI.fmtNum(newBalance)} نقطة`
            ].join('\n'), { title: '✅ تم الدمج', footerText: 'الرونات' })
        ]
    });

    await editMainView(interaction);
    return true;
}

async function handle({ client, interaction }) {
    if (!interaction.guild) return false;

    // Accept both StringSelectMenu and Button interactions
    if (!(interaction.isStringSelectMenu() || interaction.isButton())) return false;
    if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith('runes:')) return false;

    const parts = interaction.customId.split(':');
    // Format: runes:<action>[:<subaction>]:<userId>[:<extra>]
    // e.g. runes:equip:UID
    //      runes:unequip:UID
    //      runes:sell:menu:UID
    //      runes:sell:select:UID
    //      runes:buy:menu:UID
    //      runes:buy:select:UID
    //      runes:upgrade:menu:UID
    //      runes:upgrade:select:UID
    //      runes:upgrade:confirm:UID:RUNE_ID
    //      runes:upgrade:cancel:UID
    if (parts.length < 3) return false;

    const action = parts[1];

    // Upgrade-confirm has 5 segments, others vary
    if (action === 'upgrade' && parts[2] === 'confirm') {
        if (parts.length < 5) return false;
        const ownerId = parts[3];
        const runeId = parts.slice(4).join(':');
        return await handleUpgradeConfirm(interaction, ownerId, runeId);
    }

    if (action === 'upgrade' && parts[2] === 'cancel') {
        if (parts.length < 4) return false;
        const ownerId = parts[3];
        return await handleUpgradeCancel(interaction, ownerId);
    }

    if (action === 'reroll' && parts[2] === 'confirm') {
        if (parts.length < 5) return false;
        const ownerId = parts[3];
        const runeId = parts.slice(4).join(':');
        return await handleRerollConfirm(interaction, ownerId, runeId);
    }

    if (action === 'reroll' && parts[2] === 'cancel') {
        if (parts.length < 4) return false;
        const ownerId = parts[3];
        return await handleUpgradeCancel(interaction, ownerId);
    }

    if (action === 'sell' || action === 'buy' || action === 'upgrade' || action === 'reroll' || action === 'fuse') {
        if (parts.length < 4) return false;
        const subaction = parts[2]; // menu | select
        const ownerId = parts[3];
        if (subaction === 'menu') {
            if (action === 'sell') return await handleSellMenu(interaction, ownerId);
            if (action === 'buy') return await handleBuyMenu(interaction, ownerId);
            if (action === 'upgrade') return await handleUpgradeMenu(interaction, ownerId);
            if (action === 'reroll') return await handleRerollMenu(interaction, ownerId);
            if (action === 'fuse') return await handleFuseMenu(interaction, ownerId);
            return false;
        }
        if (subaction === 'select') {
            if (!interaction.isStringSelectMenu()) return false;
            const value = interaction.values && interaction.values[0];
            if (action === 'fuse') {
                const values = Array.isArray(interaction.values) ? interaction.values : [];
                if (values.length !== 3) return true;
                return await handleFuseSelect(interaction, ownerId, values);
            }
            if (!value) return true;
            if (action === 'sell') return await handleSellSelect(interaction, ownerId, value);
            if (action === 'buy') return await handleBuySelect(interaction, ownerId, value);
            if (action === 'upgrade') return await handleUpgradeSelect(interaction, ownerId, value);
            if (action === 'reroll') return await handleRerollSelect(interaction, ownerId, value);
            return false;
        }
        return false;
    }

    if (action === 'equip' || action === 'unequip') {
        if (!interaction.isStringSelectMenu()) return false;
        if (parts.length < 3) return false;
        const ownerId = parts[2];
        const value = interaction.values && interaction.values[0];
        if (!value) return true;
        if (action === 'equip') return await handleEquip(interaction, ownerId, value);
        if (action === 'unequip') return await handleUnequip(interaction, ownerId, value);
    }

    return false;
}

module.exports = { handle, buildRunesView };
