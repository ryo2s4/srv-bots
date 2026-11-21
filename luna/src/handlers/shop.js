const { PermissionsBitField, MessageFlags } = require('discord.js');
const UI = require('../utils/ui');

const { getGuildShop, updateGuildShop, getUserInventory, updateUserInventory, recordPurchase, getPurchases } = require('../shopStore');
const { getLunaPoints, addLunaPoints, spendLunaPoints } = require('../levelsStore');
const { getBoostNameAr } = require('../boostMeta');
const { sendGuildLog } = require('../guildLog');
const {
    ensureRotations,
    fmtRarity,
    normalizeRarity,
    normalizeRotation,
    normalizeCouponCode,
    resolveCatalogItem,
    getStaticShopItems,
    getActiveDiscount,
    applyDiscount,
    getPendingCoupon,
    shopKindAr,
    extractId,
    dayKey,
    weekKey,
    nextDailyResetTs,
    nextWeeklyResetTs,
    pickOne
} = require('../shopService');

const shopCooldownMs = {
    buy: 5 * 1000,
    bid: 10 * 1000,
    gift: 30 * 1000
};

function canUseCooldown(guildId, userId, key) {
    const shop = getGuildShop(guildId);
    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const now = Date.now();
    const last = cd[key] || 0;
    const wait = shopCooldownMs[key] || 0;
    if (now - last < wait) return false;
    updateGuildShop(guildId, (g) => {
        const next = { ...g };
        next.cooldowns = next.cooldowns || {};
        next.cooldowns[userId] = { ...(next.cooldowns[userId] || {}), [key]: now };
        return next;
    });
    return true;
}

// فحص فقط بدون استهلاك الكولداون (للفتحات اللي بعدها يستهلك الكولداون فعلًا)
function isOnCooldown(guildId, userId, key) {
    const shop = getGuildShop(guildId);
    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const now = Date.now();
    const last = cd[key] || 0;
    const wait = shopCooldownMs[key] || 0;
    return now - last < wait;
}

function clearPendingCoupon(guildId, userId) {
    updateGuildShop(guildId, (g) => {
        const next = { ...g };
        next.cooldowns = next.cooldowns || {};
        next.cooldowns[userId] = {
            ...(next.cooldowns[userId] || {}),
            couponCode: null,
            couponForItemId: null,
            couponExpiresAt: 0
        };
        return next;
    });
}

function markFirstBuyDay(guildId, userId) {
    updateGuildShop(guildId, (g) => {
        const next = { ...g };
        const dk = dayKey();
        next.cooldowns = next.cooldowns || {};
        next.cooldowns[userId] = { ...(next.cooldowns[userId] || {}), firstBuyDayKey: dk };
        return next;
    });
}

function getItemById(guildId, itemId) {
    ensureRotations(guildId);
    const shop = getGuildShop(guildId);
    const staticItems = getStaticShopItems();
    const item = staticItems.find((x) => x.id === itemId) || resolveCatalogItem(shop, { id: itemId });
    return { shop, item };
}

// هل العنصر متاح للبيع اليوم؟
// - العناصر الثابتة دائمًا متاحة، ما عدا المحدودة (kind: 'limited') لأنها تنباع فقط عبر سطح "العنصر المحدود" اليومي
// - الكتالوج (roleItems/titleItems) دائمًا متاح (كتالوج دائم)
// - أي عنصر ثاني لازم يكون مذكورًا بإحدى تدويرات اليوم/الأسبوع الحالية (daily/weekly/limited/featured)
function isItemAvailableToday(shop, itemId) {
    const staticItem = getStaticShopItems().find((x) => x.id === itemId) || null;
    if (staticItem) {
        if (staticItem.kind !== 'limited') return true;
        return !!(shop.limited && shop.limited.dayKey === dayKey() && shop.limited.item && shop.limited.item.id === itemId);
    }
    if (resolveCatalogItem(shop, { id: itemId })) return true;

    const rotationRefs = [
        ...(shop.daily && shop.daily.dayKey === dayKey() && Array.isArray(shop.daily.items) ? shop.daily.items : []),
        ...(shop.weekly && shop.weekly.weekKey === weekKey() && Array.isArray(shop.weekly.items) ? shop.weekly.items : []),
        (shop.limited && shop.limited.dayKey === dayKey() && shop.limited.item) ? shop.limited.item : null,
        (shop.featured && shop.featured.dayKey === dayKey() && shop.featured.item) ? shop.featured.item : null
    ].filter(Boolean);
    return rotationRefs.some((r) => r && r.id === itemId);
}

async function grantItemToUser({ guild, receiverId, item, paidCost, buyerId }) {
    const guildId = guild.id;
    const recipientTag = String(receiverId) === String(buyerId) ? 'لك' : `<@${receiverId}>`;
    const baseCost = Math.max(1, Math.floor(Number(item.price) || 0));

    if (item.kind === 'mystery') {
        const tier = String(item.mysteryTier || 'medium');
        const rewardRange = tier === 'small' ? [8, 25] : tier === 'big' ? [35, 95] : [15, 45];
        const boostChance = tier === 'small' ? 0.22 : tier === 'big' ? 0.45 : 0.35;
        const collectibleChance = tier === 'big' ? 0.20 : 0.10;

        const roll = Math.random();
        if (roll < (1 - boostChance - collectibleChance)) {
            const reward = rewardRange[0] + Math.floor(Math.random() * (rewardRange[1] - rewardRange[0] + 1));
            addLunaPoints(guildId, receiverId, reward);
            return `🎁✨ ${recipientTag} فتح الصندوق… وطلع **${UI.fmtNum(reward)}** Luna Points 💰`;
        }

        if (roll < (1 - collectibleChance)) {
            const boosts = getStaticShopItems().filter((x) => x.kind === 'boost');
            const b = pickOne(boosts);
            if (!b) {
                addLunaPoints(guildId, receiverId, 20);
                return `🎁 ${recipientTag} فتح الصندوق… خذ **20** Luna Points بدلًا من البوست 💜`;
            }
            updateUserInventory(guildId, receiverId, (inv) => {
                const next = { ...inv };
                next.boosts = Array.isArray(next.boosts) ? [...next.boosts] : [];
                next.boosts.push({ type: b.boostType, acquiredAt: Date.now(), durationMs: b.durationMs });
                return next;
            });
            return `🎁⚡ ${recipientTag} حصل على بوست: **${getBoostNameAr(b.boostType)}**`;
        }

        const collectibles = getStaticShopItems().filter((x) => x.kind === 'collectible');
        const c = pickOne(collectibles);
        if (!c) return `✅ تم شراء الصندوق (${UI.fmtNum(paidCost)}/${UI.fmtNum(baseCost)}).`;
        updateUserInventory(guildId, receiverId, (inv) => {
            const next = { ...inv };
            next.collectibles = Array.isArray(next.collectibles) ? [...next.collectibles] : [];
            if (!next.collectibles.some((x) => x && x.id === c.collectibleId)) {
                next.collectibles.push({ id: c.collectibleId, name: c.name, emoji: c.emoji || '🏅', acquiredAt: Date.now() });
            }
            return next;
        });
        return `🎁🏅 ${recipientTag} حصل على مقتنى: **${c.name}**`;
    }

    if (item.kind === 'bundle') {
        const bundle = String(item.bundleType || 'starter');
        if (bundle === 'starter') {
            updateUserInventory(guildId, receiverId, (inv) => {
                const next = { ...inv };
                next.boosts = Array.isArray(next.boosts) ? [...next.boosts] : [];
                next.titles = Array.isArray(next.titles) ? [...next.titles] : [];
                if (!next.titles.some((t) => t && t.title === '🌙 رفيق/ة البدايات')) {
                    next.titles.push({ title: '🌙 رفيق/ة البدايات', acquiredAt: Date.now() });
                }
                next.boosts.push({ type: 'xp_boost_25_1h', acquiredAt: Date.now(), durationMs: 60 * 60 * 1000 });
                return next;
            });
            addLunaPoints(guildId, receiverId, 20);
            return `✅ 📦 ${recipientTag} حصل على باقة البداية: لقب + XP Boost +20 Luna`;
        }
        updateUserInventory(guildId, receiverId, (inv) => {
            const next = { ...inv };
            next.boosts = Array.isArray(next.boosts) ? [...next.boosts] : [];
            next.collectibles = Array.isArray(next.collectibles) ? [...next.collectibles] : [];
            next.services = next.services && typeof next.services === 'object'
                ? { ...next.services }
                : { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0, rerollDaily: 0 };
            next.boosts.push({ type: 'luna_boost_25_1h', acquiredAt: Date.now(), durationMs: 60 * 60 * 1000 });
            next.boosts.push({ type: 'xp_boost_25_1h', acquiredAt: Date.now(), durationMs: 60 * 60 * 1000 });
            next.services.rerollDaily = Math.max(0, Math.floor(Number(next.services.rerollDaily) || 0)) + 1;
            if (!next.collectibles.some((x) => x && x.id === 'bundle_power')) {
                next.collectibles.push({ id: 'bundle_power', name: '🚀 وسام باقة القوة', emoji: '🚀', acquiredAt: Date.now() });
            }
            return next;
        });
        addLunaPoints(guildId, receiverId, 40);
        return `✅ 🚀 ${recipientTag} حصل على باقة القوة: 2 بوست + Reroll + مقتنى +40 Luna`;
    }

    if (item.kind === 'collectible' || item.kind === 'limited') {
        const cId = item.collectibleId || item.id;
        const cName = item.name || 'مقتنى';
        updateUserInventory(guildId, receiverId, (inv) => {
            const next = { ...inv };
            next.collectibles = Array.isArray(next.collectibles) ? [...next.collectibles] : [];
            if (!next.collectibles.some((x) => x && x.id === cId)) {
                next.collectibles.push({ id: cId, name: cName, emoji: item.emoji || '🏅', acquiredAt: Date.now() });
            }
            if (item.title) {
                next.titles = Array.isArray(next.titles) ? [...next.titles] : [];
                if (!next.titles.some((t) => t && t.title === item.title)) {
                    next.titles.push({ title: item.title, acquiredAt: Date.now() });
                }
            }
            return next;
        });
        return `✅ 🏅 تم إضافة ${cName} ${String(receiverId) === String(buyerId) ? 'لممتلكاتك' : `لـ ${recipientTag}`}.`;
    }

    if (item.kind === 'role') {
        let role = guild.roles.cache.get(item.roleId);
        if (!role) {
            try { role = await guild.roles.fetch(item.roleId); } catch { role = null; }
        }
        if (!role) {
            addLunaPoints(guildId, buyerId, paidCost);
            return '❌ آسف بس الرتبة مو موجودة… رجّعت النقاط 3:';
        }
        const botMember = guild.members.me;
        if (botMember && botMember.roles.highest.comparePositionTo(role) <= 0) {
            addLunaPoints(guildId, buyerId, paidCost);
            return '❌ آسف بس رتبة لونا لازم تكون أعلى من الرتبة المباعة… رجّعت النقاط 3:';
        }
        try {
            const member = await guild.members.fetch(receiverId);
            await member.roles.add(role.id);
            updateUserInventory(guildId, receiverId, (inv) => {
                const next = { ...inv };
                next.roles = Array.isArray(next.roles) ? [...next.roles] : [];
                if (!next.roles.some((r) => r && r.roleId === role.id)) {
                    next.roles.push({ roleId: role.id, acquiredAt: Date.now() });
                }
                return next;
            });
            return `✅ 🎨 تم شراء رتبة شكلية: <@&${role.id}> لـ ${recipientTag}`;
        } catch {
            addLunaPoints(guildId, buyerId, paidCost);
            return '❌ آسف بس ما قدرت أضيف الرتبة… رجّعت النقاط 3:';
        }
    }

    if (item.kind === 'title') {
        const titleValue = String(item.title || item.name || '').trim();
        if (!titleValue) {
            addLunaPoints(guildId, buyerId, paidCost);
            return '❌ آسف بس اللقب فيه مشكلة… رجّعت النقاط 3:';
        }
        updateUserInventory(guildId, receiverId, (inv) => {
            const next = { ...inv };
            next.titles = Array.isArray(next.titles) ? [...next.titles] : [];
            if (!next.titles.some((t) => t && t.title === titleValue)) {
                next.titles.push({ title: titleValue, acquiredAt: Date.now() });
            }
            return next;
        });
        return `✅ 🎭 تم شراء لقب: **${titleValue}** لـ ${recipientTag}`;
    }

    if (item.kind === 'boost') {
        updateUserInventory(guildId, receiverId, (inv) => {
            const next = { ...inv };
            next.boosts = Array.isArray(next.boosts) ? [...next.boosts] : [];
            next.boosts.push({ type: item.boostType, acquiredAt: Date.now(), durationMs: item.durationMs });
            return next;
        });
        return `✅ ⚡ تم منح ${getBoostNameAr(item.boostType)} لـ ${recipientTag}`;
    }

    if (item.kind === 'service') {
        updateUserInventory(guildId, receiverId, (inv) => {
            const next = { ...inv };
            next.services = next.services && typeof next.services === 'object'
                ? { ...next.services }
                : { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0, rerollDaily: 0 };
            if (item.serviceType === 'rename_once') next.services.renameOnce = (next.services.renameOnce || 0) + 1;
            else if (item.serviceType === 'xp_transfer') next.services.xpTransfer = (next.services.xpTransfer || 0) + 1;
            else if (item.serviceType === 'shield') next.services.shield = (next.services.shield || 0) + 1;
            else if (item.serviceType === 'rebalance') next.services.rebalance = (next.services.rebalance || 0) + 1;
            else if (item.serviceType === 'vip_title') next.services.vipTitle = (next.services.vipTitle || 0) + 1;
            else if (item.serviceType === 'reroll_daily') next.services.rerollDaily = (next.services.rerollDaily || 0) + 1;
            return next;
        });
        return `✅ 🤝 تم منح خدمة **${item.name}** لـ ${recipientTag}`;
    }

    return `✅ تم شراء **${item.name || item.id}** (${UI.fmtNum(paidCost)}/${UI.fmtNum(baseCost)}).`;
}

async function handleShopAdminButtons({ interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopadminui:'))) return false;

    if (!interaction.guild) {
        try { await interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true }); } catch { }
        return true;
    }
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
    const action = interaction.customId.split(':')[1];

    if (action === 'add_role') {
        const modal = new ModalBuilder().setCustomId('shopadminuiModal:add_role').setTitle('إضافة رتبة للمتجر 🎨');
        const roleId = new TextInputBuilder().setCustomId('roleId').setLabel('Role ID (أو منشن مثل <@&123>)').setStyle(TextInputStyle.Short).setRequired(true);
        const price = new TextInputBuilder().setCustomId('price').setLabel('السعر (Luna Points)').setStyle(TextInputStyle.Short).setRequired(true);
        const rarity = new TextInputBuilder().setCustomId('rarity').setLabel('الندرة (اختياري)').setPlaceholder('common/uncommon/rare/legendary/mythic').setStyle(TextInputStyle.Short).setRequired(false);
        const rotation = new TextInputBuilder().setCustomId('rotation').setLabel('يومي أم أسبوعي؟ daily/weekly/both (اختياري)').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(
            new ActionRowBuilder().addComponents(roleId),
            new ActionRowBuilder().addComponents(price),
            new ActionRowBuilder().addComponents(rarity),
            new ActionRowBuilder().addComponents(rotation)
        );
        try { await interaction.showModal(modal); } catch { }
        return true;
    }

    if (action === 'add_title') {
        const modal = new ModalBuilder().setCustomId('shopadminuiModal:add_title').setTitle('إضافة لقب للمتجر 🎭');
        const title = new TextInputBuilder().setCustomId('title').setLabel('اللقب (مثال: 🌙 تلميذ/ة لونا)').setStyle(TextInputStyle.Short).setRequired(true);
        const price = new TextInputBuilder().setCustomId('price').setLabel('السعر (Luna Points)').setStyle(TextInputStyle.Short).setRequired(true);
        const rarity = new TextInputBuilder().setCustomId('rarity').setLabel('الندرة (اختياري)').setPlaceholder('common/uncommon/rare/legendary/mythic').setStyle(TextInputStyle.Short).setRequired(false);
        const rotation = new TextInputBuilder().setCustomId('rotation').setLabel('يومي أم أسبوعي؟ daily/weekly/both (اختياري)').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(
            new ActionRowBuilder().addComponents(title),
            new ActionRowBuilder().addComponents(price),
            new ActionRowBuilder().addComponents(rarity),
            new ActionRowBuilder().addComponents(rotation)
        );
        try { await interaction.showModal(modal); } catch { }
        return true;
    }

    if (action === 'add_coupon') {
        const modal = new ModalBuilder().setCustomId('shopadminuiModal:add_coupon').setTitle('إنشاء كود خصم 🎟️');
        const code = new TextInputBuilder().setCustomId('code').setLabel('الكود (مثال: LUNA20)').setStyle(TextInputStyle.Short).setRequired(true);
        const percent = new TextInputBuilder().setCustomId('percent').setLabel('نسبة الخصم (1 - 20)').setStyle(TextInputStyle.Short).setRequired(true);
        const maxUses = new TextInputBuilder().setCustomId('maxUses').setLabel('عدد مرات الاستخدام (إجمالي بالسيرفر)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(
            new ActionRowBuilder().addComponents(code),
            new ActionRowBuilder().addComponents(percent),
            new ActionRowBuilder().addComponents(maxUses)
        );
        try { await interaction.showModal(modal); } catch { }
        return true;
    }

    if (action === 'remove_item') {
        const shop = getGuildShop(interaction.guild.id);
        const roles = Array.isArray(shop.roleItems) ? shop.roleItems : [];
        const titles = Array.isArray(shop.titleItems) ? shop.titleItems : [];
        const combined = [...roles, ...titles].filter(Boolean);
        if (combined.length === 0) {
            try { await interaction.reply({ content: '❌ ما فيه عناصر لحذفها حاليًا.', ephemeral: true }); } catch { }
            return true;
        }

        const options = combined.slice(0, 25).map((it) => ({
            label: (it.name || it.title || it.id || 'item').slice(0, 100),
            description: `${fmtRarity(it.rarity)} | السعر: ${UI.fmtNum(it.price)}`.slice(0, 100),
            value: it.id
        })).filter((o) => o.value);

        if (options.length === 0) {
            try { await interaction.reply({ content: '❌ ما قدرت أجهّز قائمة الاختصارات… تأكد من البيانات 3:', ephemeral: true }); } catch { }
            return true;
        }

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('shopadminuiSelect:remove_item').setPlaceholder('اختار عنصر للحذف').addOptions(options)
        );
        try { await interaction.reply({ content: '🗑️ حذف عنصر من المتجر\nاختار العنصر من القائمة 👇', components: [row], ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'set_legendary') {
        const modal = new ModalBuilder().setCustomId('shopadminuiModal:set_legendary').setTitle('تحديد رتبة المزاد 🏆');
        const roleId = new TextInputBuilder().setCustomId('roleId').setLabel('Role ID (أو منشن <@&123>)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(roleId));
        try { await interaction.showModal(modal); } catch { }
        return true;
    }

    if (action === 'start_auction') {
        const modal = new ModalBuilder().setCustomId('shopadminuiModal:start_auction').setTitle('بدء المزاد ⏳');
        const hours = new TextInputBuilder().setCustomId('hours').setLabel('مدة المزاد بالساعات (1-168)').setStyle(TextInputStyle.Short).setRequired(true);
        const minBid = new TextInputBuilder().setCustomId('minBid').setLabel('الحد الأدنى للمزايدة (اختياري)').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(hours), new ActionRowBuilder().addComponents(minBid));
        try { await interaction.showModal(modal); } catch { }
        return true;
    }

    if (action === 'end_auction') {
        const shop = getGuildShop(interaction.guild.id);
        const a = shop.auction || {};
        const refundAmount = (a.active && a.highestBidderId && Math.floor(Number(a.highestBid) || 0) > 0)
            ? Math.floor(Number(a.highestBid))
            : 0;
        const refundTo = refundAmount > 0 ? a.highestBidderId : null;
        if (refundAmount > 0) {
            addLunaPoints(interaction.guild.id, refundTo, refundAmount);
        }
        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            next.auction = {
                ...(next.auction || {}),
                active: false,
                ...(refundAmount > 0 ? { highestBid: 0, highestBidderId: null } : {})
            };
            return next;
        });
        const endMsg = refundAmount > 0
            ? `✅ ⛔ تم إنهاء المزاد (إيقاف). رجّعت **${UI.fmtNum(refundAmount)}** Luna Points للمزايد الأعلى <@${refundTo}> 💰`
            : '✅ ⛔ تم إنهاء المزاد (إيقاف).';
        try { await interaction.reply({ content: endMsg, ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'announce') {
        const { getGuildConfig, updateGuildConfig } = require('../guildConfig');
        const cfg = getGuildConfig(interaction.guild.id);
        const enabled = !!(cfg.shop && cfg.shop.announceEnabled);
        const channelId = cfg.shop && cfg.shop.announceChannelId ? cfg.shop.announceChannelId : null;
        if (!channelId) {
            try { await interaction.reply({ content: '❌ حدّد روم الإعلانات أولًا (زر "📍 روم الإعلانات") 3:', ephemeral: true }); } catch { }
            return true;
        }
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            shop: { ...(c.shop && typeof c.shop === 'object' ? c.shop : {}), announceEnabled: !enabled }
        }));
        try { await interaction.reply({ content: `${!enabled ? '✅' : '⛔'} إعلانات العروض اليومية: **${!enabled ? 'مفعّلة' : 'معطّلة'}**`, ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'announce_ch') {
        const modal = new ModalBuilder().setCustomId('shopadminuiModal:announce_ch').setTitle('روم إعلانات العروض 📢');
        const channelId = new TextInputBuilder().setCustomId('channelId').setLabel('Channel ID (أو منشن مثل <#123>)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(channelId));
        try { await interaction.showModal(modal); } catch { }
        return true;
    }

    if (action === 'announce_preview') {
        const { getGuildConfig } = require('../guildConfig');
        const shopService = require('../shopService');
        const cfg = getGuildConfig(interaction.guild.id);
        const chId = cfg.shop && cfg.shop.announceChannelId ? cfg.shop.announceChannelId : null;

        shopService.ensureRotations(interaction.guild.id);
        const shopPreview = getGuildShop(interaction.guild.id);
        const embed = shopService.buildRestockEmbed(shopPreview);

        if (chId) {
            const ch = await interaction.guild.channels.fetch(chId).catch(() => null);
            if (ch && ch.isTextBased()) {
                await ch.send({ embeds: [embed] }).catch(() => null);
                try { await interaction.reply({ content: `✅ تم إرسال معاينة الإعلان لـ <#${chId}>`, ephemeral: true }); } catch { }
                return true;
            }
        }
        try { await interaction.reply({ content: '✅ هذي معاينة الإعلان (ما فيه روم محدد):', embeds: [embed], ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'show') {
        const shop = getGuildShop(interaction.guild.id);
        const roleCount = Array.isArray(shop.roleItems) ? shop.roleItems.length : 0;
        const titleCount = Array.isArray(shop.titleItems) ? shop.titleItems.length : 0;
        const legendary = shop.auction && shop.auction.legendaryRoleId ? `<@&${shop.auction.legendaryRoleId}>` : 'غير محددة';
        const status = shop.auction && shop.auction.active ? 'نشط ✅' : 'غير نشط ⛔';
        try {
            await interaction.reply({
                embeds: [
                    UI.embed({
                        color: UI.COLORS.shop,
                        title: '⚙️ إعدادات متجر لونا',
                        description: [
                            `> 🎨 **رتب بالمتجر:** ${UI.fmtNum(roleCount)}`,
                            `> 🎭 **ألقاب بالمتجر:** ${UI.fmtNum(titleCount)}`,
                            `> 🏆 **رتبة المزاد الأسطوري:** ${legendary}`,
                            `> 📌 **حالة المزاد:** ${status}`,
                            `> 📢 **إعلانات العروض:** ${(() => { try { const c = require('../guildConfig').getGuildConfig(interaction.guild.id); const s = c.shop && typeof c.shop === 'object' ? c.shop : {}; return s.announceEnabled ? `مفعّلة ✅ ${s.announceChannelId ? `<#${s.announceChannelId}>` : ''}` : 'معطّلة ⛔'; } catch { return '—'; } })()}`
                        ].join('\n'),
                        footerText: 'إعدادات المتجر'
                    })
                ],
                ephemeral: true
            });
        } catch { }
        return true;
    }

    return true;
}

async function handleShopAdminSelectRemove({ interaction }) {
    if (!(interaction.isStringSelectMenu && interaction.isStringSelectMenu())) return false;
    if (interaction.customId !== 'shopadminuiSelect:remove_item') return false;

    if (!interaction.guild) return true;
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const id = interaction.values && interaction.values[0] ? interaction.values[0] : null;
    if (!id) return true;

    updateGuildShop(interaction.guild.id, (g) => {
        const next = { ...g };
        next.roleItems = (Array.isArray(next.roleItems) ? next.roleItems : []).filter((x) => x && x.id !== id);
        next.titleItems = (Array.isArray(next.titleItems) ? next.titleItems : []).filter((x) => x && x.id !== id);
        return next;
    });

    try { await interaction.reply({ content: `✅ 🗑️ تم حذف العنصر: **${id}**`, ephemeral: true }); } catch { }
    return true;
}

async function handleShopAdminModal({ interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopadminuiModal:'))) return false;

    if (!interaction.guild) return true;
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        try { await interaction.reply({ content: '❌ آسف بس تحتاج صلاحية Manage Server عشان تستخدم هالامر 3:', ephemeral: true }); } catch { }
        return true;
    }

    const action = interaction.customId.split(':')[1];

    if (action === 'announce_ch') {
        const raw = String(interaction.fields.getTextInputValue('channelId') || '').trim();
        const chId = extractId(raw);
        if (!chId || !/^\d{17,20}$/.test(chId)) {
            try { await interaction.reply({ content: '❌ صيغة الروم غلط — اكتب ID أو منشن 3:', ephemeral: true }); } catch { }
            return true;
        }
        const ch = await interaction.guild.channels.fetch(chId).catch(() => null);
        if (!ch || !ch.isTextBased()) {
            try { await interaction.reply({ content: '❌ ما لقيت هالروم بالسيرفر 3:', ephemeral: true }); } catch { }
            return true;
        }
        const { updateGuildConfig } = require('../guildConfig');
        updateGuildConfig(interaction.guild.id, (c) => ({
            ...c,
            shop: { ...(c.shop && typeof c.shop === 'object' ? c.shop : {}), announceChannelId: chId }
        }));
        try { await interaction.reply({ content: `✅ تم تحديد روم الإعلانات: <#${chId}> — فعّل الإعلانات من لوحة المتجر 📢`, ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'add_role') {
        const roleIdRaw = interaction.fields.getTextInputValue('roleId');
        const priceRaw = interaction.fields.getTextInputValue('price');
        const rarityRaw = interaction.fields.getTextInputValue('rarity');
        const rotationRaw = interaction.fields.getTextInputValue('rotation');

        const roleId = extractId(roleIdRaw);
        const price = Math.floor(Number(String(priceRaw || '').trim()) || 0);
        if (!roleId || !price || price < 1) {
            try { await interaction.reply({ content: '❌ آسف بس تأكدي من Role ID والسعر (لازم يكون رقم أكبر من 0) >:', ephemeral: true }); } catch { }
            return true;
        }

        let role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
            try { role = await interaction.guild.roles.fetch(roleId); } catch { role = null; }
        }
        if (!role) {
            try { await interaction.reply({ content: '❌ آسف بس ما لقيت هالرتبة بالسيرفر… تأكدي من الـ ID 3:', ephemeral: true }); } catch { }
            return true;
        }

        const rarity = normalizeRarity(rarityRaw);
        const rotation = normalizeRotation(rotationRaw);

        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            const list = Array.isArray(next.roleItems) ? [...next.roleItems] : [];
            const id = `role:${role.id}`;
            const entry = { id, name: role.name, roleId: role.id, price, rarity, rotation };
            const idx = list.findIndex((x) => x && x.id === id);
            if (idx >= 0) list[idx] = entry;
            else list.push(entry);
            next.roleItems = list;
            return next;
        });

        try {
            await interaction.reply({
                content: `✅ تمام! ضفت رتبة للمتجر: <@&${role.id}> بسعر **${UI.fmtNum(price)}** Luna Points ✨ (ندرة: **${fmtRarity(rarity)}**)`,
                ephemeral: true
            });
        } catch { }
        return true;
    }

    if (action === 'add_title') {
        const titleRaw = interaction.fields.getTextInputValue('title');
        const priceRaw = interaction.fields.getTextInputValue('price');
        const rarityRaw = interaction.fields.getTextInputValue('rarity');
        const rotationRaw = interaction.fields.getTextInputValue('rotation');

        const title = String(titleRaw || '').replace(/\s+/g, ' ').trim().slice(0, 64);
        const price = Math.floor(Number(String(priceRaw || '').trim()) || 0);
        if (!title || !price || price < 1) {
            try { await interaction.reply({ content: '❌ آسف بس تأكدي من اللقب والسعر (لازم يكون رقم أكبر من 0) >:', ephemeral: true }); } catch { }
            return true;
        }

        const rarity = normalizeRarity(rarityRaw);
        const rotation = normalizeRotation(rotationRaw);

        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            const list = Array.isArray(next.titleItems) ? [...next.titleItems] : [];
            const id = `title:${title.toLowerCase()}`;
            const entry = { id, name: title, title, price, rarity, rotation };
            const idx = list.findIndex((x) => x && x.id === id);
            if (idx >= 0) list[idx] = entry;
            else list.push(entry);
            next.titleItems = list;
            return next;
        });

        try {
            await interaction.reply({
                content: `✅ تمت إضافة لقب للمتجر: **${title}** بسعر **${UI.fmtNum(price)}** Luna Points ✨ (ندرة: **${fmtRarity(rarity)}**)`,
                ephemeral: true
            });
        } catch { }
        return true;
    }

    if (action === 'set_legendary') {
        const roleIdRaw = interaction.fields.getTextInputValue('roleId');
        const roleId = extractId(roleIdRaw);
        if (!roleId) {
            try { await interaction.reply({ content: '❌ آسف بس عطيني Role ID صح 3:', ephemeral: true }); } catch { }
            return true;
        }

        let role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
            try { role = await interaction.guild.roles.fetch(roleId); } catch { role = null; }
        }
        if (!role) {
            try { await interaction.reply({ content: '❌ آسف بس ما لقيت هالرتبة بالسيرفر… تأكدي من الـ ID 3:', ephemeral: true }); } catch { }
            return true;
        }

        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            next.auction = next.auction || {};
            next.auction.legendaryRoleId = role.id;
            return next;
        });

        try { await interaction.reply({ content: `✅ 🏆 تم تحديد الرتبة الأسطورية للمزاد: <@&${role.id}>`, ephemeral: true }); } catch { }
        return true;
    }

    if (action === 'start_auction') {
        const hoursRaw = interaction.fields.getTextInputValue('hours');
        const minBidRaw = interaction.fields.getTextInputValue('minBid');
        const hours = Math.floor(Number(String(hoursRaw || '').trim()) || 0);
        const minBid = Math.max(1, Math.floor(Number(String(minBidRaw || '').trim()) || 50));

        if (!hours || hours < 1 || hours > 168) {
            try { await interaction.reply({ content: '❌ آسف بس مدة المزاد لازم تكون بين 1 و 168 ساعة 3:', ephemeral: true }); } catch { }
            return true;
        }

        const shop = getGuildShop(interaction.guild.id);
        if (!shop.auction || !shop.auction.legendaryRoleId) {
            try { await interaction.reply({ content: '❌ آسف بس حددي رتبة المزاد أول… من زر "تحديد رتبة المزاد" 🏆 3:', ephemeral: true }); } catch { }
            return true;
        }

        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            const now = Date.now();
            next.auction = {
                ...(next.auction || {}),
                active: true,
                endsAt: now + hours * 60 * 60 * 1000,
                highestBid: 0,
                highestBidderId: null,
                bids: [],
                minBid
            };
            return next;
        });

        try {
            await interaction.reply({
                content:
                    `✅ 🏆✨ تم بدء المزاد الأسطوري!\n` +
                    `> ⏳ **ينتهي بعد:** ${UI.fmtDuration(hours * 60 * 60 * 1000)} (${hours} ساعة)\n` +
                    `> 💰 **الحد الأدنى للمزايدة:** ${UI.fmtNum(minBid)} Luna Points\n` +
                    `> 🎖️ **الرتبة:** <@&${shop.auction.legendaryRoleId}>`,
                ephemeral: true
            });
        } catch { }
        return true;
    }

    if (action === 'add_coupon') {
        const codeRaw = interaction.fields.getTextInputValue('code');
        const percentRaw = interaction.fields.getTextInputValue('percent');
        const maxUsesRaw = interaction.fields.getTextInputValue('maxUses');

        const code = normalizeCouponCode(codeRaw);
        const percentNum = Number(String(percentRaw || '').trim() || NaN);
        const maxUsesNum = Number(String(maxUsesRaw || '').trim() || NaN);

        if (!code) {
            try { await interaction.reply({ content: '❌ الكود غير صالح.', ephemeral: true }); } catch { }
            return true;
        }
        if (!Number.isFinite(percentNum) || !Number.isFinite(maxUsesNum)) {
            try { await interaction.reply({ content: '❌ آسف بس نسبة الخصم وعدد الاستخدامات لازم تكون أرقام صحيحة 3:', ephemeral: true }); } catch { }
            return true;
        }

        const percent = Math.max(1, Math.min(20, Math.floor(percentNum)));
        const maxUses = Math.max(1, Math.min(100000, Math.floor(maxUsesNum)));

        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            next.coupons = next.coupons && typeof next.coupons === 'object' ? { ...next.coupons } : {};
            next.coupons[code] = { percent, maxUses, used: 0, createdAt: Date.now() };
            return next;
        });

        try { await interaction.reply({ content: `✅ تم إنشاء كود خصم: **${code}**\n> 🎟️ **الخصم:** ${percent}%\n> 🔁 **الاستخدامات:** ${UI.fmtNum(maxUses)}`, ephemeral: true }); } catch { }
        return true;
    }

    return true;
}

async function handleShopButtons({ interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shop:'))) return false;

    if (!interaction.guild) {
        try { await interaction.reply({ content: '❌ آسف بس هاد الشي بس بالسيرفر 3:', ephemeral: true }); } catch { }
        return true;
    }

    ensureRotations(interaction.guild.id);

    const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    const action = interaction.customId.split(':')[1];

    const respond = async (payload) => {
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
        return interaction.reply({ ...payload, ephemeral: payload.ephemeral ?? true });
    };

    if (action !== 'bid') {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }
        } catch {
        }
    }

    const shop = getGuildShop(interaction.guild.id);
    const points = getLunaPoints(interaction.guild.id, interaction.user.id);

    if (action === 'featured') {
        const featuredRef = shop.featured && shop.featured.dayKey === dayKey() ? shop.featured.item : null;
        const featured = featuredRef ? resolveCatalogItem(shop, featuredRef) : null;
        if (!featured) {
            return respond({ content: '❌ اليوم ما عندي Featured واضح… جربي/جرب بعد شوي 🌙' });
        }

        const discount = getActiveDiscount(interaction.guild.id, interaction.user.id);
        const finalCost = applyDiscount(featured.price, discount.percent);
        const discTxt = discount.percent > 0
            ? `\nخصمك اليوم: **${discount.percent}%** (اليومي ${discount.base}% + أول شراء ${discount.first}%)`
            : '';

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '⭐ Featured اليوم',
            description: [
                `**${featured.name || featured.title}**`,
                '',
                `> 🏷️ **النوع:** ${shopKindAr(featured.kind)}`,
                `> 🎲 **الندرة:** ${fmtRarity(featured.rarity)}`,
                `> 💰 **السعر:** ~~${UI.fmtNum(featured.price)}~~ → **${UI.fmtNum(finalCost)}** Luna Points ✨`,
                `> 🌙 **رصيدك:** ${UI.fmtNum(points)}`
            ].join('\n') + discTxt,
            footerText: 'Featured اليوم'
        });

        const row = UI.row(
            UI.btn(`shopbuy:${featured.id}`, 'شراء الـ Featured ⭐', { style: ButtonStyle.Danger }),
            UI.btn('shop:inventory', 'ممتلكاتي 🎒', { style: ButtonStyle.Secondary })
        );

        return respond({ embeds: [embed], components: [row] });
    }

    if (action === 'mystery') {
        const items = getStaticShopItems().filter((x) => x.kind === 'mystery');
        if (!items.length) return respond({ content: '❌ آسف بس صناديق المفاجأة مو جاهزة الحين 3:' });

        const discount = getActiveDiscount(interaction.guild.id, interaction.user.id);
        const discTxt = discount.percent > 0
            ? `\nخصمك اليوم: **${discount.percent}%** (اليومي ${discount.base}% + أول شراء ${discount.first}%)`
            : '';

        const lines = items.map((it) => {
            const finalCost = applyDiscount(it.price, discount.percent);
            return `- ${it.emoji || '🎁'} **${it.name}** — ${fmtRarity(it.rarity)} — ~~${UI.fmtNum(it.price)}~~ → **${UI.fmtNum(finalCost)}** ✨`;
        }).join('\n');

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '🎁 Mystery Boxes',
            description: [
                'صندوق مفاجأة… ما حد يدري وش بيطلع 👀',
                '',
                '> 💰 ممكن يطلع لك Luna Points',
                '> ⚡ ممكن يطلع لك Boost',
                '> 🎖️ ممكن يطلع لك مقتنيات',
                '',
                '**الصناديق المتاحة:**',
                lines,
                '',
                `> 🌙 **رصيدك:** ${UI.fmtNum(points)}`
            ].join('\n') + discTxt,
            footerText: 'صناديق المفاجأة'
        });

        const options = items.slice(0, 25).map((it) => ({
            label: (it.name || it.id).slice(0, 100),
            description: `السعر: ${UI.fmtNum(it.price)} | ${fmtRarity(it.rarity)}`.slice(0, 100),
            value: it.id
        }));
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('shopSelect:mystery').setPlaceholder('اختر الصندوق').addOptions(options)
        );
        return respond({ embeds: [embed], components: [row] });
    }

    if (action === 'limited') {
        const limitedRef = shop.limited && shop.limited.dayKey === dayKey() ? shop.limited.item : null;
        const staticItems = getStaticShopItems();
        const limited = limitedRef ? (staticItems.find((x) => x.id === limitedRef.id) || resolveCatalogItem(shop, limitedRef)) : null;
        if (!limited) return respond({ content: '❌ اليوم ما فيه عنصر محدود واضح… جرّب بعد شوي 🌙' });

        const discount = getActiveDiscount(interaction.guild.id, interaction.user.id);
        const finalCost = applyDiscount(limited.price, discount.percent);
        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '🏷️ Limited Item',
            description: [
                `**${limited.name || limited.title}**`,
                '',
                `> 🎲 **الندرة:** ${fmtRarity(limited.rarity)}`,
                `> 💰 **السعر:** ~~${UI.fmtNum(limited.price)}~~ → **${UI.fmtNum(finalCost)}** Luna Points ✨`,
                `> ⏳ **ينتهي:** <t:${Math.floor(nextDailyResetTs() / 1000)}:R>`,
                `> 🌙 **رصيدك:** ${UI.fmtNum(points)}`
            ].join('\n'),
            footerText: 'العنصر المحدود'
        });
        const row = UI.row(
            UI.btn(`shopbuy:${limited.id}`, 'شراء المحدود 🏷️', { style: ButtonStyle.Danger }),
            UI.btn('shop:inventory', 'ممتلكاتي 🎒', { style: ButtonStyle.Secondary })
        );
        return respond({ embeds: [embed], components: [row] });
    }

    if (action === 'inventory') {
        const inv = getUserInventory(interaction.guild.id, interaction.user.id);
        const titles = inv.titles.length ? inv.titles.map(t => `- ${t.title}`).slice(0, 15).join('\n') : 'لا يوجد';
        const ownedBoosts = inv.boosts.length ? inv.boosts.map(b => `- ${getBoostNameAr(b.type)}`).slice(0, 15).join('\n') : 'لا يوجد';
        const now = Date.now();
        const activeList = (Array.isArray(inv.activeBoosts) ? inv.activeBoosts : []).filter(b => b && (!b.expiresAt || b.expiresAt > now));
        const activeBoosts = activeList.length
            ? activeList.map(b => `- ${getBoostNameAr(b.type)} — ⏳ ${b.expiresAt ? `متبقي ${UI.fmtDuration(b.expiresAt - now)}` : 'دائم'}`).slice(0, 15).join('\n')
            : 'لا يوجد';
        const roles = inv.roles.length ? inv.roles.map(r => `- <@&${r.roleId}>`).slice(0, 15).join('\n') : 'لا يوجد';
        const collectibles = Array.isArray(inv.collectibles) && inv.collectibles.length
            ? inv.collectibles.map((c) => `- ${(c.emoji || '🏅')} ${c.name || c.id}`).slice(0, 15).join('\n')
            : 'لا يوجد';
        const renameCards = inv.services && typeof inv.services.renameOnce === 'number' ? inv.services.renameOnce : 0;
        const rerolls = inv.services && typeof inv.services.rerollDaily === 'number' ? inv.services.rerollDaily : 0;

        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '🎒 ممتلكاتك',
            description: [
                `> 🌙 **نقاط لونا:** ${UI.fmtNum(points)}`,
                '',
                'أنا جمّعت لك كل شي هنا بكل حب 💜'
            ].join('\n'),
            fields: [
                { name: 'اللقب النشط 🎭', value: inv.activeTitle ? `**${inv.activeTitle}**` : 'لا يوجد', inline: false },
                { name: '📚 ألقابك', value: titles, inline: false },
                { name: '⚡ بوستات (بطاقات غير مفعلة)', value: ownedBoosts, inline: false },
                { name: '⏳ بوستات نشطة', value: activeBoosts, inline: false },
                { name: '🎨 رتب شكلية', value: roles, inline: false },
                { name: '🎖️ مقتنيات', value: collectibles, inline: false },
                { name: '🤝 خدمات', value: `${renameCards > 0 ? `- 🎫 بطاقة تغيير الاسم: **${UI.fmtNum(renameCards)}**\n` : ''}${rerolls > 0 ? `- 🎲 إعادة توليد يومي: **${UI.fmtNum(rerolls)}**` : ''}` || 'لا يوجد', inline: false }
            ],
            footerText: 'ممتلكاتك'
        });
        const row = UI.row(
            UI.btn('shop:rerolldaily', 'إعادة توليد اليومي 🎲', { style: ButtonStyle.Primary, disabled: rerolls <= 0 })
        );
        return respond({ embeds: [embed], components: [row] });
    }

    if (action === 'rerolldaily') {
        const inv = getUserInventory(interaction.guild.id, interaction.user.id);
        const count = inv.services && typeof inv.services.rerollDaily === 'number' ? inv.services.rerollDaily : 0;
        if (count <= 0) {
            return respond({ content: '❌ آسف بس ما عندك بطاقات إعادة توليد يومي 3:' });
        }
        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            next.daily = { dayKey: null, items: [] };
            next.featured = { dayKey: null, item: null };
            return next;
        });
        ensureRotations(interaction.guild.id);
        updateUserInventory(interaction.guild.id, interaction.user.id, (cur) => {
            const next = { ...cur };
            next.services = next.services && typeof next.services === 'object'
                ? { ...next.services }
                : { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0, rerollDaily: 0 };
            next.services.rerollDaily = Math.max(0, (Number(next.services.rerollDaily) || 0) - 1);
            return next;
        });
        return respond({ content: '✅ تم إعادة توليد العروض اليومية + Featured بنجاح.' });
    }

    if (action === 'auction') {
        const a = shop.auction || {};
        const embed = UI.embed({
            color: UI.COLORS.shop,
            title: '🏆 المزاد الأسطوري',
            description: '> للمزايدة اضغط زر **Bid** 👇',
            fields: [
                { name: 'الرتبة 🎖️', value: a.legendaryRoleId ? `<@&${a.legendaryRoleId}>` : 'غير محددة', inline: false },
                { name: 'الحالة 📌', value: a.active ? 'نشط ✅' : 'غير نشط ⛔', inline: true },
                { name: 'ينتهي ⏳', value: a.active ? `<t:${Math.floor(a.endsAt / 1000)}:R>` : '-', inline: true },
                { name: 'أعلى مزايدة 💰', value: a.active ? `**${UI.fmtNum(a.highestBid || 0)}** Luna Points ✨` : '-', inline: true },
                { name: 'أعلى مزايد 👑', value: a.active && a.highestBidderId ? `<@${a.highestBidderId}>` : 'لا يوجد', inline: true }
            ],
            footerText: 'المزاد الأسطوري'
        });

        const row = UI.row(
            UI.btn('shop:bid', 'Bid 💰', { style: ButtonStyle.Danger })
        );
        return respond({ embeds: [embed], components: [row] });
    }

    if (action === 'bid') {
        if (isOnCooldown(interaction.guild.id, interaction.user.id, 'bid')) {
            try { return await interaction.reply({ content: '⏳ لحظة شوي… انتظر/ي قليل قبل مزايدة ثانية.', ephemeral: true }); } catch { return true; }
        }

        const a = shop.auction || {};
        if (!a.active) {
            try { await interaction.reply({ content: '❌ ⛔ المزاد غير نشط حاليًا.', ephemeral: true }); } catch { }
            return true;
        }
        if (!a.legendaryRoleId) {
            try { await interaction.reply({ content: '❌ آسف بس الرتبة الأسطورية مو محددة للحين 3:', ephemeral: true }); } catch { }
            return true;
        }

        const minBid = a.minBid || 50;
        const modal = new ModalBuilder().setCustomId('shopModal:bid').setTitle('مزايدة على المزاد الأسطوري 🏆');
        const amount = new TextInputBuilder().setCustomId('amount').setLabel(`قيمة المزايدة (الحد الأدنى ${minBid})`).setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(amount));
        try { await interaction.showModal(modal); } catch { }
        return true;
    }

    const staticItems = getStaticShopItems();
    const section = action;
    let refs = [];

    if (section === 'daily') refs = (shop.daily && Array.isArray(shop.daily.items)) ? shop.daily.items : [];
    if (section === 'weekly') refs = (shop.weekly && Array.isArray(shop.weekly.items)) ? shop.weekly.items : [];
    if (section === 'roles') refs = (Array.isArray(shop.roleItems) ? shop.roleItems.map((x) => ({ id: x.id })) : []);
    if (section === 'titles') refs = (Array.isArray(shop.titleItems) ? shop.titleItems.map((x) => ({ id: x.id })) : []);
    if (section === 'limited') refs = (shop.limited && shop.limited.item) ? [shop.limited.item] : [];

    let items = refs.map((r) => staticItems.find((x) => x.id === r.id) || resolveCatalogItem(shop, r)).filter(Boolean);
    if (section === 'more') items = staticItems.filter((x) => x && !['mystery', 'limited'].includes(x.kind));

    if (!items.length) {
        if (section === 'weekly' || section === 'daily') {
            const hasCatalog =
                (Array.isArray(shop.roleItems) && shop.roleItems.length > 0) ||
                (Array.isArray(shop.titleItems) && shop.titleItems.length > 0);
            if (hasCatalog) {
                updateGuildShop(interaction.guild.id, (g) => {
                    const next = { ...g };
                    if (section === 'weekly') next.weekly = { weekKey: null, items: [] };
                    if (section === 'daily') next.daily = { dayKey: null, items: [] };
                    return next;
                });
                ensureRotations(interaction.guild.id);
                const refreshed = getGuildShop(interaction.guild.id);
                const freshRefs = section === 'weekly'
                    ? ((refreshed.weekly && Array.isArray(refreshed.weekly.items)) ? refreshed.weekly.items : [])
                    : ((refreshed.daily && Array.isArray(refreshed.daily.items)) ? refreshed.daily.items : []);
                items = freshRefs.map((r) => resolveCatalogItem(refreshed, r)).filter(Boolean);
            }
        }

        if (!items.length) {
            return respond({ content: '❌ ما فيه عناصر في هذا القسم حاليًا… خلّوا الأدمن يضيف عناصر عبر `/shopadminui` 🌙' });
        }
    }

    const options = items.slice(0, 25).map((it) => ({
        label: (it.name || it.title || 'عنصر').slice(0, 100),
        description: `النوع: ${shopKindAr(it.kind)} | السعر: ${UI.fmtNum(it.price)} | ${fmtRarity(it.rarity)}`.slice(0, 100),
        value: it.id
    }));

    const discount = getActiveDiscount(interaction.guild.id, interaction.user.id);
    const nextDailyTs = Math.floor(nextDailyResetTs() / 1000);
    const nextWeeklyTs = Math.floor(nextWeeklyResetTs() / 1000);
    const discountTxt = discount.percent > 0
        ? `\n\n> 🔥 **خصمك اليوم:** ${discount.percent}% (اليومي ${discount.base}% + أول شراء ${discount.first}%)`
        : '';

    const itemLines = items.slice(0, 25).map((it) => {
        const finalCost = applyDiscount(it.price, discount.percent);
        const priceTxt = discount.percent > 0
            ? `~~${UI.fmtNum(it.price)}~~ → **${UI.fmtNum(finalCost)}**`
            : `**${UI.fmtNum(it.price)}**`;
        return `- ${it.emoji || '🛍️'} **${it.name || it.title || 'عنصر'}** — ${fmtRarity(it.rarity)} — 💰 ${priceTxt} ✨`;
    }).join('\n');

    const embed = UI.embed({
        color: UI.COLORS.shop,
        title: '🛍️ متجر لونا — Luna Points ✨',
        description: [
            'اختار العنصر من القائمة بالأسفل 👇',
            '',
            '**العناصر المتاحة:**',
            itemLines,
            '',
            `> ⏳ **اليومي يتجدد:** <t:${nextDailyTs}:R>`,
            `> ⏳ **الأسبوعي يتجدد:** <t:${nextWeeklyTs}:R>`,
            '',
            '⭐ **Featured** — عنصر مميز يتغير يوميًا',
            '🎁 **Mystery Box** — صندوق مفاجأة بمكافآت عشوائية',
            '⚡ **بوستات** — مزايا مؤقتة مثل زيادة الخبرة',
            '🤝 **خدمات** — خدمات مفيدة مثل نقل XP وVIP',
            '🏆 **مزاد أسطوري** — مزايدة على رتبة أسطورية',
            '',
            '> 🛡️ المتجر محمي ضد الاستغلال (Cooldowns + منع الرصيد السالب)'
        ].join('\n') + discountTxt,
        footerText: `طلبته: ${interaction.user.tag}`
    });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`shopSelect:${section}`).setPlaceholder('اختار عنصر').addOptions(options)
    );

    return respond({ embeds: [embed], components: [row] });
}

async function handleShopSelect({ interaction }) {
    if (!(interaction.isStringSelectMenu && interaction.isStringSelectMenu())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopSelect:'))) return false;
    if (!interaction.guild) return true;

    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const itemId = interaction.values && interaction.values[0] ? interaction.values[0] : null;
    if (!itemId) return true;

    ensureRotations(interaction.guild.id);
    const shop = getGuildShop(interaction.guild.id);
    const staticItems = getStaticShopItems();
    const item = staticItems.find((x) => x.id === itemId) || resolveCatalogItem(shop, { id: itemId });
    if (!item) {
        try { await interaction.reply({ content: '❌ آسف بس هالعنصر ما عاد موجود 3:', ephemeral: true }); } catch { }
        return true;
    }

    const points = getLunaPoints(interaction.guild.id, interaction.user.id);

    const discount = getActiveDiscount(interaction.guild.id, interaction.user.id);
    const coupon = getPendingCoupon(interaction.guild.id, interaction.user.id, itemId);
    const totalPercent = Math.min(20, discount.percent + (coupon.percent || 0));
    const finalCost = applyDiscount(item.price, totalPercent);
    const afterBalance = points - finalCost;
    const discTxt = discount.percent > 0
        ? `\n\n> 🎟️ **خصمك:** ${totalPercent}% (اليومي ${discount.base}% + أول شراء ${discount.first}%${coupon.code ? ` + كود ${coupon.code} (${coupon.percent}%)` : ''})`
        : '';

    // معاينة المحتويات قبل الشراء
    const previews = [];
    if (item.kind === 'bundle') {
        previews.push(item.bundleType === 'power'
            ? '📦 **محتوى باقة القوة:** 2 بوستات (XP + Luna لمدة ساعة) + خدمة Reroll Daily + مقتنى 🚀 + **40** Luna Points'
            : '📦 **محتوى باقة البداية:** لقب 🌙 + XP Boost لمدة ساعة + **20** Luna Points');
    }
    if (item.kind === 'mystery') {
        const tier = String(item.mysteryTier || 'medium');
        const odds = tier === 'small'
            ? 'نقاط 8-25 (58%) · بوست (22%) · مقتنى (10%)'
            : tier === 'big'
                ? 'نقاط 35-95 (35%) · بوست (45%) · مقتنى (20%)'
                : 'نقاط 15-45 (55%) · بوست (35%) · مقتنى (10%)';
        previews.push(`🎲 **احتمالات الصندوق:** ${odds}`);
    }
    if (item.kind === 'service' && item.serviceType === 'reroll_daily') previews.push('🎲 يسمح لك بإعادة توليد العروض اليومية.');

    const desc = [
        `**${item.name || item.title}**`,
        '',
        `> 🏷️ **النوع:** ${shopKindAr(item.kind)}`,
        `> 🎲 **الندرة:** ${fmtRarity(item.rarity)}`,
        `> 💰 **السعر:** ~~${UI.fmtNum(item.price)}~~ → **${UI.fmtNum(finalCost)}** Luna Points ✨`,
        `> 🌙 **رصيدك:** ${UI.fmtNum(points)} → **${UI.fmtNum(Math.max(0, afterBalance))}** بعد الشراء`,
        ...previews.map((p) => `\n${p}`),
        (item.kind === 'collectible' ? '\n🎖️ يُضاف إلى مقتنياتك بشكل دائم.' : ''),
        (item.kind === 'limited' ? '\n🏷️ عنصر محدود يتغير يوميًا.' : '')
    ].filter(Boolean).join('\n');

    const embed = UI.embed({
        color: UI.COLORS.shop,
        title: '🛒 تأكيد الشراء',
        description: desc + discTxt,
        footerText: 'تأكيد الشراء'
    });

    const row = UI.row(
        UI.btn(`shopbuy:${itemId}`, 'شراء 🛍️', { style: ButtonStyle.Danger }),
        UI.btn(`shopgift:${itemId}`, 'إهداء 🎁', { style: ButtonStyle.Primary }),
        UI.btn(`shopcoupon:${itemId}`, 'إدخال كود خصم 🎟️', { style: ButtonStyle.Secondary }),
        UI.btn('shop:inventory', 'ممتلكاتي 🎒', { style: ButtonStyle.Secondary })
    );

    try { await interaction.reply({ embeds: [embed], components: [row], ephemeral: true }); } catch { }
    return true;
}

async function handleShopCouponButton({ interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopcoupon:'))) return false;
    if (!interaction.guild) return true;

    const itemId = interaction.customId.slice('shopcoupon:'.length);
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

    const modal = new ModalBuilder().setCustomId(`shopModal:coupon:${encodeURIComponent(itemId)}`).setTitle('إدخال كود خصم 🎟️');
    const code = new TextInputBuilder().setCustomId('code').setLabel('الكود').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(code));

    try { await interaction.showModal(modal); } catch { }
    return true;
}

async function handleShopCouponModal({ interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopModal:coupon:'))) return false;
    if (!interaction.guild) return true;

    const itemId = decodeURIComponent(interaction.customId.slice('shopModal:coupon:'.length));
    const raw = interaction.fields.getTextInputValue('code');
    const code = normalizeCouponCode(raw);
    if (!code) {
        try { await interaction.reply({ content: '❌ اكتبي كود صحيح 3:', ephemeral: true }); } catch { }
        return true;
    }

    const shop = getGuildShop(interaction.guild.id);
    const c = shop.coupons && typeof shop.coupons === 'object' ? shop.coupons[code] : null;
    if (!c) {
        try { await interaction.reply({ content: '❌ 🌙 الكود هذا غير موجود.', ephemeral: true }); } catch { }
        return true;
    }
    const percent = Math.max(0, Math.min(20, Math.floor(Number(c.percent) || 0)));
    if (!percent) {
        try { await interaction.reply({ content: '❌ 🌙 الكود هذا غير صالح.', ephemeral: true }); } catch { }
        return true;
    }
    const maxUses = Math.max(0, Math.floor(Number(c.maxUses) || 0));
    const used = Math.max(0, Math.floor(Number(c.used) || 0));
    if (maxUses > 0 && used >= maxUses) {
        try { await interaction.reply({ content: '❌ ⛔ هذا الكود خلصت استخداماته.', ephemeral: true }); } catch { }
        return true;
    }

    updateGuildShop(interaction.guild.id, (g) => {
        const next = { ...g };
        next.cooldowns = next.cooldowns || {};
        next.cooldowns[interaction.user.id] = {
            ...(next.cooldowns[interaction.user.id] || {}),
            couponCode: code,
            couponForItemId: String(itemId),
            couponExpiresAt: Date.now() + 5 * 60 * 1000
        };
        return next;
    });

    try {
        const logEmbed = UI.embed({
            color: UI.COLORS.logs,
            title: '🎟️ كود خصم: تم التطبيق',
            description: [
                `${interaction.user} طبّق كود **${code}** على المنتج: **${String(itemId).slice(0, 120)}**`,
                '',
                `> 🎟️ **نسبة الخصم:** ${percent}%`
            ].join('\n'),
            footerText: 'سجل المتجر'
        });
        await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
    } catch {
    }

    try { await interaction.reply({ content: `✅ 🌙 تم تطبيق الكود **${code}** (${percent}%). كمل الشراء من نفس المنتج.`, ephemeral: true }); } catch { }
    return true;
}

async function handleShopBuyButton({ interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopbuy:'))) return false;
    if (!interaction.guild) return true;

    const respondBuy = async (payload) => {
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
        return interaction.reply({ ...payload, ephemeral: true });
    };

    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }
    } catch {
    }

    if (!canUseCooldown(interaction.guild.id, interaction.user.id, 'buy')) {
        return respondBuy({ content: '⏳ لحظة شوي… انتظر قليل قبل شراء ثاني.' });
    }

    const itemId = interaction.customId.slice('shopbuy:'.length);
    ensureRotations(interaction.guild.id);
    const shop = getGuildShop(interaction.guild.id);
    const staticItems = getStaticShopItems();
    const item = staticItems.find((x) => x.id === itemId) || resolveCatalogItem(shop, { id: itemId });
    if (!isItemAvailableToday(shop, itemId)) return respondBuy({ content: '❌ هالصنف مو متوفر اليوم 3:' });
    if (!item) return respondBuy({ content: '❌ آسف بس هالعنصر ما عاد موجود 3:' });

    const discount = getActiveDiscount(interaction.guild.id, interaction.user.id);
    const coupon = getPendingCoupon(interaction.guild.id, interaction.user.id, itemId);
    const baseCost = Math.max(1, Math.floor(Number(item.price) || 0));

    const totalPercent = Math.min(20, discount.percent + (coupon.percent || 0));
    const cost = applyDiscount(baseCost, totalPercent);
    const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, cost);
    if (!spend.ok) {
        return respondBuy({ content: '❌ آسف بس Luna Points ما تكفي 😢' });
    }

    // المنح أولًا؛ الكوبون وأول شراء يُستهلكون فقط إذا نجح المنح
    const grantText = await grantItemToUser({
        guild: interaction.guild,
        receiverId: interaction.user.id,
        item,
        paidCost: cost,
        buyerId: interaction.user.id
    });
    const grantOk = !String(grantText || '').startsWith('❌');

    if (!grantOk) {
        // فشل المنح: grantItemToUser رجّعت المبلغ المدفوع، والكوبون يبقى معلقًا وما نعلّم أول شراء
        return respondBuy({ content: grantText });
    }

    // ينحفظ بسجل المشتريات 🧾
    recordPurchase(interaction.guild.id, interaction.user.id, {
        itemId: item.id,
        name: item.name || item.title,
        kind: item.kind,
        cost,
        at: Date.now()
    });

    if (coupon.code) {
        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            next.coupons = next.coupons && typeof next.coupons === 'object' ? { ...next.coupons } : {};
            const cur = next.coupons[coupon.code];
            if (!cur || typeof cur !== 'object') return next;
            const maxUses = Math.max(0, Math.floor(Number(cur.maxUses) || 0));
            const used = Math.max(0, Math.floor(Number(cur.used) || 0));
            if (maxUses > 0 && used >= maxUses) return next;
            next.coupons[coupon.code] = { ...cur, used: used + 1 };
            return next;
        });
    }
    clearPendingCoupon(interaction.guild.id, interaction.user.id);
    markFirstBuyDay(interaction.guild.id, interaction.user.id);

    try {
        const logEmbed = UI.embed({
            color: UI.COLORS.logs,
            title: '🛒 شراء من المتجر',
            description: [
                `${interaction.user} اشترى: **${String(item.id || itemId).slice(0, 80)}**`,
                '',
                `> 💰 **السعر:** ${UI.fmtNum(cost)} (بدل ${UI.fmtNum(baseCost)})`,
                `> 🎟️ **الخصم:** ${totalPercent}%${coupon.code ? ` — كود **${coupon.code}** (${coupon.percent}%)` : ''}`
            ].join('\n'),
            footerText: 'سجل المتجر'
        });
        await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
    } catch {
    }

    return respondBuy({ content: `${grantText}\n\n> 💰 **مدفوع:** ${UI.fmtNum(cost)} Luna Points (بدل ${UI.fmtNum(baseCost)})` });
}

async function handleShopGiftButton({ interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopgift:'))) return false;
    if (!interaction.guild) return true;

    const itemId = interaction.customId.slice('shopgift:'.length);
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
    const modal = new ModalBuilder().setCustomId(`shopModal:gift:${encodeURIComponent(itemId)}`).setTitle('إهداء عنصر 🎁');
    const userId = new TextInputBuilder()
        .setCustomId('userId')
        .setLabel('منشن المستخدم أو ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(userId));
    try { await interaction.showModal(modal); } catch { }
    return true;
}

async function handleShopGiftModal({ interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shopModal:gift:'))) return false;
    if (!interaction.guild) return true;

    const respond = async (payload) => {
        try { return await interaction.reply({ ...payload, ephemeral: true }); } catch { return true; }
    };

    const itemId = decodeURIComponent(interaction.customId.slice('shopModal:gift:'.length));
    const raw = String(interaction.fields.getTextInputValue('userId') || '');
    const m = raw.match(/\d{16,20}/);
    const targetId = m ? String(m[0]) : '';
    if (!targetId) return respond({ content: '❌ اكتبي منشن/ID صحيح 3:' });
    if (targetId === String(interaction.user.id)) return respond({ content: '💡 ملاحظة: هذا حسابك، استخدم شراء عادي 😄' });

    let target;
    try { target = await interaction.guild.members.fetch(targetId); } catch { target = null; }
    if (!target || target.user.bot) return respond({ content: '❌ ما قدرت أحدد عضو صالح للإهداء… تأكد من المنشن 3:' });

    if (!canUseCooldown(interaction.guild.id, interaction.user.id, 'gift')) {
        return respond({ content: '⏳ انتظر قليل قبل عملية إهداء ثانية.' });
    }

    const { shop, item } = getItemById(interaction.guild.id, itemId);
    if (!isItemAvailableToday(shop, itemId)) return respond({ content: '❌ هالصنف مو متوفر اليوم 3:' });
    if (!item) return respond({ content: '❌ هذا العنصر مو متاح الآن 3:' });

    const discount = getActiveDiscount(interaction.guild.id, interaction.user.id);
    const coupon = getPendingCoupon(interaction.guild.id, interaction.user.id, itemId);
    const baseCost = Math.max(1, Math.floor(Number(item.price) || 0));
    const totalPercent = Math.min(20, discount.percent + (coupon.percent || 0));
    const cost = applyDiscount(baseCost, totalPercent);
    const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, cost);
    if (!spend.ok) return respond({ content: '❌ رصيدك ما يكفي للإهداء 😢' });

    // المنح أولًا؛ الكوبون وأول شراء يُستهلكون فقط إذا نجح المنح
    const grantText = await grantItemToUser({
        guild: interaction.guild,
        receiverId: targetId,
        item,
        paidCost: cost,
        buyerId: interaction.user.id
    });
    const grantOk = !String(grantText || '').startsWith('❌');

    if (!grantOk) {
        // فشل المنح: grantItemToUser رجّعت المبلغ المدفوع، والكوبون يبقى معلقًا وما نعلّم أول شراء
        return respond({ content: grantText });
    }

    // ينحفظ بسجل المشتريات للمندوب والمستلم 🧾
    recordPurchase(interaction.guild.id, interaction.user.id, {
        itemId: item.id,
        name: item.name || item.title,
        kind: item.kind,
        cost,
        at: Date.now(),
        buyerId: interaction.user.id,
        receiverId: targetId
    });
    recordPurchase(interaction.guild.id, targetId, {
        itemId: item.id,
        name: item.name || item.title,
        kind: item.kind,
        cost,
        at: Date.now(),
        buyerId: interaction.user.id,
        receiverId: targetId
    });

    if (coupon.code) {
        updateGuildShop(interaction.guild.id, (g) => {
            const next = { ...g };
            next.coupons = next.coupons && typeof next.coupons === 'object' ? { ...next.coupons } : {};
            const cur = next.coupons[coupon.code];
            if (!cur || typeof cur !== 'object') return next;
            const maxUses = Math.max(0, Math.floor(Number(cur.maxUses) || 0));
            const used = Math.max(0, Math.floor(Number(cur.used) || 0));
            if (maxUses > 0 && used >= maxUses) return next;
            next.coupons[coupon.code] = { ...cur, used: used + 1 };
            return next;
        });
    }
    clearPendingCoupon(interaction.guild.id, interaction.user.id);
    markFirstBuyDay(interaction.guild.id, interaction.user.id);

    try {
        const logEmbed = UI.embed({
            color: UI.COLORS.logs,
            title: '🎁 إهداء من المتجر',
            description: [
                `${interaction.user} أهدى **${item.name || item.id}** إلى ${target}`,
                '',
                `> 💰 **السعر:** ${UI.fmtNum(cost)} Luna Points`
            ].join('\n'),
            footerText: 'سجل المتجر'
        });
        await sendGuildLog(interaction.guild, { embeds: [logEmbed] });
    } catch {}

    return respond({ content: `✅ تم الإهداء بنجاح.\n${grantText}\n\n> 💰 **مدفوع:** ${UI.fmtNum(cost)} Luna Points (بدل ${UI.fmtNum(baseCost)})` });
}

async function handleShopBidModal({ interaction }) {
    if (!(interaction.isModalSubmit && interaction.isModalSubmit())) return false;
    if (interaction.customId !== 'shopModal:bid') return false;

    if (!interaction.guild) return true;
    if (!canUseCooldown(interaction.guild.id, interaction.user.id, 'bid')) {
        try { await interaction.reply({ content: '⏳ لحظة شوي… انتظر قليل قبل مزايدة ثانية.', ephemeral: true }); } catch { }
        return true;
    }

    const shop = getGuildShop(interaction.guild.id);
    const a = shop.auction || {};
    if (!a.active) {
        try { await interaction.reply({ content: '❌ ⛔ المزاد غير نشط حاليًا.', ephemeral: true }); } catch { }
        return true;
    }

    const minBid = a.minBid || 50;
    const amtRaw = (interaction.fields.getTextInputValue('amount') || '').trim();
    const amount = Math.floor(Number(amtRaw) || 0);
    if (!amount || amount < minBid) {
        try { await interaction.reply({ content: `❌ آسف بس أقل مزايدة هي **${UI.fmtNum(minBid)}** Luna Points 3:`, ephemeral: true }); } catch { }
        return true;
    }
    const currentHigh = a.highestBid || 0;
    if (amount <= currentHigh) {
        try { await interaction.reply({ content: `❌ لازم مزايدتك تكون أعلى من الحالية (**${UI.fmtNum(currentHigh)}**).`, ephemeral: true }); } catch { }
        return true;
    }

    const spend = spendLunaPoints(interaction.guild.id, interaction.user.id, amount);
    if (!spend.ok) {
        try { await interaction.reply({ content: '❌ آسف بس رصيدك ما يكفي لهالمزايدة 😢', ephemeral: true }); } catch { }
        return true;
    }

    if (a.highestBidderId) {
        addLunaPoints(interaction.guild.id, a.highestBidderId, a.highestBid || 0);
    }

    updateGuildShop(interaction.guild.id, (g) => {
        const next = { ...g };
        const prev = next.auction || {};
        const bids = Array.isArray(prev.bids) ? [...prev.bids] : [];
        bids.push({ userId: interaction.user.id, amount, at: Date.now() });
        next.auction = {
            ...prev,
            highestBid: amount,
            highestBidderId: interaction.user.id,
            bids
        };
        return next;
    });

    try { await interaction.reply({ content: `✅ 💰 تم تسجيل مزايدتك: **${UI.fmtNum(amount)}** Luna Points ✨`, ephemeral: true }); } catch { }
    return true;
}

// سجل المشتريات 🧾
async function handleShopHistoryButton({ interaction }) {
    if (!(interaction.isButton && interaction.isButton())) return false;
    if (!(typeof interaction.customId === 'string' && interaction.customId.startsWith('shophistory:'))) return false;
    if (!interaction.guild) return true;

    const parts = interaction.customId.split(':');
    const ownerId = parts[1] || '';
    if (ownerId && String(interaction.user.id) !== String(ownerId)) {
        try { await interaction.reply({ content: 'هالسجل مو لك 3:', ephemeral: true }); } catch { }
        return true;
    }
    const targetId = parts[2] || interaction.user.id;

    const list = getPurchases(interaction.guild.id, targetId).slice(0, 10);
    const lines = list.map((p) => {
        const when = p.at ? `<t:${Math.floor(Number(p.at) / 1000)}:R>` : 'قبل';
        const giftNote = p.buyerId && String(p.buyerId) !== String(targetId) ? ` · 🎁 من <@${p.buyerId}>` : '';
        return `> ${when} — **${p.name || p.itemId}** · ${UI.fmtNum(p.cost)} 🌙${giftNote}`;
    });

    const embed = UI.embed({
        color: UI.COLORS.shop,
        title: '🧾 سجل المشتريات',
        description: lines.length ? lines.join('\n').slice(0, 3900) : 'ما فيه مشتريات مسجلة لسه ✨',
        footerText: lines.length ? `آخر ${lines.length} عمليات` : 'سجل فاضي'
    });

    try { await interaction.reply({ embeds: [embed], ephemeral: true }); } catch { }
    return true;
}

async function handle({ client, interaction }) {
    if (await handleShopAdminButtons({ interaction })) return true;
    if (await handleShopAdminSelectRemove({ interaction })) return true;
    if (await handleShopAdminModal({ interaction })) return true;

    if (await handleShopButtons({ interaction })) return true;
    if (await handleShopSelect({ interaction })) return true;
    if (await handleShopHistoryButton({ interaction })) return true;
    if (await handleShopCouponButton({ interaction })) return true;
    if (await handleShopCouponModal({ interaction })) return true;
    if (await handleShopGiftButton({ interaction })) return true;
    if (await handleShopGiftModal({ interaction })) return true;
    if (await handleShopBuyButton({ interaction })) return true;
    if (await handleShopBidModal({ interaction })) return true;

    return false;
}

module.exports = { handle };
