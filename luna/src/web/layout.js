const { clean, fmtNum } = require('./youPage');
const { icon } = require('./icons');

const NAV = [
    { key: 'profile', icon: 'user', label: 'الملف الشخصي' },
    { key: 'runes', icon: 'gem', label: 'الرونات' },
    { key: 'shop', icon: 'bag', label: 'المتجر' },
    { key: 'inventory', icon: 'box', label: 'ممتلكاتي' }
];

function flashBox(flash) {
    if (!flash) return '';
    const ok = flash.ok !== false;
    return `<div class="flash ${ok ? 'ok' : 'err'}">${icon(ok ? 'check' : 'warn', 16)}<div>${clean(flash.msg).replace(/\n/g, '<br>')}</div></div>`;
}

function smallStat(ico, label, value, sub = '') {
    return `<div class="stat"><span class="stat-ico">${icon(ico, 20)}</span><span class="stat-text"><span class="stat-label">${label}</span><span class="stat-value">${value}${sub ? ` <small>${sub}</small>` : ''}</span></span></div>`;
}

function profileContent(view, token) {
    const xpPct = Math.max(0, Math.min(100, (view.xp / view.nextXp) * 100));
    const quick = (key, ico, label) => `<a class="quick" href="/p/${token}?tab=${key}">${icon(ico, 18)}<span>${label}</span>${icon('arrow', 16)}</a>`;
    const boost = (ico, label, value) => `<div class="boost"><span class="boost-ico">${icon(ico, 20)}</span><span class="boost-label">${label}</span><strong>+${fmtNum(value)}%</strong></div>`;

    return `
      <section class="identity panel">
        ${view.avatar ? `<img class="avatar" src="${clean(view.avatar)}" alt="">` : `<span class="avatar fallback">${icon('user', 30)}</span>`}
        <div class="identity-main">
          <span class="eyebrow">LUNA / PROFILE</span>
          <h1>${clean(view.username)}</h1>
          <p>${clean(view.handle)} <span class="sep">·</span> ${clean(view.guildName)}</p>
        </div>
        <div class="level"><span>LEVEL</span><strong>${fmtNum(view.level)}</strong></div>
      </section>

      <div class="stats">
        ${smallStat('coin', 'نقاط لونا', fmtNum(view.luna))}
        ${smallStat('medal', 'الخبرة', fmtNum(view.xp), `/ ${fmtNum(view.nextXp)}`)}
      </div>

      <section class="panel">
        <div class="panel-head"><h2>تقدم المستوى</h2><span>${xpPct.toFixed(1)}%</span></div>
        <div class="progress"><div class="fill" style="width:${xpPct.toFixed(2)}%"></div></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>إجمالي البوستات</h2><span>رتب + رونات + بوستات المتجر</span></div>
        <div class="boosts">
          ${boost('bolt', 'XP', view.boosts.xp)}
          ${boost('coin', 'Luna', view.boosts.luna)}
          ${boost('trophy', 'Level-Up', view.boosts.levelup)}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>إدارة الحساب</h2></div>
        <div class="quick-grid">
          ${quick('runes', 'gem', 'الرونات')}
          ${quick('shop', 'bag', 'المتجر')}
          ${quick('inventory', 'box', 'ممتلكاتي')}
        </div>
      </section>`;
}

function page({ token, view, tab, flash, content }) {
    const active = tab || 'profile';
    const nav = NAV.map((n) => `<a class="nav-item ${active === n.key ? 'active' : ''}" href="/p/${token}?tab=${n.key}">${icon(n.icon, 18)}<span>${n.label}</span></a>`).join('');
    const title = NAV.find((n) => n.key === active)?.label || 'Luna';

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#f1e8d8">
<title>${clean(title)} — Luna</title>
<style>
:root{
  --bg:#f1e8d8; --panel:#faf4e8; --panel2:#efe3cf; --line:#d9c7ab;
  --text:#3b2f24; --muted:#8b7760; --accent:#8a5a38; --accent-dim:#d8bfa0;
  --gold:#9a6b2f; --danger:#a94f42; --radius:8px;
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{
  background:var(--bg);color:var(--text);display:flex;min-height:100vh;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;
  font-size:14px;line-height:1.6;
}
a{color:inherit;text-decoration:none}
.ico{display:inline-block;vertical-align:middle;flex:none}
.sidebar{
  width:216px;flex:0 0 216px;background:#e7dbc6;border-inline-start:1px solid var(--line);
  padding:24px 14px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh;
}
.brand{display:flex;align-items:center;gap:10px;padding:0 10px 22px}
.brand-mark{width:34px;height:34px;border:1px solid var(--accent-dim);border-radius:8px;display:grid;place-items:center;color:var(--accent)}
.brand-name{font-weight:800;letter-spacing:3px;font-size:14px}
.brand-sub{font-size:10px;color:var(--muted);letter-spacing:1px}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:var(--muted);font-weight:600;transition:background .15s,color .15s}
.nav-item:hover{background:#eaddc6;color:var(--text)}
.nav-item.active{background:#dcc2a0;color:#5d3a22;border-inline-start:2px solid var(--accent)}
.side-foot{margin-top:auto;padding:12px 10px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.8}
.main{flex:1;min-width:0;padding:26px clamp(16px,3.5vw,42px) 56px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-bottom:20px;border-bottom:1px solid var(--line);margin-bottom:22px}
.top-user{display:flex;align-items:center;gap:12px;min-width:0}
.top-avatar{width:38px;height:38px;border-radius:8px;object-fit:cover;background:var(--panel2);border:1px solid var(--line)}
.top-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top-sub{font-size:11px;color:var(--muted)}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel);border-radius:7px;padding:6px 10px;font-size:12px;color:var(--muted)}
.chip b{color:var(--text);font-variant-numeric:tabular-nums}
.chip.gold b{color:var(--gold)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:14px}
.panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.panel-head h2{margin:0;font-size:14px;font-weight:700;letter-spacing:.2px}
.panel-head h2::before{content:"";display:inline-block;width:3px;height:13px;background:var(--accent);margin-inline-end:9px;vertical-align:-2px;border-radius:2px}
.panel-head span{font-size:11px;color:var(--muted)}
.identity{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.avatar{width:64px;height:64px;border-radius:10px;object-fit:cover;border:1px solid var(--line);background:var(--panel2)}
.avatar.fallback{display:grid;place-items:center;color:var(--muted)}
.identity-main{min-width:0;flex:1}
.eyebrow{font-size:10px;letter-spacing:2px;color:var(--accent)}
.identity h1{margin:2px 0;font-size:22px;line-height:1.3}
.identity p{margin:0;color:var(--muted);font-size:12px}
.sep{color:#a89a84;margin:0 4px}
.level{text-align:center;border-inline-start:1px solid var(--line);padding-inline-start:18px;min-width:76px}
.level span{display:block;font-size:10px;letter-spacing:1.5px;color:var(--muted)}
.level strong{display:block;font-size:26px;color:var(--gold);font-variant-numeric:tabular-nums}
.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}
.stat{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.stat-ico{width:36px;height:36px;display:grid;place-items:center;border-radius:8px;background:var(--panel2);color:var(--accent)}
.stat-text{display:flex;flex-direction:column}
.stat-label{font-size:11px;color:var(--muted)}
.stat-value{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.stat-value small{font-size:12px;color:var(--muted);font-weight:400}
.progress{height:8px;background:#ddcfb8;border-radius:999px;overflow:hidden}
.fill{height:100%;background:var(--accent);border-radius:999px}
.boosts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.boost{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px}
.boost-ico{grid-row:1/3;color:var(--accent)}
.boost-label{font-size:11px;color:var(--muted)}
.boost strong{font-size:18px;font-variant-numeric:tabular-nums}
.quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.quick{display:flex;align-items:center;gap:9px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;color:var(--text);transition:border-color .15s}
.quick:hover{border-color:var(--accent-dim)}
.quick span{flex:1}
.quick .ico:last-child{color:var(--muted)}
/* You pages */
.panel h3{margin:0 0 12px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px}
.panel h3 .ico{color:var(--accent)}
.panel h3 small{font-weight:400;color:var(--muted);font-size:11px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0;padding-top:0}
.row-main{flex:1 1 240px;min-width:0}
.row-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.row-title{font-weight:700;font-size:13px}
.muted{color:var(--muted);font-size:11px;line-height:1.7}
.price{font-size:12px;color:var(--gold);font-variant-numeric:tabular-nums;margin-top:5px}
.price s{color:var(--muted);margin-inline-end:6px}
.tag{display:inline-block;border:1px solid var(--accent-dim);color:var(--accent);border-radius:5px;padding:1px 7px;font-size:10px;margin-inline-start:6px}
.tag.gold{border-color:#c9a872;color:var(--gold)}
.inline{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.list{margin:0;padding-inline-start:18px;color:var(--muted);font-size:12px;line-height:1.9}
.list b{color:var(--text)}
input,select{background:#f7eedf;color:var(--text);border:1px solid var(--line);border-radius:7px;padding:7px 9px;font:inherit;font-size:12px;outline:none}
input:focus,select:focus{border-color:var(--accent-dim)}
.btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--accent-dim);background:#efe0c8;color:var(--text);border-radius:7px;padding:7px 10px;font:inherit;font-size:11px;font-weight:700;white-space:nowrap}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);color:#fff8ec;border-color:var(--accent)}
.btn.ghost{background:transparent;border-color:var(--line);color:var(--muted)}
.btn.danger{background:transparent;border-color:#d3a9a1;color:var(--danger)}
.flash{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);padding:11px 14px;margin-bottom:16px;font-size:12px}
.flash.ok{color:var(--accent);border-color:var(--accent-dim)}
.flash.err{color:var(--danger);border-color:#d3a9a1}
.foot{text-align:center;color:var(--muted);font-size:10px;margin-top:28px;letter-spacing:.3px}
@media(max-width:860px){
  body{display:block}
  .sidebar{position:static;width:100%;height:auto;flex-direction:row;align-items:center;overflow-x:auto;padding:12px;border-inline-start:0;border-bottom:1px solid var(--line)}
  .brand{padding:0 14px 0 0}.brand-sub,.side-foot{display:none}
  .nav-item{white-space:nowrap}
  .main{padding:20px 14px 40px}
  .boosts,.quick-grid,.stats,.grid2{grid-template-columns:1fr}
}
.identity h1,.panel-head h2,.level strong,.stat-value,.boost strong{font-family:Georgia,"Times New Roman",serif;letter-spacing:.2px}
.identity h1{font-weight:600}
.level strong{font-weight:600}
.brand-name{font-family:Georgia,"Times New Roman",serif;letter-spacing:4px}
.eyebrow{letter-spacing:3px}
.foot{font-family:Georgia,"Times New Roman",serif;font-style:italic;letter-spacing:.4px}
.side-foot{font-family:Georgia,"Times New Roman",serif;font-style:italic}
</style>
</head>
<body>
<aside class="sidebar">
  <div class="brand"><span class="brand-mark">${icon('moon', 20)}</span><span><span class="brand-name">LUNA</span><span class="brand-sub">CONTROL PANEL</span></span></div>
  ${nav}
  <div class="side-foot">رابط خاص بك. لا تشاركه مع أحد.</div>
</aside>
<main class="main">
  <div class="topbar">
    <div class="top-user">
      ${view.avatar ? `<img class="top-avatar" src="${clean(view.avatar)}" alt="">` : `<span class="top-avatar">${icon('user', 20)}</span>`}
      <div><div class="top-name">${clean(view.username)}</div><div class="top-sub">${clean(view.handle || view.guildName)}</div></div>
    </div>
    <div class="chips">
      <span class="chip gold">${icon('coin', 14)}<b>${fmtNum(view.luna)}</b> Luna</span>
      <span class="chip">${icon('medal', 14)}<b>${fmtNum(view.level)}</b> Level</span>
    </div>
  </div>
  ${flashBox(flash)}
  ${content}
  <div class="foot">Luna Profile — changes sync with Discord instantly</div>
</main>
</body>
</html>`;
}

module.exports = { page, profileContent, flashBox };
