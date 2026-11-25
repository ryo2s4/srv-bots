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
.status-tag{display:inline-block;border:1px solid var(--line);color:var(--muted);border-radius:5px;padding:2px 9px;font-size:13px;transition:color .2s,border-color .2s,background .2s}
.status-tag.on{color:var(--accent);border-color:var(--accent-dim);background:#efe0c8}
.status-tag.pop{animation:tagPop .5s ease}
.rune-row.changing{animation:rowPulse .9s ease}
.rune-row .rune-stats{transition:color .3s}
.stat-old{color:var(--muted);text-decoration:line-through}
.stat-arrow{color:var(--accent);margin:0 6px}
.stat-new{color:var(--accent);font-weight:700}
.rune-row.stat-change{animation:statSwap 1.1s ease}
.rune-row.row-in{animation:rowIn .55s ease both}
.rune-row.row-out{animation:rowOut .4s ease both}
.money-fly{position:fixed;z-index:60;pointer-events:none;font-family:Georgia,serif;font-size:15px;font-weight:700;color:var(--gold);animation:moneyFloat 1.15s ease-out forwards;text-shadow:0 1px 0 #fff8ec}
.money-fly.neg{color:var(--danger)}
.fx-toast{position:fixed;inset-inline-end:20px;bottom:20px;z-index:70;max-width:min(420px,calc(100vw - 40px));border:1px solid var(--accent-dim);background:var(--panel);color:var(--text);border-radius:var(--radius);padding:13px 16px;font-size:15px;box-shadow:0 8px 24px rgba(59,47,36,.14);animation:toastIn .28s ease both}
.fx-toast.err{border-color:#d3a9a1;color:var(--danger)}
.confetti-piece{position:fixed;top:-12px;width:7px;height:11px;z-index:80;pointer-events:none;animation:confettiFall var(--dur) linear forwards;border-radius:1px}
@keyframes tagPop{0%{transform:scale(.7);opacity:.3}60%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}
@keyframes rowPulse{0%{background:transparent}30%{background:#efe0c8}100%{background:transparent}}
@keyframes statSwap{0%{transform:translateY(0)}25%{transform:translateY(-3px);opacity:.55}55%{transform:translateY(2px);opacity:1}100%{transform:translateY(0)}}
@keyframes rowIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes rowOut{to{opacity:0;transform:translateX(12px)}}
@keyframes moneyFloat{0%{opacity:0;transform:translateY(6px)}20%{opacity:1}100%{opacity:0;transform:translateY(-34px)}}
@keyframes toastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes confettiFall{to{transform:translateY(105vh) rotate(var(--spin));opacity:.9}}
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
<script>
(function(){
  var audioCtx=null;
  function audio(){
    if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
    if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume();
    return audioCtx;
  }
  function tone(freq,delay,dur,type){
    var c=audio(); if(!c)return;
    var o=c.createOscillator(),g=c.createGain();
    o.type=type||'sine'; o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,c.currentTime+delay);
    g.gain.exponentialRampToValueAtTime(0.08,c.currentTime+delay+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+delay+dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime+delay); o.stop(c.currentTime+delay+dur+0.03);
  }
  function sound(kind){
    if(kind==='fuse'){ tone(330,0,0.16,'triangle'); tone(440,0.12,0.18,'triangle'); tone(660,0.26,0.28,'sine'); }
  }
  function toast(msg,ok){
    var t=document.createElement('div');
    t.className='fx-toast'+(ok?'':' err'); t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(function(){t.remove();},320); },2600);
  }
  function money(delta){
    if(!delta)return;
    var chip=document.querySelector('.chip.gold')||document.body;
    var r=chip.getBoundingClientRect();
    var el=document.createElement('div');
    el.className='money-fly'+(delta<0?' neg':'');
    el.textContent=(delta>0?'+':'')+delta;
    el.style.left=(r.left+10)+'px'; el.style.top=(r.top+8)+'px';
    document.body.appendChild(el);
    setTimeout(function(){el.remove();},1250);
  }
  function confetti(){
    var colors=['#8a5a38','#c9a872','#efe3cf','#a9762f','#d9c7ab'];
    for(var i=0;i<34;i++){
      var p=document.createElement('i');
      p.className='confetti-piece';
      p.style.left=(Math.random()*100)+'vw';
      p.style.background=colors[i%colors.length];
      p.style.setProperty('--dur',(1.1+Math.random()*0.9)+'s');
      p.style.setProperty('--spin',(Math.random()*720-360)+'deg');
      p.style.animationDelay=(Math.random()*0.25)+'s';
      document.body.appendChild(p);
      (function(node){ setTimeout(function(){node.remove();},2500); })(p);
    }
  }
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"]/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }
  function rowById(id){
    var rows=document.querySelectorAll('.rune-row');
    for(var i=0;i<rows.length;i++){ if(rows[i].getAttribute('data-rune-id')===id)return rows[i]; }
    return null;
  }
  function status(row,text){
    var s=row.querySelector('.status-tag'); if(!s)return;
    s.textContent=text;
    if(text==='EQUIPPED')s.classList.add('on'); else s.classList.remove('on');
    s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop');
  }
  function stats(row,before,after){
    var el=row.querySelector('.rune-stats'); if(!el)return;
    var newText=el.textContent;
    el.innerHTML='<span class="stat-old">'+escapeHtml(before||'')+'</span><span class="stat-arrow">to</span><span class="stat-new">'+escapeHtml(after||newText)+'</span>';
    row.classList.add('changing','stat-change');
    setTimeout(function(){ el.textContent=newText; },1150);
  }
  function bind(){
    var forms=document.querySelectorAll('form[data-rune-ajax]:not([data-bound])');
    for(var i=0;i<forms.length;i++){
      (function(f){
        f.setAttribute('data-bound','1');
        f.addEventListener('submit',async function(e){
          e.preventDefault();
          var btn=f.querySelector('button'); if(btn)btn.disabled=true;
          audio();
          var oldStats='';
          var actionInput=f.querySelector('input[name="action"]');
          if(actionInput&&(actionInput.value==='rune_upgrade'||actionInput.value==='rune_reroll')){
            var rid=f.querySelector('input[name="runeId"]');
            var oldRow=rid?rowById(rid.value):null;
            var oldEl=oldRow?oldRow.querySelector('.rune-stats'):null;
            if(oldEl)oldStats=oldEl.textContent;
          }
          try{
            var body=new URLSearchParams();
            var fd=new FormData(f);
            fd.forEach(function(value,key){ body.append(key,value); });
            var res=await fetch(f.getAttribute('action'),{method:'POST',body:body,headers:{'Accept':'application/json','X-Requested-With':'XMLHttpRequest'}});
            if(!res.ok){ toast('Request failed: HTTP '+res.status,false); if(btn)btn.disabled=false; return; }
            var text=await res.text();
            var data;
            try{ data=JSON.parse(text); }catch(pe){ toast('Request failed: bad response '+text.slice(0,90),false); if(btn)btn.disabled=false; return; }
            if(!data.ok){ toast(data.msg,false); if(btn)btn.disabled=false; return; }
            money(data.balanceAfter-data.balanceBefore);
            if(data.fx==='fuse')sound('fuse');
            if(data.fx==='upgrade')confetti();
            var box=document.getElementById('runes-content');
            var consumed=data.consumedIds||[];
            consumed.forEach(function(id){ var r=rowById(id); if(r)r.classList.add('row-out'); });
            setTimeout(function(){
              if(data.html&&box){
                box.outerHTML=data.html;
                var row=data.runeId?rowById(data.runeId):null;
                if(row){
                  if(data.fx==='equip'||data.fx==='unequip')status(row,data.status);
                  if(data.fx==='upgrade'||data.fx==='reroll')stats(row,oldStats||data.before,data.after);
                  if(data.fx==='buy'||data.fx==='fuse')row.classList.add('row-in');
                }
              }
              bind();
            },consumed.length?380:0);
            toast(data.msg,true);
          }catch(err){
            var detail=(err&&err.message)?err.message:String(err);
            toast('Request failed: '+detail,false);
            if(btn)btn.disabled=false;
            setTimeout(function(){ try{ f.submit(); }catch(e){} },500);
          }
        });
      })(forms[i]);
    }
  }
  bind();
})();
</script>
</body>
</html>`;
}

module.exports = { page, profileContent, flashBox };
