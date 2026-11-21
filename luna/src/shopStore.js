const fs = require('fs');
const path = require('path');
const { getDb, paths: dbPaths } = require('./db');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'shopStore.json');

let migrated = false;

function migrateFromJsonIfNeeded() {
    if (migrated) return;

    const db = getDb();

    let hasAny = false;
    try {
        const row = db.prepare('SELECT 1 FROM shop_store LIMIT 1').get();
        hasAny = !!row;
    } catch {
        hasAny = false;
    }
    if (hasAny) {
        migrated = true;
        return;
    }

    if (!fs.existsSync(dataFile)) {
        migrated = true;
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    } catch (err) {
        console.error('[shopStore] Failed to read/parse shopStore.json for migration, will retry later:', err);
        return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.guilds || typeof parsed.guilds !== 'object') {
        migrated = true;
        return;
    }

    const now = Date.now();
    const insert = db.prepare('INSERT OR REPLACE INTO shop_store (guild_id, value_json, updated_at) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
        for (const [guildId, g] of Object.entries(parsed.guilds)) {
            insert.run(String(guildId), JSON.stringify(g || {}), now);
        }
    });
    try {
        tx();
        migrated = true;
    } catch (err) {
        // Leave migrated = false so a later call retries; the transaction rolled back.
        console.error('[shopStore] JSON→SQLite migration failed, will retry later:', err);
    }
}

function readGuild(guildId) {
    migrateFromJsonIfNeeded();
    const db = getDb();
    const id = String(guildId);
    const row = db.prepare('SELECT value_json FROM shop_store WHERE guild_id = ?').get(id);
    if (!row) return {};
    try {
        const parsed = JSON.parse(row.value_json);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch {
        return {};
    }
}

function writeGuild(guildId, value) {
    const db = getDb();
    const id = String(guildId);
    db.prepare('INSERT OR REPLACE INTO shop_store (guild_id, value_json, updated_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(value || {}), Date.now());
}

function ensureGuild(store, guildId) {
    if (!store.guilds[guildId] || typeof store.guilds[guildId] !== 'object') {
        store.guilds[guildId] = {};
    }
    const g = store.guilds[guildId];

    // Admin-configurable catalog
    if (!Array.isArray(g.roleItems)) g.roleItems = []; // [{id,name,roleId,price,rarity}]
    if (!Array.isArray(g.titleItems)) g.titleItems = []; // [{id,name,title,price,rarity}]

    // Dynamic rotations
    if (!g.daily || typeof g.daily !== 'object') g.daily = { dayKey: null, items: [] };
    if (!g.weekly || typeof g.weekly !== 'object') g.weekly = { weekKey: null, items: [] };
    if (!g.limited || typeof g.limited !== 'object') g.limited = { dayKey: null, item: null };

    if (!g.featured || typeof g.featured !== 'object') g.featured = { dayKey: null, item: null };
    if (!g.dailyDiscount || typeof g.dailyDiscount !== 'object') g.dailyDiscount = { dayKey: null, percent: 0 };

    // Legendary auction
    if (!g.auction || typeof g.auction !== 'object') {
        g.auction = {
            legendaryRoleId: null,
            active: false,
            endsAt: 0,
            highestBid: 0,
            highestBidderId: null,
            bids: [] // [{userId, amount, at}]
        };
    }

    // User state
    if (!g.inventories || typeof g.inventories !== 'object') g.inventories = {}; // userId -> inventory

    // سجل المشتريات (آخر 20 لكل عضو)
    if (!g.purchases || typeof g.purchases !== 'object') g.purchases = {}; // userId -> [{itemId,name,kind,cost,at}]

    // حالة إعلانات العروض اليومية
    if (!g.announceState || typeof g.announceState !== 'object') g.announceState = { dayKey: null, weekKey: null };

    // Anti-abuse
    if (!g.cooldowns || typeof g.cooldowns !== 'object') g.cooldowns = {}; // userId -> {giftAt, buyAt, boostAt}

    // Discount coupons
    if (!g.coupons || typeof g.coupons !== 'object') g.coupons = {}; // code -> {percent, maxUses, used, createdAt}

    return g;
}

function getGuildShop(guildId) {
    const id = String(guildId);
    const raw = readGuild(id);
    const wrapper = { guilds: { [id]: raw } };
    const g = ensureGuild(wrapper, id);
    writeGuild(id, g);
    return g;
}

function updateGuildShop(guildId, updater) {
    const id = String(guildId);
    const currentRaw = readGuild(id);
    const wrapper = { guilds: { [id]: currentRaw } };
    const g = ensureGuild(wrapper, id);
    const next = updater({ ...g }) || g;
    writeGuild(id, next);
    return next;
}

function getUserInventory(guildId, userId) {
    const id = String(guildId);
    const uid = String(userId);
    const currentRaw = readGuild(id);
    const wrapper = { guilds: { [id]: currentRaw } };
    const g = ensureGuild(wrapper, id);
    if (!g.inventories[uid]) {
        g.inventories[uid] = {
            titles: [], // [{title, acquiredAt}]
            activeTitle: null,
            boosts: [], // owned boost cards: [{type, durationMs, acquiredAt}]
            activeBoosts: [], // active boosts: [{type, expiresAt, acquiredAt}]
            roles: [], // [{roleId, acquiredAt}]
            collectibles: [], // [{id,name,emoji,acquiredAt}]
            services: {
                renameOnce: 0,
                xpTransfer: 0,
                shield: 0,
                rebalance: 0,
                vipTitle: 0,
                rerollDaily: 0
            },
            pendingRename: null,
            runes: [], // [{id, tier, type, multiplier, acquiredAt}]
            equippedRuneIds: [], // max 3
            claimedLevelRewards: [], // level milestones already claimed
            runePity: 0 // rune-pull pity counter
        };
    }

    const inv = g.inventories[uid];
    if (!Array.isArray(inv.titles)) inv.titles = [];
    if (!Array.isArray(inv.boosts)) inv.boosts = [];
    if (!Array.isArray(inv.activeBoosts)) inv.activeBoosts = [];
    if (!Array.isArray(inv.roles)) inv.roles = [];
    if (!Array.isArray(inv.collectibles)) inv.collectibles = [];
    if (!Array.isArray(inv.runes)) inv.runes = [];
    if (!Array.isArray(inv.equippedRuneIds)) inv.equippedRuneIds = [];
    if (!Array.isArray(inv.claimedLevelRewards)) inv.claimedLevelRewards = [];
    const runePity = Number(inv.runePity);
    inv.runePity = Number.isFinite(runePity) ? Math.max(0, Math.floor(runePity)) : 0;
    if (typeof inv.activeTitle !== 'string' && inv.activeTitle !== null) inv.activeTitle = null;
    if (!inv.services || typeof inv.services !== 'object') inv.services = { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0, rerollDaily: 0 };
    if (typeof inv.services.renameOnce !== 'number' || Number.isNaN(inv.services.renameOnce)) inv.services.renameOnce = 0;
    if (typeof inv.services.xpTransfer !== 'number' || Number.isNaN(inv.services.xpTransfer)) inv.services.xpTransfer = 0;
    if (typeof inv.services.shield !== 'number' || Number.isNaN(inv.services.shield)) inv.services.shield = 0;
    if (typeof inv.services.rebalance !== 'number' || Number.isNaN(inv.services.rebalance)) inv.services.rebalance = 0;
    if (typeof inv.services.vipTitle !== 'number' || Number.isNaN(inv.services.vipTitle)) inv.services.vipTitle = 0;
    if (typeof inv.services.rerollDaily !== 'number' || Number.isNaN(inv.services.rerollDaily)) inv.services.rerollDaily = 0;
    if (inv.pendingRename && typeof inv.pendingRename !== 'object') inv.pendingRename = null;
    writeGuild(id, g);

    return inv;
}

function updateUserInventory(guildId, userId, updater) {
    const id = String(guildId);
    const uid = String(userId);
    const currentRaw = readGuild(id);
    const wrapper = { guilds: { [id]: currentRaw } };
    const g = ensureGuild(wrapper, id);
    const current = g.inventories[uid] || {
        titles: [],
        activeTitle: null,
        boosts: [],
        activeBoosts: [],
        roles: [],
        collectibles: [],
        services: { renameOnce: 0, xpTransfer: 0, shield: 0, rebalance: 0, vipTitle: 0, rerollDaily: 0 },
        pendingRename: null,
        runes: [],
        equippedRuneIds: [],
        claimedLevelRewards: [],
        runePity: 0
    };
    const next = updater({ ...current }) || current;
    g.inventories[uid] = next;
    writeGuild(id, g);
    return next;
}

function getAllGuildIds() {
    migrateFromJsonIfNeeded();
    const db = getDb();
    const rows = db.prepare('SELECT guild_id FROM shop_store').all();
    return rows.map((r) => String(r.guild_id));
}

function getAllGuildShops() {
    migrateFromJsonIfNeeded();
    const db = getDb();
    const rows = db.prepare('SELECT guild_id, value_json FROM shop_store').all();
    return rows.map((r) => {
        const guildId = String(r.guild_id);
        let parsed;
        try {
            parsed = JSON.parse(r.value_json);
        } catch {
            parsed = {};
        }
        const wrapper = { guilds: { [guildId]: (parsed && typeof parsed === 'object') ? parsed : {} } };
        const shop = ensureGuild(wrapper, guildId);
        return { guildId, shop };
    });
}

// سجل المشتريات — يُضاف لكل شراء/إهداء (آخر 20)
function recordPurchase(guildId, userId, entry) {
    try {
        updateGuildShop(guildId, (g) => {
            const next = { ...g };
            next.purchases = next.purchases && typeof next.purchases === 'object' ? { ...next.purchases } : {};
            const key = String(userId);
            const list = Array.isArray(next.purchases[key]) ? [...next.purchases[key]] : [];
            list.unshift({
                itemId: String((entry && entry.itemId) || ''),
                name: String((entry && entry.name) || ''),
                kind: String((entry && entry.kind) || ''),
                cost: Math.max(0, Math.floor(Number(entry && entry.cost) || 0)),
                at: Math.floor(Number(entry && entry.at) || Date.now()),
                buyerId: entry && entry.buyerId ? String(entry.buyerId) : null,
                receiverId: entry && entry.receiverId ? String(entry.receiverId) : null
            });
            next.purchases[key] = list.slice(0, 20);
            return next;
        });
    } catch {
    }
}

function getPurchases(guildId, userId) {
    try {
        const g = getGuildShop(guildId);
        const list = g && g.purchases ? g.purchases[String(userId)] : null;
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

module.exports = {
    getGuildShop,
    updateGuildShop,
    getUserInventory,
    updateUserInventory,
    recordPurchase,
    getPurchases,
    getAllGuildIds,
    getAllGuildShops,
    _paths: { dataFile, dbFile: dbPaths.dbFile }
};
