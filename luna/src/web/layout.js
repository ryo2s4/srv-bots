const { esc, fmtNum } = require('./youPage');

const NAV = [
    { key: 'profile', icon: '🌙', label: 'الملف الشخصي' },
    { key: 'runes', icon: '🔮', label: 'الرونات' },
    { key: 'shop', icon: '🛍️', label: 'المتجر' },
    { key: 'inventory', icon: '🎒', label: 'ممتلكاتي' }
];

function flashBox(flash) {
    if (!flash) return '';
    const ok = flash.ok !== false;
    return `<div class="flash ${ok ? 'ok' : 'err'}"><span class="flash-ico">${ok ? '✨' : '⚠️'}</span><div>${esc(flash.msg).replace(/\n/g, '<br>')}</div></div>`;
}

function profileContent(view, token) {
    const xpPct = Math.max(0, Math.min(100, (view.xp / view.nextXp) * 100));
    const boost = (icon, label, value, cls) => `
      <div class="boost-card ${cls}">
        <div class="boost-ico">${icon}</div>
        <div class="boost-info"><div class="boost-label">${label}</div><div class="boost-value">+${fmtNum(value)}%</div></div>
      </div>`;
    const quick = (key, icon, label) => `<a class="quick-card" href="/p/${token}?tab=${key}"><span>${icon}</span><b>${label}</b><i>←</i></a>`;

    return `
      <section class="hero">
        <div class="hero-glow"></div>
        <div class="hero-user">
          ${view.avatar ? `<img src="${esc(view.avatar)}" alt="avatar" class="hero-avatar">` : '<div class="hero-avatar placeholder">🌙</div>'}
          <div>
            <div class="hero-eyebrow">LUNA PROFILE</div>
            <h1>${esc(view.username)}</h1>
            <div class="hero-sub">${esc(view.handle)} · 🌙 ${esc(view.guildName)}</div>
          </div>
        </div>
        <div class="hero-badge"><span>المستوى</span><strong>${fmtNum(view.level)}</strong></div>
      </section>

      <div class="stat-grid">
        <div class="stat-card accent"><div class="stat-ico">💰</div><div><div class="stat-label">نقاط لونا</div><div class="stat-value">${fmtNum(view.luna)}</div></div></div>
        <div class="stat-card"><div class="stat-ico">🎖️</div><div><div class="stat-label">الخبرة</div><div class="stat-value">${fmtNum(view.xp)} <small>/ ${fmtNum(view.nextXp)}</small></div></div></div>
      </div>

      <section class="section">
        <div class="section-head"><h2>تقدم المستوى</h2><span class="section-note">${xpPct.toFixed(1)}% إلى المستوى التالي</span></div>
        <div class="progress"><div class="progress-fill" style="width:${xpPct.toFixed(2)}%"></div></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>إجمالي البوستات</h2><span class="section-note">رتب + رونات + بوستات المتجر</span></div>
        <div class="boost-grid">
          ${boost('⚡', 'XP Boost', view.boosts.xp, 'xp')}
          ${boost('💰', 'Luna Boost', view.boosts.luna, 'luna')}
          ${boost('🏅', 'Level-Up Boost', view.boosts.levelup, 'level')}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>إدارة حسابك</h2></div>
        <div class="quick-grid">
          ${quick('runes', '🔮', 'الرونات')}
          ${quick('shop', '🛍️', 'المتجر')}
          ${quick('inventory', '🎒', 'ممتلكاتي')}
        </div>
      </section>`;
}

function page({ token, view, tab, flash, content }) {
    const active = tab || 'profile';
    const nav = NAV.map((n) => `<a class="nav-item ${active === n.key ? 'active' : ''}" href="/p/${token}?tab=${n.key}"><span class="nav-ico">${n.icon}</span><span>${n.label}</span></a>`).join('');
    const title = NAV.find((n) => n.key === active)?.label || 'Luna Profile';

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#0b1020">
  <title>${esc(title)} — Luna</title>
  <style>
    :root{
      --bg:#080c18; --panel:#121a2d; --panel2:#182139; --text:#f2f5ff; --muted:#9aa8c7;
      --a1:#b99cff; --a2:#6fd7ff; --gold:#ffd89b; --danger:#ff8a8a;
      --line:rgba(255,255,255,.09); --shadow:0 18px 50px rgba(0,0,0,.45);
    }
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%}
    body{
      font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;
      color:var(--text); background:
        radial-gradient(900px 500px at 80% -10%,rgba(185,156,255,.18),transparent 60%),
        radial-gradient(700px 500px at 0% 100%,rgba(111,215,255,.10),transparent 60%),
        var(--bg);
      display:flex; align-items:stretch; min-height:100vh;
    }
    a{color:inherit}
    .sidebar{
      width:248px; flex:0 0 248px; position:sticky; top:0; height:100vh;
      padding:26px 18px; background:rgba(18,26,45,.75); backdrop-filter:blur(18px);
      border-inline-start:1px solid var(--line); display:flex; flex-direction:column; gap:8px;
    }
    .brand{display:flex;align-items:center;gap:12px;padding:6px 10px 22px}
    .brand-mark{
      width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-size:20px;
      background:linear-gradient(135deg,var(--a1),var(--a2)); box-shadow:0 8px 24px rgba(185,156,255,.35);
    }
    .brand-name{font-weight:900;letter-spacing:.5px;font-size:18px}
    .brand-sub{font-size:11px;color:var(--muted);margin-top:2px}
    .nav-item{
      display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;
      text-decoration:none;color:var(--muted);font-size:14px;font-weight:600;transition:.18s ease;
      border:1px solid transparent;
    }
    .nav-item:hover{background:rgba(255,255,255,.05);color:var(--text)}
    .nav-item.active{
      color:#fff;background:linear-gradient(135deg,rgba(185,156,255,.22),rgba(111,215,255,.12));
      border-color:rgba(185,156,255,.35);box-shadow:inset 0 0 0 1px rgba(255,255,255,.03);
    }
    .nav-ico{font-size:18px;width:24px;text-align:center}
    .side-foot{margin-top:auto;padding:14px 12px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.7}
    .main{flex:1;min-width:0;padding:28px clamp(18px,4vw,48px) 60px}
    .topbar{
      display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
      padding:14px 18px;border-radius:20px;background:rgba(18,26,45,.7);
      border:1px solid var(--line);backdrop-filter:blur(16px);margin-bottom:24px;
    }
    .top-user{display:flex;align-items:center;gap:12px;min-width:0}
    .top-avatar{width:46px;height:46px;border-radius:14px;object-fit:cover;background:#222;border:1px solid var(--line)}
    .top-name{font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .top-sub{font-size:12px;color:var(--muted);margin-top:3px}
    .chips{display:flex;gap:10px;flex-wrap:wrap}
    .chip{background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:999px;padding:8px 14px;font-size:13px;color:var(--muted)}
    .chip b{color:var(--gold);font-size:15px;margin-inline-start:6px}
    .flash{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:16px;margin-bottom:20px;font-size:13px;line-height:1.7}
    .flash.ok{background:rgba(111,215,255,.10);border:1px solid rgba(111,215,255,.32);color:#bfeaff}
    .flash.err{background:rgba(255,138,138,.10);border:1px solid rgba(255,138,138,.32);color:#ffc2c2}
    .flash-ico{font-size:16px}
    .hero{
      position:relative;overflow:hidden;border-radius:26px;padding:28px;margin-bottom:20px;
      background:linear-gradient(135deg,rgba(185,156,255,.16),rgba(24,33,57,.95) 55%);
      border:1px solid rgba(185,156,255,.25);box-shadow:var(--shadow);
      display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;
    }
    .hero-glow{position:absolute;width:260px;height:260px;border-radius:50%;background:rgba(111,215,255,.12);filter:blur(60px);inset-inline-end:-60px;top:-100px;pointer-events:none}
    .hero-user{display:flex;align-items:center;gap:18px;position:relative;min-width:0}
    .hero-avatar{width:84px;height:84px;border-radius:24px;object-fit:cover;border:2px solid rgba(255,255,255,.2);box-shadow:0 10px 30px rgba(0,0,0,.4)}
    .hero-avatar.placeholder{display:grid;place-items:center;background:#1b2340;font-size:34px}
    .hero-eyebrow{font-size:11px;letter-spacing:2.5px;color:var(--a2);font-weight:800}
    .hero h1{margin:6px 0 4px;font-size:clamp(22px,3vw,32px);line-height:1.2}
    .hero-sub{color:var(--muted);font-size:13px}
    .hero-badge{position:relative;text-align:center;background:rgba(8,12,24,.45);border:1px solid var(--line);border-radius:20px;padding:14px 22px;min-width:110px}
    .hero-badge span{display:block;font-size:11px;color:var(--muted)}
    .hero-badge strong{display:block;font-size:34px;line-height:1.1;margin-top:4px;color:var(--gold)}
    .stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:20px}
    .stat-card{display:flex;align-items:center;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:18px}
    .stat-card.accent{border-color:rgba(255,216,155,.28);background:linear-gradient(135deg,rgba(255,216,155,.10),var(--panel))}
    .stat-ico{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.06);font-size:20px}
    .stat-label{font-size:12px;color:var(--muted)}
    .stat-value{font-size:24px;font-weight:800;margin-top:3px}
    .stat-value small{font-size:13px;color:var(--muted);font-weight:500}
    .section{background:rgba(18,26,45,.72);border:1px solid var(--line);border-radius:22px;padding:20px;margin-bottom:18px}
    .section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
    .section-head h2{margin:0;font-size:16px;font-weight:800}
    .section-note{font-size:12px;color:var(--muted)}
    .progress{height:12px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}
    .progress-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--a1),var(--a2));box-shadow:0 0 18px rgba(185,156,255,.5)}
    .boost-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .boost-card{display:flex;align-items:center;gap:12px;padding:16px;border-radius:18px;background:var(--panel2);border:1px solid var(--line)}
    .boost-card.xp{border-color:rgba(185,156,255,.3)}
    .boost-card.luna{border-color:rgba(255,216,155,.3)}
    .boost-card.level{border-color:rgba(111,215,255,.3)}
    .boost-ico{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:rgba(255,255,255,.06);font-size:20px}
    .boost-label{font-size:12px;color:var(--muted)}
    .boost-value{font-size:22px;font-weight:900;margin-top:2px}
    .quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .quick-card{display:flex;align-items:center;gap:10px;text-decoration:none;padding:16px;border-radius:16px;background:var(--panel2);border:1px solid var(--line);transition:.18s}
    .quick-card:hover{transform:translateY(-2px);border-color:rgba(185,156,255,.4)}
    .quick-card span{font-size:20px}
    .quick-card b{font-size:14px;flex:1}
    .quick-card i{color:var(--a2);font-style:normal}
    /* You pages */
    .panel{background:var(--panel2);border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:14px}
    .panel h3{margin:0 0 14px;font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px}
    .panel h3 small{font-weight:500;color:var(--muted);font-size:12px}
    .card-row{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--line)}
    .card-row:first-of-type{border-top:0;padding-top:0}
    .row-main{flex:1 1 260px;min-width:0}
    .row-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .rune-title{font-weight:800;font-size:14px}
    .muted{color:var(--muted);font-size:12px;line-height:1.6}
    .price{margin-top:6px;font-size:13px;color:var(--gold)}
    .pill{display:inline-block;background:rgba(111,215,255,.15);color:var(--a2);border-radius:999px;padding:3px 9px;font-size:11px;margin-inline-start:6px}
    .pill.gold{background:rgba(255,216,155,.15);color:var(--gold)}
    .inline{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}
    .stack{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
    .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .list{margin:0;padding-inline-start:18px;line-height:1.9;font-size:13px;color:var(--muted)}
    .list b{color:var(--text)}
    input,select{background:#0d1425;color:var(--text);border:1px solid var(--line);border-radius:11px;padding:9px 11px;font:inherit;font-size:13px;outline:none}
    input:focus,select:focus{border-color:rgba(185,156,255,.6)}
    .btn{cursor:pointer;border:1px solid transparent;border-radius:11px;padding:9px 14px;background:linear-gradient(135deg,var(--a1),#a98cff);color:#160f2b;font-weight:800;font-size:12px;transition:.15s;white-space:nowrap}
    .btn:hover{filter:brightness(1.1);transform:translateY(-1px)}
    .btn.ghost{background:rgba(255,255,255,.05);color:var(--text);border-color:var(--line)}
    .btn.danger{background:rgba(255,138,138,.16);color:#ffb0b0;border-color:rgba(255,138,138,.35)}
    .foot{text-align:center;color:var(--muted);font-size:11px;margin-top:26px}
    @media(max-width:900px){
      body{display:block}
      .sidebar{position:static;width:100%;height:auto;flex:none;flex-direction:row;align-items:center;overflow-x:auto;padding:14px;border-inline-start:0;border-bottom:1px solid var(--line)}
      .brand{padding:0 14px 0 0}
      .brand-sub,.side-foot{display:none}
      .nav-item{white-space:nowrap}
      .main{padding:20px 16px 40px}
      .boost-grid,.quick-grid,.stat-grid,.grid2{grid-template-columns:1fr}
      .hero{padding:20px}
    }
  </style>
</head>
<body>
  <aside class="sidebar">
    <div class="brand"><div class="brand-mark">🌙</div><div><div class="brand-name">LUNA</div><div class="brand-sub">لوحة التحكم</div></div></div>
    ${nav}
    <div class="side-foot">رابط خاص بك<br>لا تشاركه مع أحد 💜</div>
  </aside>
  <main class="main">
    <div class="topbar">
      <div class="top-user">
        ${view.avatar ? `<img class="top-avatar" src="${esc(view.avatar)}" alt="avatar">` : '<div class="top-avatar">🌙</div>'}
        <div><div class="top-name">${esc(view.username)}</div><div class="top-sub">${esc(view.handle || view.guildName)}</div></div>
      </div>
      <div class="chips"><div class="chip">💰 <b>${fmtNum(view.luna)}</b> لونا</div><div class="chip">🎖️ <b>${fmtNum(view.level)}</b> مستوى</div></div>
    </div>
    ${flashBox(flash)}
    ${content}
    <div class="foot">Luna Profile • كل التغييرات تتزامن مع Discord مباشرة ✨</div>
  </main>
</body>
</html>`;
}

module.exports = { page, profileContent, flashBox };
