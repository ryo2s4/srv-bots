const { getUserInventory, updateUserInventory, getGuildShop, updateGuildShop, recordPurchase, getPurchases } = require('../shopStore');
const { getLunaPoints, addLunaPoints, spendLunaPoints, getUserStats, updateUserStats } = require('../levelsStore');
const { getGuildConfig } = require('../guildConfig');
const {
 getStaticShopItems, ensureRotations, resolveCatalogItem, getActiveDiscount,
 applyDiscount, normalizeCouponCode, getPendingCoupon, shopKindAr, dayKey, weekKey
} = require('../shopService');
const {
 grantItemToUser, isItemAvailableToday, canUseCooldown, clearPendingCoupon, markFirstBuyDay
} = require('../handlers/shop');
const {
 TIERS, TIER_LIST, getRuneBoosts, fmtPct, getRuneValue, getRuneBuyPrice,
 getRerollPrice, rerollRune, REROLL_CAP, FUSE_COST, fuseRunes,
 getUpgradeCost, getUpgradeCap, getRuneStars, upgradeRune, generateRuneForTier
} = require('../runes');
const { getBoostNameAr, formatRemainingAr } = require('../boostMeta');

const MAX_EQUIPPED = 3;

function esc(s) {
 return String(s ?? '')
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;')
 .replace(/'/g, '&#39;');
}

function fmtNum(n) {
 return Math.floor(Number(n) || 0).toLocaleString('en-US');
}

function stripEmoji(s) {
 return String(s ?? '')
 .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, '')
 .replace(/[ \t]{2,}/g, ' ')
 .trim();
}

function clean(s) {
 return esc(stripEmoji(s));
}

function rar(r) {
 const map = { common: 'شائع', uncommon: 'غير شائع', rare: 'نادر', epic: 'ملحمي', legendary: 'أسطوري', mythic: 'خرافي' };
 const k = String(r || 'common');
 return map[k] || k;
}

function runeLine(rune) {
 const boosts = getRuneBoosts(rune);
 return boosts.map((b) => `${b.type === 'xp_boost' ? 'XP' : b.type === 'luna_boost' ? 'Luna' : 'Level-Up'} ${fmtPct(b.multiplier)}`).join(' + ');
}

async function fetchGuildAndUser(client, guildId, userId) {
 let guild = client.guilds.cache.get(String(guildId));
 if (!guild) guild = await client.guilds.fetch(String(guildId)).catch(() => null);
 let member = guild ? guild.members.cache.get(String(userId)) : null;
 if (!member && guild) member = await guild.members.fetch(String(userId)).catch(() => null);
 let user = member?.user || client.users.cache.get(String(userId)) || null;
 if (!user) user = await client.users.fetch(String(userId)).catch(() => null);
 return { guild, member, user };
}

function getItemList(shop, section) {
 const staticItems = getStaticShopItems();
 let refs = [];
 if (section === 'daily') refs = shop.daily && Array.isArray(shop.daily.items) ? shop.daily.items : [];
 if (section === 'weekly') refs = shop.weekly && Array.isArray(shop.weekly.items) ? shop.weekly.items : [];
 if (section === 'roles') refs = (Array.isArray(shop.roleItems) ? shop.roleItems : []).map((x) => ({ id: x.id }));
 if (section === 'titles') refs = (Array.isArray(shop.titleItems) ? shop.titleItems : []).map((x) => ({ id: x.id }));

 let items = refs.map((r) => staticItems.find((x) => x.id === r.id) || resolveCatalogItem(shop, r)).filter(Boolean);
 if (section === 'more') items = staticItems.filter((x) => x && !['mystery', 'limited'].includes(x.kind));
 if (section === 'mystery') items = staticItems.filter((x) => x && x.kind === 'mystery');
 if (section === 'featured') {
 const ref = shop.featured && shop.featured.dayKey === dayKey() ? shop.featured.item : null;
 items = ref ? [staticItems.find((x) => x.id === ref.id) || resolveCatalogItem(shop, ref)].filter(Boolean) : [];
 }
 if (section === 'limited') {
 const ref = shop.limited && shop.limited.dayKey === dayKey() ? shop.limited.item : null;
 items = ref ? [staticItems.find((x) => x.id === ref.id) || resolveCatalogItem(shop, ref)].filter(Boolean) : [];
 }
 if (section === 'utility') {
 const { isUtilityRoleItem } = require('../handlers/shop');
 items = (Array.isArray(shop.roleItems) ? shop.roleItems : [])
 .map((x) => resolveCatalogItem(shop, { id: x.id }))
 .filter((x) => x && (x.utility === true || isUtilityRoleItem(x)));
 }
 return items;
}

async function buildYouData(client, guildId, userId) {
 ensureRotations(guildId);
 const shop = getGuildShop(guildId);
 const inv = getUserInventory(guildId, userId);
 const balance = getLunaPoints(guildId, userId);
 const { guild } = await fetchGuildAndUser(client, guildId, userId);
 const discount = getActiveDiscount(guildId, userId);

 const sections = {};
 for (const section of ['featured', 'limited', 'daily', 'weekly', 'more', 'mystery', 'utility']) {
 sections[section] = getItemList(shop, section).map((it) => ({
 id: it.id,
 name: stripEmoji(it.name || it.title || it.id),
 desc: it.description || '',
 kind: shopKindAr(it.kind),
 rarity: rar(it.rarity),
 price: Math.max(0, Math.floor(Number(it.price) || 0)),
 finalPrice: applyDiscount(it.price, discount.percent)
 }));
 }

 const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
 const equippedIds = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
 const runes = allRunes.slice().sort((a, b) => TIER_LIST.indexOf(b.tier) - TIER_LIST.indexOf(a.tier)).map((r) => {
 const cap = getUpgradeCap(r.tier);
 const stars = getRuneStars(r);
 return {
 id: r.id,
 tier: TIERS[r.tier] ? TIERS[r.tier].label : r.tier,
 stars,
 cap,
 boosts: runeLine(r),
 value: getRuneValue(r),
 upgradeCost: getUpgradeCost(r),
 rerollCost: getRerollPrice(r),
 equipped: equippedIds.includes(r.id)
 };
 });

 const roles = (Array.isArray(inv.roles) ? inv.roles : []).map((r) => {
 const role = guild?.roles?.cache?.get(r.roleId);
 return { roleId: r.roleId, name: role ? role.name : r.roleId };
 });

 const now = Date.now();
 const activeBoosts = (Array.isArray(inv.activeBoosts) ? inv.activeBoosts : [])
 .filter((b) => b && (!b.expiresAt || b.expiresAt > now))
 .map((b) => ({ name: stripEmoji(getBoostNameAr(b.type)), remaining: b.expiresAt ? formatRemainingAr(b.expiresAt) : 'دائم' }));

 const services = Object.entries(inv.services && typeof inv.services === 'object' ? inv.services : {})
 .filter(([, v]) => Number(v) > 0)
 .map(([k, v]) => ({ key: k, count: Math.floor(Number(v)) }));

 const pendingCoupon = (() => {
 const cd = (shop.cooldowns && shop.cooldowns[userId]) ? shop.cooldowns[userId] : {};
 return cd.couponCode && cd.couponExpiresAt > Date.now() ? cd.couponCode : null;
 })();

 const coupons = Object.entries(shop.coupons && typeof shop.coupons === 'object' ? shop.coupons : {}).map(([code, c]) => ({
 code,
 percent: Math.floor(Number(c.percent) || 0),
 used: Math.floor(Number(c.used) || 0),
 maxUses: Math.floor(Number(c.maxUses) || 0),
 expired: !!(c.expiresAt && Number(c.expiresAt) <= Date.now())
 })).filter((c) => !c.expired && c.percent > 0);

 const a = shop.auction || {};
 return {
 balance,
 discount,
 sections,
 runes,
 runeBuyPrices: Object.fromEntries(TIER_LIST.map((t) => [t, getRuneBuyPrice(t)])),
 tierList: TIER_LIST.map((t) => ({ key: t, label: TIERS[t].label })),
 fuseCost: FUSE_COST,
 rerollCap: REROLL_CAP,
 equippedCount: equippedIds.length,
 maxEquipped: MAX_EQUIPPED,
 inventory: {
 activeTitle: inv.activeTitle ? stripEmoji(inv.activeTitle) : 'لا يوجد',
 titles: (Array.isArray(inv.titles) ? inv.titles : []).map((t) => stripEmoji(t.title)),
 roles,
 collectibles: (Array.isArray(inv.collectibles) ? inv.collectibles : []).map((c) => stripEmoji(c.name || c.id)),
 boostCards: (Array.isArray(inv.boosts) ? inv.boosts : []).map((b) => ({ type: b.type, name: stripEmoji(getBoostNameAr(b.type)) })),
 activeBoosts,
 services,
 purchases: getPurchases(guildId, userId).slice(0, 10).map((p) => ({ ...p, name: stripEmoji(p.name) }))
 },
 coupons,
 pendingCoupon,
 auction: {
 active: !!a.active,
 roleId: a.legendaryRoleId,
 highestBid: Math.floor(Number(a.highestBid) || 0),
 highestBidderId: a.highestBidderId || null,
 minBid: Math.floor(Number(a.minBid) || 50),
 endsAt: Math.floor(Number(a.endsAt) || 0)
 }
 };
}

function ok(msg, tab, extra = {}) { return { ok: true, msg, tab, ...extra }; }
function fail(msg, tab, extra = {}) { return { ok: false, msg, tab, ...extra }; }

async function handleAction(client, guildId, userId, form) {
 const action = String(form.get('action') || '');
 const tab = String(form.get('tab') || 'runes');
 const inv = getUserInventory(guildId, userId);
 const allRunes = Array.isArray(inv.runes) ? inv.runes : [];

 if (action === 'rune_equip' || action === 'rune_unequip') {
 const id = String(form.get('runeId') || '');
 if (!allRunes.some((r) => r && r.id === id)) return fail('ما لقيت الرونة 3:', 'runes');
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 const eq = Array.isArray(next.equippedRuneIds) ? [...next.equippedRuneIds] : [];
 if (action === 'rune_equip') {
 if (eq.length >= MAX_EQUIPPED || eq.includes(id)) return cur;
 eq.push(id);
 } else {
 next.equippedRuneIds = eq.filter((x) => x !== id);
 return next;
 }
 next.equippedRuneIds = eq;
 return next;
 });
 const isEquip = action === 'rune_equip';
 return ok(isEquip ? 'تم تجهيز الرونة.' : 'تم فك الرونة.', 'runes', {
 fx: isEquip ? 'equip' : 'unequip', runeId: id, status: isEquip ? 'EQUIPPED' : 'UN-EQUIPPED'
 });
 }

 if (action === 'rune_sell') {
 const id = String(form.get('runeId') || '');
 let sold = null;
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 const list = Array.isArray(next.runes) ? [...next.runes] : [];
 const idx = list.findIndex((r) => r && r.id === id);
 if (idx < 0) return cur;
 sold = list[idx];
 list.splice(idx, 1);
 next.runes = list;
 next.equippedRuneIds = (Array.isArray(next.equippedRuneIds) ? next.equippedRuneIds : []).filter((x) => x !== id);
 return next;
 });
 if (!sold) return fail('ما لقيت الرونة 3:', 'runes');
 const value = getRuneValue(sold);
 if (value > 0) addLunaPoints(guildId, userId, value);
 return ok(`تم بيع الرونة — حصلت على ${fmtNum(value)} نقطة.`, 'runes', {
 fx: 'sell', runeId: id, amount: value
 });
 }

 if (action === 'rune_buy') {
 const tier = String(form.get('tier') || '');
 if (!TIERS[tier]) return fail('طبقة غير صحيحة 3:', 'runes');
 const price = getRuneBuyPrice(tier);
 if (getLunaPoints(guildId, userId) < price) return fail('رصيدك ما يكفي ', 'runes');
 if (!spendLunaPoints(guildId, userId, price).ok) return fail('فشلت العملية، حاول مرة ثانية 3:', 'runes');
 const rune = generateRuneForTier(tier);
 let added = false;
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 next.runes = Array.isArray(next.runes) ? [...next.runes] : [];
 next.runes.push(rune);
 added = true;
 return next;
 });
 if (!added) { addLunaPoints(guildId, userId, price); return fail('فشلت العملية، رجّعنا لك النقاط.', 'runes'); }
 return ok(`اشتريت رونة ${TIERS[tier].label} — ${runeLine(rune)}`, 'runes', {
 fx: 'buy', runeId: rune.id, after: runeLine(rune)
 });
 }

 if (action === 'rune_upgrade') {
 const id = String(form.get('runeId') || '');
 const rune = allRunes.find((r) => r && r.id === id);
 if (!rune) return fail('ما لقيت الرونة 3:', 'runes');
 const cost = getUpgradeCost(rune);
 if (cost == null) return fail('الرونة وصلت الحد الأقصى من النجوم 3:', 'runes');
 if (getLunaPoints(guildId, userId) < cost) return fail('رصيدك ما يكفي للترقية ', 'runes');
 if (!spendLunaPoints(guildId, userId, cost).ok) return fail('فشلت العملية 3:', 'runes');
 const result = upgradeRune(rune);
 if (!result || !result.ok) { addLunaPoints(guildId, userId, cost); return fail('الترقية فشلت، رجّعنا لك النقاط.', 'runes'); }
 let written = false;
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 const list = Array.isArray(next.runes) ? [...next.runes] : [];
 const idx = list.findIndex((r) => r && r.id === id);
 if (idx < 0) return cur;
 list[idx] = result.rune;
 next.runes = list;
 written = true;
 return next;
 });
 if (!written) { addLunaPoints(guildId, userId, cost); return fail('ما لقينا الرونة، رجّعنا لك النقاط.', 'runes'); }
 return ok(`تمت الترقية إلى ${result.newStars}/${result.cap} نجوم — ${runeLine(result.rune)}`, 'runes', {
 fx: 'upgrade', runeId: id, before: runeLine(rune), after: runeLine(result.rune),
 starsBefore: getRuneStars(rune), starsAfter: result.newStars
 });
 }

 if (action === 'rune_fuse') {
 const ids = [...form.getAll('runeIds'), ...String(form.get('runeIds') || '').split(',')]
 .map((x) => String(x).trim()).filter(Boolean);
 if (ids.length !== 3) return fail('لازم تختار 3 رونات بالضبط 3:', 'runes');
 const selected = ids.map((id) => allRunes.find((r) => r && r.id === id)).filter(Boolean);
 if (selected.length !== 3 || new Set(selected.map((r) => r.tier)).size !== 1) return fail('لازم 3 رونات من نفس الطبقة 3:', 'runes');
 if (getLunaPoints(guildId, userId) < FUSE_COST) return fail('رصيدك ما يكفي للدمج ', 'runes');
 const result = fuseRunes(selected);
 if (!result || !result.ok) return fail(result?.reason === 'max_stars' ? 'الرونة وصلت أعلى نجوم — الدمج ما يضيف شيء 3:' : 'الدمج فشل 3:', 'runes');
 if (!spendLunaPoints(guildId, userId, FUSE_COST).ok) return fail('فشلت العملية 3:', 'runes');
 const consumed = new Set(ids);
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 next.runes = (Array.isArray(next.runes) ? next.runes : []).filter((r) => r && !consumed.has(r.id));
 next.runes.push(result.rune);
 next.equippedRuneIds = (Array.isArray(next.equippedRuneIds) ? next.equippedRuneIds : []).filter((x) => !consumed.has(x));
 return next;
 });
 return ok(`تم دمج 3 رونات — الناتج: ${runeLine(result.rune)}`, 'runes', {
 fx: 'fuse', runeId: result.rune.id, after: runeLine(result.rune), consumedIds: ids
 });
 }

 if (action === 'rune_reroll') {
 const id = String(form.get('runeId') || '');
 const rune = allRunes.find((r) => r && r.id === id);
 if (!rune) return fail('ما لقيت الرونة 3:', 'runes');
 if (getRuneStars(rune) >= REROLL_CAP) return fail('الرونة وصلت حد إعادة التدوير 3:', 'runes');
 const cost = getRerollPrice(rune);
 if (getLunaPoints(guildId, userId) < cost) return fail('رصيدك ما يكفي ', 'runes');
 if (!spendLunaPoints(guildId, userId, cost).ok) return fail('فشلت العملية 3:', 'runes');
 const result = rerollRune(rune);
 if (!result || !result.ok) { addLunaPoints(guildId, userId, cost); return fail('إعادة التدوير فشلت، رجّعنا لك النقاط.', 'runes'); }
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 const list = Array.isArray(next.runes) ? [...next.runes] : [];
 const idx = list.findIndex((r) => r && r.id === id);
 if (idx >= 0) list[idx] = result.rune;
 next.runes = list;
 return next;
 });
 return ok(`تم إعادة تدوير الرونة — ${runeLine(result.rune)}`, 'runes', {
 fx: 'reroll', runeId: id, before: runeLine(rune), after: runeLine(result.rune)
 });
 }

 if (action === 'shop_buy' || action === 'shop_gift') {
 const itemId = String(form.get('itemId') || '');
 ensureRotations(guildId);
 const shop = getGuildShop(guildId);
 const item = getStaticShopItems().find((x) => x.id === itemId) || resolveCatalogItem(shop, { id: itemId });
 if (!item) return fail('العنصر ما عاد موجود 3:', 'shop');
 if (!isItemAvailableToday(shop, itemId)) return fail('هالصنف مو متوفر اليوم 3:', 'shop');
 const receiverId = action === 'shop_gift' ? String(form.get('receiverId') || '').trim() : userId;
 if (!/^\d{5,}$/.test(receiverId)) return fail('اكتب User ID صحيح للإهداء 3:', 'shop');
 if (!canUseCooldown(guildId, userId, action === 'shop_gift' ? 'gift' : 'buy')) return fail('⏳ انتظر شوي قبل العملية الثانية.', 'shop');
 const discount = getActiveDiscount(guildId, userId);
 const coupon = getPendingCoupon(guildId, userId, itemId);
 const percent = Math.min(80, discount.percent + (coupon.percent || 0));
 const cost = applyDiscount(item.price, percent);
 if (!spendLunaPoints(guildId, userId, cost).ok) return fail(' Luna Points ما تكفي ', 'shop');
 const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId)).catch(() => null);
 if (!guild) return fail('ما قدرت أصل للسيرفر 3:', 'shop');
 const grantText = await grantItemToUser({ guild, receiverId, item, paidCost: cost, buyerId: userId });
 if (String(grantText || '').startsWith('')) return fail(grantText, 'shop');
 recordPurchase(guildId, userId, { itemId: item.id, name: item.name || item.title, kind: item.kind, cost, at: Date.now() });
 if (coupon.code) {
 updateGuildShop(guildId, (g) => {
 const next = { ...g };
 const coupons = next.coupons && typeof next.coupons === 'object' ? { ...next.coupons } : {};
 const cur = coupons[coupon.code];
 if (cur) coupons[coupon.code] = { ...cur, used: Math.floor(Number(cur.used) || 0) + 1 };
 next.coupons = coupons;
 return next;
 });
 }
 clearPendingCoupon(guildId, userId);
 markFirstBuyDay(guildId, userId);
 return ok(`${grantText}\n مدفوع: ${fmtNum(cost)} نقطة${percent > 0 ? ` (خصم ${percent}%)` : ''}`, 'shop');
 }

 if (action === 'coupon_apply') {
 const code = normalizeCouponCode(form.get('code'));
 const itemId = String(form.get('itemId') || '');
 if (!code) return fail('اكتب كود صحيح 3:', 'shop');
 const shop = getGuildShop(guildId);
 const c = shop.coupons && typeof shop.coupons === 'object' ? shop.coupons[code] : null;
 if (!c) return fail('الكود غير موجود 3:', 'shop');
 if (c.expiresAt && Date.now() >= Number(c.expiresAt)) return fail('الكود انتهت صلاحيته 3:', 'shop');
 const percent = Math.max(0, Math.min(20, Math.floor(Number(c.percent) || 0)));
 if (!percent) return fail('الكود غير صالح 3:', 'shop');
 const maxUses = Math.max(0, Math.floor(Number(c.maxUses) || 0));
 const used = Math.floor(Number(c.used) || 0);
 if (maxUses > 0 && used >= maxUses) return fail('خلصت استخدامات الكود 3:', 'shop');
 updateGuildShop(guildId, (g) => {
 const next = { ...g };
 next.cooldowns = next.cooldowns || {};
 next.cooldowns[userId] = {
 ...(next.cooldowns[userId] || {}),
 couponCode: code,
 couponForItemId: itemId,
 couponExpiresAt: Date.now() + 5 * 60 * 1000
 };
 return next;
 });
 const total = Math.min(80, getActiveDiscount(guildId, userId).percent + percent);
 return ok(` طبّقت الكود ${code} — خصم ${percent}% (الإجمالي ${total}%). كمل الشراء من نفس المنتج.`, 'shop');
 }

 if (action === 'auction_bid') {
 if (!canUseCooldown(guildId, userId, 'bid')) return fail('⏳ انتظر شوي قبل مزايدة ثانية.', 'shop');
 const shop = getGuildShop(guildId);
 const a = shop.auction || {};
 if (!a.active || !a.legendaryRoleId) return fail('المزاد غير نشط حاليًا 3:', 'shop');
 const amount = Math.floor(Number(form.get('amount')) || 0);
 const minBid = Math.floor(Number(a.minBid) || 50);
 if (amount < minBid || amount <= Math.floor(Number(a.highestBid) || 0)) return fail(`المزايدة لازم تكون أعلى من ${fmtNum(Math.max(minBid, Number(a.highestBid) || 0))} 3:`, 'shop');
 if (!spendLunaPoints(guildId, userId, amount).ok) return fail('رصيدك ما يكفي ', 'shop');
 if (a.highestBidderId) addLunaPoints(guildId, String(a.highestBidderId), Math.floor(Number(a.highestBid) || 0));
 updateGuildShop(guildId, (g) => {
 const next = { ...g };
 const prev = next.auction || {};
 const bids = Array.isArray(prev.bids) ? [...prev.bids] : [];
 bids.push({ userId, amount, at: Date.now() });
 next.auction = { ...prev, highestBid: amount, highestBidderId: userId, bids };
 return next;
 });
 return ok(` تم تسجيل مزايدتك: ${fmtNum(amount)} نقطة.`, 'shop');
 }

 if (action === 'inv_title') {
 const title = String(form.get('title') || '');
 if (!(inv.titles || []).some((t) => t && t.title === title)) return fail('ما عندك هاللقب ', 'inventory');
 updateUserInventory(guildId, userId, (cur) => ({ ...cur, activeTitle: title }));
 try {
 const { member, user } = await fetchGuildAndUser(client, guildId, userId);
 const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId)).catch(() => null);
 const bot = guild?.members?.me;
 if (member && bot && bot.permissions?.has?.(require('discord.js').PermissionsBitField.Flags.ManageNicknames) && bot.roles.highest.comparePositionTo(member.roles.highest) > 0) {
 const nick = `${user.username} | ${title}`.replace(/\s+/g, ' ').trim().slice(0, 32);
 if (!/@everyone|@here/i.test(nick)) await member.setNickname(nick, 'Active title (web)');
 }
 } catch { }
 return ok(` تم تفعيل اللقب: ${title}`, 'inventory');
 }

 if (action === 'inv_boost') {
 const type = String(form.get('type') || '');
 const durations = {
 xp_boost_25_1h: 3600000, xp_boost_15_24h: 86400000,
 luna_boost_25_1h: 3600000, levelup_reward_boost_50_1h: 3600000
 };
 const card = (Array.isArray(inv.boosts) ? inv.boosts : []).find((b) => b && b.type === type);
 if (!card) return fail('ما عندك هالبوست ', 'inventory');
 const durationMs = Math.floor(Number(card.durationMs) || durations[type] || 0);
 if (!durationMs) return fail('ما قدرت أحدد مدة البوست 3:', 'inventory');
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 const cards = Array.isArray(next.boosts) ? [...next.boosts] : [];
 const idx = cards.findIndex((b) => b && b.type === type);
 if (idx >= 0) cards.splice(idx, 1);
 next.boosts = cards;
 next.activeBoosts = Array.isArray(next.activeBoosts) ? [...next.activeBoosts] : [];
 next.activeBoosts.push({ type, acquiredAt: Date.now(), expiresAt: Date.now() + durationMs });
 return next;
 });
 return ok(` فعلّت ${getBoostNameAr(type)}.`, 'inventory');
 }

 if (action === 'inv_service') {
 const key = String(form.get('key') || '');
 const services = inv.services && typeof inv.services === 'object' ? inv.services : {};
 const countKey = { rename_once: 'renameOnce', xp_transfer: 'xpTransfer', shield: 'shield', rebalance: 'rebalance', vip_title: 'vipTitle', reroll_daily: 'rerollDaily' }[key] || key;
 const count = Math.floor(Number(services[countKey]) || 0);
 if (count <= 0) return fail('ما عندك هالخدمة ', 'inventory');

 if (key === 'vip_title') {
 const vip = 'VIP ';
 const expiresAt = Date.now() + 86400000;
 updateUserInventory(guildId, userId, (cur) => {
 const next = { ...cur };
 next.titles = Array.isArray(next.titles) ? [...next.titles] : [];
 next.titles.push({ title: vip, acquiredAt: Date.now(), expiresAt });
 next.activeTitle = vip;
 next.services = { ...(next.services || {}), vipTitle: Math.max(0, Math.floor(Number(next.services?.vipTitle) || 0) - 1) };
 return next;
 });
 return ok(' تم تفعيل لقب VIP لمدة 24 ساعة.', 'inventory');
 }

 if (key === 'reroll_daily') {
 updateGuildShop(guildId, (g) => {
 const next = { ...g };
 next.daily = { dayKey: null, items: [] };
 next.featured = { dayKey: null, item: null };
 return next;
 });
 ensureRotations(guildId);
 updateUserInventory(guildId, userId, (cur) => ({
 ...cur,
 services: { ...(cur.services || {}), rerollDaily: Math.max(0, Math.floor(Number(cur.services?.rerollDaily) || 0) - 1) }
 }));
 return ok(' تمت إعادة توليد عروض اليوم.', 'inventory');
 }

 if (key === 'rename_once') {
 const nickname = String(form.get('nickname') || '').trim().slice(0, 32);
 if (!nickname || /@everyone|@here/i.test(nickname)) return fail('اكتب اسم صحيح 3:', 'inventory');
 let applied = false;
 try {
 const { member } = await fetchGuildAndUser(client, guildId, userId);
 const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId)).catch(() => null);
 const bot = guild?.members?.me;
 if (member && bot && bot.permissions?.has?.(require('discord.js').PermissionsBitField.Flags.ManageNicknames) && bot.roles.highest.comparePositionTo(member.roles.highest) > 0) {
 await member.setNickname(nickname, 'Rename card (web)');
 applied = true;
 }
 } catch { }
 if (!applied) return fail('ما قدرت أغير النك نيم بسبب الصلاحيات/الرتب — استخدم البطاقة من Discord.', 'inventory');
 updateUserInventory(guildId, userId, (cur) => ({
 ...cur,
 services: { ...(cur.services || {}), renameOnce: Math.max(0, Math.floor(Number(cur.services?.renameOnce) || 0) - 1) }
 }));
 return ok(` تم تغيير اسمك إلى ${nickname}.`, 'inventory');
 }

 if (key === 'xp_transfer') {
 const targetId = String(form.get('target') || '').trim();
 const percent = Math.max(5, Math.min(50, Math.floor(Number(form.get('percent')) || 20)));
 if (!/^\d{5,}$/.test(targetId)) return fail('اكتب User ID صحيح 3:', 'inventory');
 const stats = getUserStats(guildId, userId);
 const amount = Math.floor(Math.floor(Number(stats.xp) || 0) * percent / 100);
 if (amount <= 0) return fail('ما عندك XP كافي للنقل ', 'inventory');
 updateUserStats(guildId, userId, (s) => ({ ...s, xp: Math.max(0, s.xp - amount) }));
 const target = getUserStats(guildId, targetId);
 updateUserStats(guildId, targetId, (s) => ({ ...s, xp: Math.floor(Number(s.xp) || 0) + amount }));
 updateUserInventory(guildId, userId, (cur) => ({
 ...cur,
 services: { ...(cur.services || {}), xpTransfer: Math.max(0, Math.floor(Number(cur.services?.xpTransfer) || 0) - 1) }
 }));
 return ok(` نقلت ${fmtNum(amount)} XP (${percent}%) إلى <@${targetId}>.`, 'inventory');
 }

 if (key === 'rebalance') {
 if (String(form.get('confirm') || '').trim().toUpperCase() !== 'CONFIRM') return fail('اكتب CONFIRM للتأكيد 3:', 'inventory');
 const stats = getUserStats(guildId, userId);
 const shield = Math.floor(Number(services.shield) || 0) > 0;
 const lossPercent = shield ? 10 : 25;
 const lost = Math.floor(Math.floor(Number(stats.lunaPoints) || 0) * lossPercent / 100);
 updateUserStats(guildId, userId, (s) => ({ ...s, xp: 0, lunaPoints: Math.max(0, s.lunaPoints - lost) }));
 updateUserInventory(guildId, userId, (cur) => {
 const svc = { ...(cur.services || {}) };
 svc.rebalance = Math.max(0, Math.floor(Number(svc.rebalance) || 0) - 1);
 if (shield) svc.shield = Math.max(0, Math.floor(Number(svc.shield) || 0) - 1);
 return { ...cur, services: svc };
 });
 return ok(` تمت إعادة التوازن — خسرت ${fmtNum(lost)} نقطة${shield ? ' (الدرع خفّض الخسارة)' : ''}.`, 'inventory');
 }

 if (key === 'shield') return ok(' درع الحماية يُستخدم تلقائيًا عند إعادة التوازن.', 'inventory');
 return fail('هالخدمة مو مدعومة من الموقع — استخدمها من Discord 3:', 'inventory');
 }

 return fail('أمر غير معروف 3:', tab);
}

module.exports = { buildYouData, handleAction, esc, fmtNum, rar, stripEmoji, clean };
