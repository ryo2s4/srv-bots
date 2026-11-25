const http = require('http');
const { getOrCreateProfileWebToken, resolveProfileWebToken } = require('../db');
const { getUserStats } = require('../levelsStore');
const { getUserInventory } = require('../shopStore');
const { getGuildConfig } = require('../guildConfig');
const { xpForNextLevel } = require('../xpCurve');
const { getTotalBoostSummary } = require('../boostMeta');
const { getTotalRuneSummary } = require('../runes');

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtNum(n) {
    const x = Math.floor(Number(n) || 0);
    return x.toLocaleString('en-US');
}

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

    const lvl = Math.max(0, Math.floor(Number(stats.level) || 0));
    const xp = Math.max(0, Math.floor(Number(stats.xp) || 0));
    const nextXp = Math.max(1, Math.floor(Number(xpForNextLevel(lvl)) || 1));
    const luna = Math.max(0, Math.floor(Number(stats.lunaPoints) || 0));

    return {
        guildName: guild?.name || 'Server',
        username: user?.globalName || user?.username || 'Unknown User',
        handle: user?.username ? `@${user.username}` : '',
        avatar: user?.displayAvatarURL?.({ size: 256, extension: 'png' }) || '',
        level: lvl,
        xp,
        nextXp,
        luna,
        boosts: {
            xp: pct(combined.xp),
            luna: pct(combined.luna),
            levelup: pct(combined.levelup)
        }
    };
}

function renderHtml(view) {
    const xpPct = Math.max(0, Math.min(100, (view.xp / view.nextXp) * 100));
    const boostRow = (label, icon, value) => `
      <div class="boost">
        <div class="boost-label">${icon} <span>${esc(label)}</span></div>
        <div class="boost-value">+${fmtNum(value)}%</div>
      </div>`;

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${esc(view.username)} — Luna Profile</title>
  <style>
    :root { --bg:#0b1020; --card:#151b2f; --card2:#1b2340; --text:#eef2ff; --muted:#a9b4d0; --accent:#c4a7ff; --accent2:#7dd3fc; --line:rgba(255,255,255,.08); }
    * { box-sizing:border-box; }
    body { margin:0; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; background:radial-gradient(1200px 600px at 50% -10%, rgba(196,167,255,.22), transparent 60%), var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card { width:min(720px,100%); background:linear-gradient(180deg, rgba(255,255,255,.03), transparent 30%), var(--card); border:1px solid var(--line); border-radius:24px; padding:28px; box-shadow:0 20px 60px rgba(0,0,0,.35); }
    .top { display:flex; gap:18px; align-items:center; }
    .avatar { width:88px; height:88px; border-radius:22px; object-fit:cover; background:#222; border:1px solid var(--line); }
    .name { font-size:28px; font-weight:800; line-height:1.15; }
    .handle { color:var(--muted); margin-top:4px; font-size:14px; }
    .guild { color:var(--accent2); font-size:13px; margin-top:8px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-top:22px; }
    .stat { background:var(--card2); border:1px solid var(--line); border-radius:18px; padding:16px; }
    .label { color:var(--muted); font-size:13px; margin-bottom:8px; }
    .value { font-size:28px; font-weight:800; }
    .xp { margin-top:14px; background:var(--card2); border:1px solid var(--line); border-radius:18px; padding:16px; }
    .bar { height:12px; background:rgba(255,255,255,.08); border-radius:999px; overflow:hidden; margin-top:10px; }
    .fill { height:100%; width:${xpPct.toFixed(2)}%; background:linear-gradient(90deg,var(--accent),var(--accent2)); }
    .xp-meta { display:flex; justify-content:space-between; gap:12px; color:var(--muted); font-size:13px; margin-top:8px; }
    .section-title { margin-top:22px; margin-bottom:10px; font-size:16px; font-weight:700; color:var(--accent); }
    .boosts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
    .boost { background:var(--card2); border:1px solid var(--line); border-radius:16px; padding:14px; }
    .boost-label { color:var(--muted); font-size:13px; display:flex; gap:8px; align-items:center; }
    .boost-value { font-size:24px; font-weight:800; margin-top:8px; }
    .foot { margin-top:22px; color:var(--muted); font-size:12px; text-align:center; }
    @media (max-width:640px){ .grid,.boosts{grid-template-columns:1fr;} .name{font-size:24px;} .avatar{width:72px;height:72px;border-radius:18px;} }
  </style>
</head>
<body>
  <main class="card">
    <div class="top">
      ${view.avatar ? `<img class="avatar" src="${esc(view.avatar)}" alt="avatar" />` : `<div class="avatar"></div>`}
      <div>
        <div class="name">${esc(view.username)}</div>
        ${view.handle ? `<div class="handle">${esc(view.handle)}</div>` : ''}
        <div class="guild">🌙 ${esc(view.guildName)}</div>
      </div>
    </div>

    <div class="grid">
      <div class="stat"><div class="label">المستوى</div><div class="value">${fmtNum(view.level)}</div></div>
      <div class="stat"><div class="label">نقاط لونا</div><div class="value">${fmtNum(view.luna)}</div></div>
    </div>

    <div class="xp">
      <div class="label">تقدم الخبرة</div>
      <div class="bar"><div class="fill"></div></div>
      <div class="xp-meta"><span>${fmtNum(view.xp)} / ${fmtNum(view.nextXp)} XP</span><span>${xpPct.toFixed(1)}%</span></div>
    </div>

    <div class="section-title">إجمالي البوستات (رتب + رونات + بوستات المتجر)</div>
    <div class="boosts">
      ${boostRow('XP', '⚡', view.boosts.xp)}
      ${boostRow('Luna', '💰', view.boosts.luna)}
      ${boostRow('Level-Up', '🏅', view.boosts.levelup)}
    </div>

    <div class="foot">Luna Profile • هذا الرابط خاص — لا تشاركه إذا ما تبي أحد يشوفه</div>
  </main>
</body>
</html>`;
}

function notFoundHtml() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow"/><title>Profile not found</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#eef2ff;font-family:system-ui,sans-serif}.box{padding:28px 32px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:#151b2f;text-align:center}p{color:#a9b4d0}</style></head>
<body><div class="box"><h1>404</h1><p>Profile link not found.</p></div></body></html>`;
}

function getProfileWebConfig() {
    const port = Math.max(1, Math.floor(Number(process.env.PROFILE_WEB_PORT || 3210) || 3210));
    const baseUrlRaw = String(process.env.PROFILE_WEB_BASE_URL || '').trim().replace(/\/+$/, '');
    const baseUrl = baseUrlRaw || `http://localhost:${port}`;
    return { port, baseUrl };
}

function getProfileWebUrl(guildId, userId) {
    const token = getOrCreateProfileWebToken(guildId, userId);
    const { baseUrl } = getProfileWebConfig();
    return `${baseUrl}/p/${encodeURIComponent(token)}`;
}

function startProfileWeb(client) {
    const { port, baseUrl } = getProfileWebConfig();
    const enabledRaw = String(process.env.PROFILE_WEB_ENABLED || 'true').trim().toLowerCase();
    if (enabledRaw === '0' || enabledRaw === 'false' || enabledRaw === 'off') {
        console.log('[profile-web] disabled by PROFILE_WEB_ENABLED');
        return null;
    }

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const m = url.pathname.match(/^\/p\/([a-f0-9]{32,128})$/i);
            if (req.method !== 'GET' || !m) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(notFoundHtml());
                return;
            }

            const token = m[1];
            const resolved = resolveProfileWebToken(token);
            if (!resolved) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(notFoundHtml());
                return;
            }

            const view = await buildProfileView(client, resolved.guildId, resolved.userId);
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer'
            });
            res.end(renderHtml(view));
        } catch (err) {
            console.error('[profile-web] request failed:', err);
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('<!doctype html><html><body style="background:#0b1020;color:#fff;font-family:system-ui;padding:24px"><h1>500</h1><p>Something went wrong.</p></body></html>');
        }
    });

    server.on('error', (err) => {
        console.error('[profile-web] server error:', err);
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`[profile-web] listening on :${port} (base ${baseUrl})`);
    });

    return server;
}

module.exports = {
    startProfileWeb,
    getProfileWebUrl,
    getProfileWebConfig,
    buildProfileView
};
