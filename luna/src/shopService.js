function pickOne(arr) {
    const a = Array.isArray(arr) ? arr : [];
    if (a.length === 0) return null;
    return a[Math.floor(Math.random() * a.length)];
}

function fmtRarity(r) {
    if (r === 'mythic') return 'خرافي 🔮';
    if (r === 'legendary') return 'أسطوري 🏆';
    if (r === 'rare') return 'نادر 💎';
    if (r === 'uncommon') return 'غير شائع 🌿';
    return 'شائع ⭐';
}

function normalizeRarity(r) {
    const s = String(r || '').toLowerCase().trim();
    if (s === 'uncommon' || s === 'uc') return 'uncommon';
    if (s === 'rare') return 'rare';
    if (s === 'legendary') return 'legendary';
    if (s === 'mythic') return 'mythic';
    return 'common';
}

function normalizeRotation(v) {
    const s = String(v || '').toLowerCase().trim();
    if (s === 'daily' || s === 'd') return 'daily';
    if (s === 'weekly' || s === 'w') return 'weekly';
    return 'both';
}

function itemInRotation(item, rotation) {
    const r = normalizeRotation(item && typeof item.rotation === 'string' ? item.rotation : 'both');
    if (r === 'both') return true;
    return r === rotation;
}

function allowMythicInRotation() {
    return Math.random() < 0.05;
}

function pickWeighted(items, count) {
    const pool = Array.isArray(items) ? items.filter(Boolean) : [];
    const out = [];
    const used = new Set();

    const weightFor = (r) => {
        if (r === 'mythic') return 1;
        if (r === 'legendary') return 2;
        if (r === 'rare') return 6;
        if (r === 'uncommon') return 10;
        return 12;
    };

    for (let n = 0; n < Math.max(0, Math.floor(count || 0)); n++) {
        const candidates = pool.filter((x) => x && x.id && !used.has(x.id));
        if (!candidates.length) break;

        const total = candidates.reduce((sum, it) => sum + weightFor(it.rarity), 0);
        let r = Math.random() * (total || 1);
        let picked = candidates[0];
        for (const it of candidates) {
            r -= weightFor(it.rarity);
            if (r <= 0) {
                picked = it;
                break;
            }
        }

        used.add(picked.id);
        out.push(picked);
    }
    return out;
}

function dayKey(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function weekKey(ts = Date.now()) {
    const d = new Date(ts);
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function nextDailyResetTs(ts = Date.now()) {
    const d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

function nextWeeklyResetTs(ts = Date.now()) {
    const d = new Date(ts);
    const dow = d.getUTCDay();
    const daysToNextMonday = (8 - dow) % 7 || 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToNextMonday, 0, 0, 0);
}

function resolveCatalogItem(shop, ref) {
    if (!ref || !ref.id) return null;
    const roleItems = Array.isArray(shop.roleItems) ? shop.roleItems : [];
    const titleItems = Array.isArray(shop.titleItems) ? shop.titleItems : [];
    const found = roleItems.find((x) => x && x.id === ref.id) || titleItems.find((x) => x && x.id === ref.id);
    if (!found) return null;
    const kind = found.roleId ? 'role' : 'title';
    return { ...found, kind };
}

function getStaticShopItems() {
    return [
        { id: 'mystery:small', kind: 'mystery', name: '🎁 صندوق صغير', price: 45, rarity: 'uncommon', mysteryTier: 'small' },
        { id: 'mystery:box', kind: 'mystery', name: '🎁 صندوق مفاجأة لونا', price: 65, rarity: 'rare', mysteryTier: 'medium' },
        { id: 'mystery:big', kind: 'mystery', name: '🎁 صندوق كبير', price: 120, rarity: 'legendary', mysteryTier: 'big' },
        { id: 'boost:xp25_1h', kind: 'boost', name: '⚡ XP Boost +25% (ساعة)', price: 35, rarity: 'rare', boostType: 'xp_boost_25_1h', durationMs: 60 * 60 * 1000 },
        { id: 'boost:xp15_24h', kind: 'boost', name: '⚡ XP Boost +15% (يوم)', price: 120, rarity: 'rare', boostType: 'xp_boost_15_24h', durationMs: 24 * 60 * 60 * 1000 },
        { id: 'boost:luna25_1h', kind: 'boost', name: '💰 Luna Boost +25% (ساعة)', price: 60, rarity: 'rare', boostType: 'luna_boost_25_1h', durationMs: 60 * 60 * 1000 },
        { id: 'boost:levelup50_1h', kind: 'boost', name: '🏅 Boost مكافأة الترفيع +50% (ساعة)', price: 110, rarity: 'rare', boostType: 'levelup_reward_boost_50_1h', durationMs: 60 * 60 * 1000 },
        { id: 'service:rename_once', kind: 'service', name: '📝 بطاقة تغيير الاسم (مرة واحدة)', price: 75, rarity: 'rare', serviceType: 'rename_once' },
        { id: 'service:xp_transfer', kind: 'service', name: '🎯 خدمة نقل XP (مرة واحدة)', price: 180, rarity: 'rare', serviceType: 'xp_transfer' },
        { id: 'service:shield', kind: 'service', name: '🛡️ درع الحماية (يخفف خسارة إعادة التوازن) (مرة واحدة)', price: 90, rarity: 'rare', serviceType: 'shield' },
        { id: 'service:rebalance', kind: 'service', name: '🔄 إعادة توازن (خصم من الرصيد + تصفير XP) (مرة واحدة)', price: 140, rarity: 'rare', serviceType: 'rebalance' },
        { id: 'service:vip_title', kind: 'service', name: '👑 لقب VIP لمدة 24 ساعة (مرة واحدة)', price: 95, rarity: 'rare', serviceType: 'vip_title' },
        { id: 'service:reroll_daily', kind: 'service', name: '🎲 إعادة توليد العروض اليومية (مرة واحدة)', price: 130, rarity: 'legendary', serviceType: 'reroll_daily' },
        { id: 'collectible:luna_moon', kind: 'collectible', name: '🌙 ميدالية قمر لونا', price: 80, rarity: 'rare', collectibleId: 'luna_moon', emoji: '🌙' },
        { id: 'collectible:star_seed', kind: 'collectible', name: '⭐ بذرة النجمة', price: 95, rarity: 'rare', collectibleId: 'star_seed', emoji: '⭐' },
        { id: 'collectible:crystal_leaf', kind: 'collectible', name: '🍃 ورقة كريستالية', price: 110, rarity: 'legendary', collectibleId: 'crystal_leaf', emoji: '🍃' },
        { id: 'bundle:starter', kind: 'bundle', name: '📦 باقة البداية', price: 140, rarity: 'rare', bundleType: 'starter' },
        { id: 'bundle:power', kind: 'bundle', name: '🚀 باقة القوة', price: 260, rarity: 'legendary', bundleType: 'power' },
        { id: 'limited:flash_title', kind: 'limited', name: '⚡ لقب محدود: برق لونا', price: 150, rarity: 'legendary', title: '⚡ برق لونا' },
        { id: 'limited:flash_badge', kind: 'limited', name: '💎 ميدالية محدودة: شرارة', price: 175, rarity: 'legendary', collectibleId: 'flash_spark', emoji: '💎' }
    ];
}

function ensureRotations(guildId) {
    const { getGuildShop, updateGuildShop } = require('./shopStore');
    const shop = getGuildShop(guildId);
    const roleItems = Array.isArray(shop.roleItems) ? shop.roleItems : [];
    const titleItems = Array.isArray(shop.titleItems) ? shop.titleItems : [];
    const allCatalog = [
        ...roleItems.map((x) => ({ ...x, kind: 'role' })),
        ...titleItems.map((x) => ({ ...x, kind: 'title' }))
    ];

    const dailyCatalog = allCatalog.filter((x) => itemInRotation(x, 'daily'));
    const weeklyCatalog = allCatalog.filter((x) => itemInRotation(x, 'weekly'));

    const dailyCatalogKey = dailyCatalog.map((x) => x && x.id).filter(Boolean).sort().join('|');
    const weeklyCatalogKey = weeklyCatalog.map((x) => x && x.id).filter(Boolean).sort().join('|');

    const dk = dayKey();
    const wk = weekKey();

    const dailyRefs = (shop.daily && Array.isArray(shop.daily.items)) ? shop.daily.items : [];
    const weeklyRefs = (shop.weekly && Array.isArray(shop.weekly.items)) ? shop.weekly.items : [];

    const dailyResolvedCount = dailyRefs.map((r) => resolveCatalogItem(shop, r)).filter(Boolean).length;
    const weeklyResolvedCount = weeklyRefs.map((r) => resolveCatalogItem(shop, r)).filter(Boolean).length;

    const shouldRegenDaily =
        !shop.daily ||
        shop.daily.dayKey !== dk ||
        (shop.daily.dayKey === dk && (shop.daily.catalogKey || '') !== dailyCatalogKey) ||
        (shop.daily.dayKey === dk && dailyRefs.length === 0 && dailyCatalog.length > 0) ||
        (shop.daily.dayKey === dk && dailyRefs.length > 0 && dailyResolvedCount === 0 && dailyCatalog.length > 0);

    if (shouldRegenDaily) {
        updateGuildShop(guildId, (g) => {
            const next = { ...g };
            const yesterday = (next.daily && Array.isArray(next.daily.items)) ? next.daily.items : [];
            const yesterdayIds = new Set(yesterday.map((x) => x && x.id).filter(Boolean));

            const mythicOk = allowMythicInRotation();
            let dailyForPicks = mythicOk ? dailyCatalog : dailyCatalog.filter((x) => x && x.rarity !== 'mythic');
            if (!dailyForPicks.length && dailyCatalog.length) dailyForPicks = dailyCatalog;

            const poolFresh = dailyForPicks.filter((x) => x && x.id && !yesterdayIds.has(x.id));
            let picked = pickWeighted(poolFresh, 4);
            if (picked.length < 4) {
                const already = new Set(picked.map((x) => x.id));
                const poolAny = dailyForPicks.filter((x) => x && x.id && !already.has(x.id));
                picked = [...picked, ...pickWeighted(poolAny, 4 - picked.length)];
            }

            const items = picked.slice(0, 4).map((i) => ({ id: i.id, kind: i.kind }));
            next.daily = { dayKey: dk, catalogKey: dailyCatalogKey, items };

            const featuredPick = pickWeighted(dailyForPicks, 1)[0] || null;
            next.featured = { dayKey: dk, item: featuredPick ? { id: featuredPick.id, kind: featuredPick.kind } : null };

            const limitedPool = getStaticShopItems().filter((x) => x && x.kind === 'limited');
            const limitedPick = pickOne(limitedPool);
            next.limited = { dayKey: dk, item: limitedPick ? { id: limitedPick.id, kind: limitedPick.kind } : null };

            const pct = 3 + Math.floor(Math.random() * 8);
            next.dailyDiscount = { dayKey: dk, percent: pct };
            return next;
        });
    }

    const shouldRegenWeekly =
        !shop.weekly ||
        shop.weekly.weekKey !== wk ||
        (shop.weekly.weekKey === wk && (shop.weekly.catalogKey || '') !== weeklyCatalogKey) ||
        (shop.weekly.weekKey === wk && weeklyRefs.length === 0 && weeklyCatalog.length > 0) ||
        (shop.weekly.weekKey === wk && weeklyRefs.length > 0 && weeklyResolvedCount === 0 && weeklyCatalog.length > 0);

    if (shouldRegenWeekly) {
        updateGuildShop(guildId, (g) => {
            const next = { ...g };
            const lastWeek = (next.weekly && Array.isArray(next.weekly.items)) ? next.weekly.items : [];
            const lastWeekIds = new Set(lastWeek.map((x) => x && x.id).filter(Boolean));

            const mythicOk = allowMythicInRotation();
            let weeklyForPicks = mythicOk ? weeklyCatalog : weeklyCatalog.filter((x) => x && x.rarity !== 'mythic');
            if (!weeklyForPicks.length && weeklyCatalog.length) weeklyForPicks = weeklyCatalog;

            const poolFresh = weeklyForPicks.filter((x) => x && x.id && !lastWeekIds.has(x.id));
            let picked = pickWeighted(poolFresh, 4);
            if (picked.length < 4) {
                const already = new Set(picked.map((x) => x.id));
                const poolAny = weeklyForPicks.filter((x) => x && x.id && !already.has(x.id));
                picked = [...picked, ...pickWeighted(poolAny, 4 - picked.length)];
            }

            const items = picked.slice(0, 4).map((i) => ({ id: i.id, kind: i.kind }));
            next.weekly = { weekKey: wk, catalogKey: weeklyCatalogKey, items };
            return next;
        });
    }
}

function getActiveDiscount(guildId, userId) {
    const { getGuildShop } = require('./shopStore');
    ensureRotations(guildId);
    const shop = getGuildShop(guildId);
    const dk = dayKey();

    const base = shop.dailyDiscount && shop.dailyDiscount.dayKey === dk
        ? Math.max(0, Math.min(20, Math.floor(Number(shop.dailyDiscount.percent) || 0)))
        : 0;

    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const first = cd.firstBuyDayKey === dk ? 0 : 5;

    const percent = Math.min(20, base + first);
    return { percent, base, first };
}

function applyDiscount(cost, percent) {
    const c = Math.max(1, Math.floor(Number(cost) || 0));
    // الخصم الكلي = خصم اليومي/أول شراء + الكوبون، بحد أقصى 80% حتى لا يصير السعر صفر
    const p = Math.max(0, Math.min(80, Math.floor(Number(percent) || 0)));
    return Math.max(1, Math.floor(c * (100 - p) / 100));
}

function normalizeCouponCode(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .slice(0, 24);
}

function getPendingCoupon(guildId, userId, itemId) {
    const { getGuildShop } = require('./shopStore');
    const shop = getGuildShop(guildId);
    const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
    const code = typeof cd.couponCode === 'string' ? cd.couponCode : '';
    const forItem = typeof cd.couponForItemId === 'string' ? cd.couponForItemId : '';
    const exp = Number(cd.couponExpiresAt) || 0;
    if (!code || !forItem || !exp) return { code: null, percent: 0 };
    if (Date.now() >= exp) return { code: null, percent: 0 };
    if (String(forItem) !== String(itemId || '')) return { code: null, percent: 0 };

    const c = shop.coupons && typeof shop.coupons === 'object' ? shop.coupons[code] : null;
    if (!c) return { code: null, percent: 0 };
    const expAt = Number(c.expiresAt) || 0;
    if (expAt && Date.now() >= expAt) return { code: null, percent: 0 };
    const maxUses = Math.max(0, Math.floor(Number(c.maxUses) || 0));
    const used = Math.max(0, Math.floor(Number(c.used) || 0));
    if (maxUses > 0 && used >= maxUses) return { code: null, percent: 0 };
    const percent = Math.max(0, Math.min(20, Math.floor(Number(c.percent) || 0)));
    return { code, percent };
}

function shopKindAr(kind) {
    if (kind === 'role') return 'رتبة';
    if (kind === 'title') return 'لقب';
    if (kind === 'boost') return 'بوست';
    if (kind === 'service') return 'خدمة';
    if (kind === 'mystery') return 'صندوق مفاجأة';
    if (kind === 'collectible') return 'مقتنى';
    if (kind === 'bundle') return 'باقة';
    if (kind === 'limited') return 'عنصر محدود';
    if (kind === 'social') return 'اجتماعي';
    return 'عنصر';
}

function extractId(value) {
    if (!value) return null;
    const m = String(value).match(/\d{5,}/);
    return m ? m[0] : null;
}

// بطاقة إعلانات العروض 🛒
function buildRestockEmbed(shop) {
    const UI = require('./utils/ui');
    const s = shop && typeof shop === 'object' ? shop : {};

    // نفس منطق الشراء: العناصر الثابتة أولًا، بعدها كتالوج الإدارة
    const resolve = (ref) => {
        if (!ref) return null;
        const id = ref.id || ref;
        return getStaticShopItems().find((x) => x.id === id) || resolveCatalogItem(s, ref) || resolveCatalogItem(s, { id });
    };

    const dailyRefs = s.daily && Array.isArray(s.daily.items) ? s.daily.items : [];
    const dailyItems = dailyRefs.map(resolve).filter(Boolean);
    const featured = s.featured && s.featured.item ? resolve(s.featured.item) : null;
    const limited = s.limited && s.limited.item ? resolve(s.limited.item) : null;
    const discount = s.dailyDiscount && Number(s.dailyDiscount.percent) > 0 ? Math.floor(Number(s.dailyDiscount.percent)) : 0;

    const itemLine = (x) => `**${x.name || x.title}** — ${fmtRarity(x.rarity)} · \`${UI.fmtNum(x.price)}\` 🌙${x.description ? `\n> 📝 ${String(x.description).slice(0, 120)}` : ''}`;

    const fields = [];
    if (featured) fields.push({ name: '⭐ عرض اليوم المميز', value: itemLine(featured), inline: false });
    if (limited) fields.push({ name: '🏷️ المحدود (اليوم فقط)', value: itemLine(limited), inline: false });
    if (dailyItems.length) {
        fields.push({ name: '🎲 عروض اليوم', value: dailyItems.map((x) => `> ${itemLine(x)}`).join('\n').slice(0, 1024), inline: false });
    }
    if (discount) fields.push({ name: '🎟️ خصم اليوم', value: `**${discount}%** على عروض اليوم!`, inline: true });

    return UI.embed({
        title: '🛒 العروض الجديدة جاهزة!',
        description: 'لفّة المتجر تغيّرت ✨ افتح `/shop` وشوف الجديد قبل ما يخلص.',
        color: UI.COLORS.shop,
        fields
    });
}

// ينشر الإعلان عند تغيّر اللفة اليومية/الأسبوعية — يُستدعى من مؤقت بـ index.js
async function runShopAnnounceTick(client) {
    const { getGuildConfig } = require('./guildConfig');
    const shopStore = require('./shopStore');

    const guildIds = shopStore.getAllGuildIds();
    for (const guildId of guildIds) {
        try {
            const cfg = getGuildConfig(guildId);
            const s = cfg.shop && typeof cfg.shop === 'object' ? cfg.shop : null;
            if (!s || !s.announceEnabled || !s.announceChannelId) continue;

            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;

            ensureRotations(guildId);
            const shop = shopStore.getGuildShop(guildId);
            const dayKeyNow = shop.daily && shop.daily.dayKey ? String(shop.daily.dayKey) : null;
            const weekKeyNow = shop.weekly && shop.weekly.weekKey ? String(shop.weekly.weekKey) : null;
            const state = shop.announceState && typeof shop.announceState === 'object' ? shop.announceState : {};

            const newDay = Boolean(dayKeyNow) && dayKeyNow !== String(state.dayKey || '');
            const newWeek = Boolean(weekKeyNow) && weekKeyNow !== String(state.weekKey || '');
            if (!newDay && !newWeek) continue;

            // نعلّم الحالة أولًا عشان ما يتكرر الإرسال لو فشل
            shopStore.updateGuildShop(guildId, (g) => ({
                ...g,
                announceState: { dayKey: dayKeyNow, weekKey: weekKeyNow }
            }));

            const ch = await guild.channels.fetch(s.announceChannelId).catch(() => null);
            if (!ch || !ch.isTextBased()) continue;

            await ch.send({ embeds: [buildRestockEmbed(shop)] }).catch(() => null);
        } catch {
            // نكمل على السيرفر التالي
        }
    }
}

module.exports = {
    pickOne,
    pickWeighted,
    fmtRarity,
    normalizeRarity,
    normalizeRotation,
    dayKey,
    weekKey,
    nextDailyResetTs,
    nextWeeklyResetTs,
    resolveCatalogItem,
    getStaticShopItems,
    ensureRotations,
    getActiveDiscount,
    applyDiscount,
    normalizeCouponCode,
    getPendingCoupon,
    shopKindAr,
    extractId,
    buildRestockEmbed,
    runShopAnnounceTick
};
