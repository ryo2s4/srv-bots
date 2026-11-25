const { clean, fmtNum } = require('./youPage');
const { icon } = require('./icons');
const { effectsScript } = require('./effects');

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
  font-size:18px;line-height:1.65;
}
a{color:inherit;text-decoration:none}
.ico{display:inline-block;vertical-align:middle;flex:none}
.sidebar{
  width:250px;flex:0 0 250px;background:#e7dbc6;border-inline-start:1px solid var(--line);
  padding:26px 16px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh;
}
.brand{display:flex;align-items:center;gap:10px;padding:0 10px 22px}
.brand-mark{width:40px;height:40px;border:1px solid var(--accent-dim);border-radius:8px;display:grid;place-items:center;color:var(--accent)}
.brand-name{font-weight:800;letter-spacing:3px;font-size:14px}
.brand-sub{font-size:13px;color:var(--muted);letter-spacing:1px}
.nav-item{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:8px;color:var(--muted);font-weight:600;transition:background .15s,color .15s}
.nav-item:hover{background:#eaddc6;color:var(--text)}
.nav-item.active{background:#dcc2a0;color:#5d3a22;border-inline-start:2px solid var(--accent)}
.side-foot{margin-top:auto;padding:14px 10px;border-top:1px solid var(--line);color:var(--muted);font-size:14px;line-height:1.8}
.main{flex:1;min-width:0;padding:30px clamp(18px,3.5vw,48px) 60px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-bottom:24px;border-bottom:1px solid var(--line);margin-bottom:26px}
.top-user{display:flex;align-items:center;gap:12px;min-width:0}
.top-avatar{width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--panel2);border:1px solid var(--line)}
.top-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.top-sub{font-size:14px;color:var(--muted)}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel);border-radius:7px;padding:8px 13px;font-size:15px;color:var(--muted)}
.chip b{color:var(--text);font-variant-numeric:tabular-nums}
.chip.gold b{color:var(--gold)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:22px;margin-bottom:16px}
.panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.panel-head h2{margin:0;font-size:19px;font-weight:700;letter-spacing:.2px}
.panel-head h2::before{content:"";display:inline-block;width:3px;height:16px;background:var(--accent);margin-inline-end:9px;vertical-align:-2px;border-radius:2px}
.panel-head span{font-size:14px;color:var(--muted)}
.identity{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.avatar{width:72px;height:72px;border-radius:10px;object-fit:cover;border:1px solid var(--line);background:var(--panel2)}
.avatar.fallback{display:grid;place-items:center;color:var(--muted)}
.identity-main{min-width:0;flex:1}
.eyebrow{font-size:13px;letter-spacing:2px;color:var(--accent)}
.identity h1{margin:2px 0;font-size:28px;line-height:1.3}
.identity p{margin:0;color:var(--muted);font-size:15px}
.sep{color:#a89a84;margin:0 4px}
.level{text-align:center;border-inline-start:1px solid var(--line);padding-inline-start:18px;min-width:76px}
.level span{display:block;font-size:13px;letter-spacing:1.5px;color:var(--muted)}
.level strong{display:block;font-size:34px;color:var(--gold);font-variant-numeric:tabular-nums}
.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}
.stat{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.stat-ico{width:42px;height:42px;display:grid;place-items:center;border-radius:8px;background:var(--panel2);color:var(--accent)}
.stat-text{display:flex;flex-direction:column}
.stat-label{font-size:14px;color:var(--muted)}
.stat-value{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.stat-value small{font-size:15px;color:var(--muted);font-weight:400}
.progress{height:10px;background:#ddcfb8;border-radius:999px;overflow:hidden}
.fill{height:100%;background:var(--accent);border-radius:999px}
.boosts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.boost{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:10px;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px}
.boost-ico{grid-row:1/3;color:var(--accent)}
.boost-label{font-size:14px;color:var(--muted)}
.boost strong{font-size:23px;font-variant-numeric:tabular-nums}
.quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.quick{display:flex;align-items:center;gap:9px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px;color:var(--text);transition:border-color .15s}
.quick:hover{border-color:var(--accent-dim)}
.quick span{flex:1;font-size:16px}
.quick .ico:last-child{color:var(--muted)}
/* You pages */
.panel h3{margin:0 0 14px;font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}
.panel h3 .ico{color:var(--accent)}
.panel h3 small{font-weight:400;color:var(--muted);font-size:14px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0;padding-top:0}
.row-main{flex:1 1 240px;min-width:0}
.row-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.row-title{font-weight:700;font-size:17px}
.muted{color:var(--muted);font-size:14px;line-height:1.7}
.price{font-size:15px;color:var(--gold);font-variant-numeric:tabular-nums;margin-top:5px}
.price s{color:var(--muted);margin-inline-end:6px}
.tag{display:inline-block;border:1px solid var(--accent-dim);color:var(--accent);border-radius:5px;padding:2px 9px;font-size:13px;margin-inline-start:6px}
.tag.gold{border-color:#c9a872;color:var(--gold)}
.inline{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}
.stack{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.list{margin:0;padding-inline-start:20px;color:var(--muted);font-size:15px;line-height:1.9}
.list b{color:var(--text)}
input,select{background:#f7eedf;color:var(--text);border:1px solid var(--line);border-radius:7px;padding:9px 12px;font:inherit;font-size:16px;outline:none}
input:focus,select:focus{border-color:var(--accent-dim)}
.btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--accent-dim);background:#efe0c8;color:var(--text);border-radius:7px;padding:9px 13px;font:inherit;font-size:15px;font-weight:700;white-space:nowrap}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);color:#fff8ec;border-color:var(--accent)}
.btn.ghost{background:transparent;border-color:var(--line);color:var(--muted)}
.btn.danger{background:transparent;border-color:#d3a9a1;color:var(--danger)}
.flash{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);padding:13px 16px;margin-bottom:18px;font-size:15px}
.flash.ok{color:var(--accent);border-color:var(--accent-dim)}
.flash.err{color:var(--danger);border-color:#d3a9a1}
.foot{text-align:center;color:var(--muted);font-size:13px;margin-top:28px;letter-spacing:.3px}
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
.brand-name{font-family:Georgia,"Times New Roman",serif;letter-spacing:4px;font-size:17px}
.eyebrow{letter-spacing:3px}
.foot{font-family:Georgia,"Times New Roman",serif;font-style:italic;letter-spacing:.4px}
.side-foot{font-family:Georgia,"Times New Roman",serif;font-style:italic}
/* rune action effects */
.rune-row{position:relative}
.status-tag{display:inline-block;border:1px solid var(--line);color:var(--muted);border-radius:5px;padding:2px 9px;font-size:13px;transition:color .2s,border-color .2s,background .2s}
.status-tag.on{color:var(--accent);border-color:var(--accent-dim);background:#efe0c8}
.stat-num{color:var(--accent);font-weight:800;font-size:17px;font-variant-numeric:tabular-nums}
.rune-row.row-out{animation:rowOut .4s ease both}
@keyframes rowOut{to{opacity:0;transform:translateX(28px) scale(.9)}}
.money-fx{position:fixed;z-index:80;pointer-events:none;display:flex;align-items:center;gap:6px;font-family:Georgia,"Times New Roman",serif;font-size:19px;font-weight:700;color:var(--gold);text-shadow:0 1px 0 #fff8ec}
.money-fx.neg{color:var(--danger)}
.coin-trail{position:fixed;width:7px;height:7px;border-radius:50%;background:var(--gold);z-index:79;pointer-events:none;box-shadow:0 0 0 2px #fff8ec}
.coin-trail.neg{background:var(--danger)}
.burst-ring{position:absolute;inset-inline-start:50%;top:50%;width:80px;height:80px;margin:0;transform:translate(-50%,-50%);border:2px solid var(--accent);border-radius:50%;pointer-events:none;z-index:4}
.rune-stamp{position:absolute;inset-inline-start:50%;top:50%;transform:translate(-50%,-50%);z-index:5;pointer-events:none;border:3px solid var(--accent);color:var(--accent);background:#faf4e8f7;border-radius:6px;padding:8px 16px;font-family:Georgia,"Times New Roman",serif;font-size:18px;font-weight:700;letter-spacing:2px;white-space:nowrap;box-shadow:0 6px 18px rgba(59,47,36,.18)}
.rune-stamp.good{border-color:var(--gold);color:var(--gold)}
.confetti-piece{position:fixed;width:9px;height:14px;z-index:70;pointer-events:none;border-radius:1px}
.inline-error{color:var(--danger);font-size:13px;margin-inline-start:8px}
@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
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
${effectsScript()}
</body>
</html>`;
}

module.exports = { page, profileContent, flashBox };
