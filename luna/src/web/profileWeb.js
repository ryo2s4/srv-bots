const http = require('http');
const { getOrCreateProfileWebToken, resolveProfileWebToken } = require('../db');
const { getUserStats, getLunaPoints } = require('../levelsStore');
const { getUserInventory } = require('../shopStore');
const { getGuildConfig } = require('../guildConfig');
const { xpForNextLevel } = require('../xpCurve');
const { getTotalBoostSummary } = require('../boostMeta');
const { getTotalRuneSummary } = require('../runes');
const { buildYouData, handleAction } = require('./youPage');
const { renderYou } = require('./renderYou');
const { page, profileContent } = require('./layout');

function pct(mult) {
    return Math.max(0, Math.round((Number(mult) - 1) * 100));
}

function computeRoleBoostTotals(cfg, memberRoleIds) {
    const roleBoosts = Array.isArray(cfg && cfg.roleBoosts) ? cfg.roleBoosts : [];
    const active = roleBoosts.filter((b) => b && b.roleId && memberRoleIds.includes(String(b.roleId)));
    const multFor = (prefix) => active
        .filter((b) => b.type === prefix || (typeof b.type === 'string' && b.type.startsWith(prefix)))
        .reduce((m, b) => m * (Number(b.multiplier) > 1 ? Number(b.multiplier) : 1), 1);
    return {
        xp: multFor('xp_boost'),
        luna: multFor('luna_boost'),
        levelup: multFor('levelup_reward_boost')
    };
}

function combineTotals(shop, role, rune) {
    const combine = (a, b, c) => (Number(a) || 1) * (Number(b) || 1) * (Number(c) || 1);
    return {
        xp: combine(shop.xp.multiplier, role.xp, rune.xp.multiplier),
        luna: combine(shop.luna.multiplier, role.luna, rune.luna.multiplier),
        levelup: combine(shop.levelup.multiplier, role.levelup, rune.levelup.multiplier)
    };
}

async function buildProfileView(client, guildId, userId) {
    const stats = getUserStats(guildId, userId);
    const inv = getUserInventory(guildId, userId);
    const cfg = getGuildConfig(guildId);

    let guild = client.guilds.cache.get(String(guildId));
    if (!guild) guild = await client.guilds.fetch(String(guildId)).catch(() => null);

    let member = guild ? guild.members.cache.get(String(userId)) : null;
    if (!member && guild) member = await guild.members.fetch(String(userId)).catch(() => null);

    let user = member?.user || client.users.cache.get(String(userId)) || null;
    if (!user) user = await client.users.fetch(String(userId)).catch(() => null);

    const memberRoles = member ? [...member.roles.cache.keys()].map(String) : [];
    const activeBoosts = Array.isArray(inv.activeBoosts) ? inv.activeBoosts : [];
    const allRunes = Array.isArray(inv.runes) ? inv.runes : [];
    const equippedRuneIds = Array.isArray(inv.equippedRuneIds) ? inv.equippedRuneIds : [];
    const equippedRunes = allRunes.filter((r) => r && equippedRuneIds.includes(r.id));

    const shopTotals = getTotalBoostSummary(activeBoosts);
    const roleTotals = computeRoleBoostTotals(cfg, memberRoles);
    const runeTotals = getTotalRuneSummary(equippedRunes);
    const combined = combineTotals(shopTotals, roleTotals, runeTotals);

    return {
        guildName: guild?.name || 'Server',
        username: user?.globalName || user?.username || 'Unknown User',
        handle: user?.username ? `@${user.username}` : '',
        avatar: user?.displayAvatarURL?.({ size: 256, extension: 'png' }) || '',
        level: Math.max(0, Math.floor(Number(stats.level) || 0)),
        xp: Math.max(0, Math.floor(Number(stats.xp) || 0)),
        nextXp: Math.max(1, Math.floor(Number(xpForNextLevel(Math.max(0, Math.floor(Number(stats.level) || 0)))) || 1)),
        luna: Math.max(0, Math.floor(Number(stats.lunaPoints) || 0)),
        boosts: { xp: pct(combined.xp), luna: pct(combined.luna), levelup: pct(combined.levelup) }
    };
}

function notFoundHtml() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Profile not found</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080c18;color:#f2f5ff;font-family:system-ui,sans-serif}.box{padding:28px 32px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:#121a2d;text-align:center}p{color:#9aa8c7}</style></head>
<body><div class="box"><h1>404</h1><p>Profile link not found.</p></div></body></html>`;
}

function getProfileWebConfig() {
    const port = Math.max(1, Math.floor(Number(process.env.PROFILE_WEB_PORT || 3210) || 3210));
    const baseUrlRaw = String(process.env.PROFILE_WEB_BASE_URL || '').trim().replace(/\/+$/, '');
    return { port, baseUrl: baseUrlRaw || `http://localhost:${port}` };
}

function getProfileWebUrl(guildId, userId) {
    const token = getOrCreateProfileWebToken(guildId, userId);
    return `${getProfileWebConfig().baseUrl}/p/${encodeURIComponent(token)}`;
}

function startProfileWeb(client) {
    const { port, baseUrl } = getProfileWebConfig();
    if (['0', 'false', 'off'].includes(String(process.env.PROFILE_WEB_ENABLED || 'true').trim().toLowerCase())) {
        console.log('[profile-web] disabled by PROFILE_WEB_ENABLED');
        return null;
    }

    const readBody = (req) => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) reject(new Error('body too large'));
        });
        req.on('end', () => resolve(new URLSearchParams(body)));
        req.on('error', reject);
    });

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const actionMatch = url.pathname.match(/^\/p\/([a-f0-9]{32,128})\/action\/?$/i);
            const viewMatch = url.pathname.match(/^\/p\/([a-f0-9]{32,128})\/?$/i);
            const matched = actionMatch || viewMatch;

            if (!matched || !['GET', 'POST'].includes(req.method)) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(notFoundHtml());
                return;
            }

            const token = matched[1];
            const resolved = resolveProfileWebToken(token);
            if (!resolved) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(notFoundHtml());
                return;
            }

            if (actionMatch) {
                if (req.method !== 'POST') {
                    res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
                    res.end();
                    return;
                }
                const form = await readBody(req);
                const balanceBefore = getLunaPoints(resolved.guildId, resolved.userId);
                const result = await handleAction(client, resolved.guildId, resolved.userId, form);
                const balanceAfter = getLunaPoints(resolved.guildId, resolved.userId);
                const tab = ['runes', 'shop', 'inventory'].includes(result.tab) ? result.tab : 'runes';
                const wantsJson = String(req.headers.accept || '').includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';

                if (wantsJson) {
                    const payload = { ...result, tab, balanceBefore, balanceAfter };
                    if (tab === 'runes' && result.ok) {
                        payload.html = renderYou(await buildYouData(client, resolved.guildId, resolved.userId), 'runes', token);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
                    res.end(JSON.stringify(payload));
                    return;
                }

                const location = `/p/${token}?tab=${tab}&flash=${encodeURIComponent(result.msg)}&ok=${result.ok ? '1' : '0'}`;
                res.writeHead(303, { Location: location });
                res.end();
                return;
            }

            if (req.method !== 'GET') {
                res.writeHead(405, { Allow: 'GET', 'Cache-Control': 'no-store' });
                res.end();
                return;
            }

            const rawTab = String(url.searchParams.get('tab') || '');
            const tab = ['runes', 'shop', 'inventory'].includes(rawTab) || rawTab === 'you'
                ? (rawTab === 'you' ? 'runes' : rawTab) : 'profile';
            const flashParam = url.searchParams.get('flash');
            const flash = flashParam ? { ok: url.searchParams.get('ok') !== '0', msg: flashParam } : null;

            const view = await buildProfileView(client, resolved.guildId, resolved.userId);
            let content;
            if (tab === 'profile') {
                content = profileContent(view, token);
            } else {
                const data = await buildYouData(client, resolved.guildId, resolved.userId);
                content = renderYou(data, tab, token);
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer'
            });
            res.end(page({ token, view, tab, flash, content }));
        } catch (err) {
            console.error('[profile-web] request failed:', err);
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('<!doctype html><html><body style="background:#080c18;color:#fff;font-family:system-ui;padding:24px"><h1>500</h1><p>Something went wrong.</p></body></html>');
        }
    });

    server.on('error', (err) => console.error('[profile-web] server error:', err));
    server.listen(port, '0.0.0.0', () => console.log(`[profile-web] listening on :${port} (base ${baseUrl})`));
    return server;
}

module.exports = { startProfileWeb, getProfileWebUrl, getProfileWebConfig, buildProfileView };
