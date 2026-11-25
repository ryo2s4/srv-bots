// Client-side animation layer for rune actions.
// Feedback lives on the affected elements: numbers count, rows change state,
// coins travel, stamps appear on the rune itself. No toast/card UI.
function effectsScript() {
  return `<script>
(function(){
  var toneCtx=null;
  function audio(){
    if(!toneCtx){ try{ toneCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
    if(toneCtx&&toneCtx.state==='suspended')toneCtx.resume();
    return toneCtx;
  }
  function tone(freq,delay,dur,type){
    var c=audio(); if(!c)return;
    var o=c.createOscillator(),g=c.createGain();
    o.type=type||'sine'; o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,c.currentTime+delay);
    g.gain.exponentialRampToValueAtTime(0.07,c.currentTime+delay+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+delay+dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime+delay); o.stop(c.currentTime+delay+dur+0.03);
  }
  function sound(kind){
    if(kind==='fuse'){
      tone(294,0,0.14,'triangle'); tone(392,0.11,0.16,'triangle');
      tone(523,0.23,0.20,'triangle'); tone(784,0.38,0.36,'sine');
    } else if(kind==='upgrade'){
      tone(523,0,0.10,'sine'); tone(659,0.09,0.12,'sine'); tone(880,0.20,0.28,'sine');
    } else if(kind==='coin'){
      tone(784,0,0.07,'triangle'); tone(1046,0.07,0.12,'triangle');
    }
  }
  function rowById(id){
    var rows=document.querySelectorAll('.rune-row');
    for(var i=0;i<rows.length;i++){ if(rows[i].getAttribute('data-rune-id')===id)return rows[i]; }
    return null;
  }
  function rectCenter(el){
    var r=el.getBoundingClientRect();
    return { x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height, top:r.top };
  }
  function coinSvg(){
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h4"/></svg>';
  }
  function money(delta,fromEl,toEl){
    if(!delta)return;
    var from=fromEl?((fromEl.width||fromEl.w)?fromEl:rectCenter(fromEl)):null;
    var to=toEl?((toEl.width||toEl.w)?toEl:rectCenter(toEl)):null;
    var el=document.createElement('div');
    el.className='money-fx'+(delta<0?' neg':'');
    el.innerHTML=coinSvg()+'<span>'+(delta>0?'+':'')+delta+'</span>';
    el.style.left=((from?from.x:window.innerWidth/2)-26)+'px';
    el.style.top=((from?from.top:window.innerHeight/2)-14)+'px';
    document.body.appendChild(el);
    var dx=to?to.x-(from?from.x:window.innerWidth/2):(delta<0?90:-90);
    var dy=to?to.y-(from?from.top:window.innerHeight/2):-70;
    el.animate([
      {transform:'translate(0,0) scale(.5)',opacity:0},
      {transform:'translate('+(dx*0.18)+'px,'+(dy*0.12-46)+'px) scale(1.6)',opacity:1,offset:0.3},
      {transform:'translate('+(dx*0.62)+'px,'+(dy*0.55-24)+'px) scale(1.35)',opacity:1,offset:0.62},
      {transform:'translate('+dx+'px,'+dy+'px) scale(.7)',opacity:0}
    ],{duration:1500,easing:'cubic-bezier(.2,.7,.2,1)'}).onfinish=function(){ el.remove(); };
    for(var i=1;i<=3;i++){
      var trail=document.createElement('span');
      trail.className='coin-trail'+(delta<0?' neg':'');
      trail.style.left=((from?from.x:window.innerWidth/2)-4)+'px';
      trail.style.top=((from?from.top:window.innerHeight/2)-4)+'px';
      document.body.appendChild(trail);
      trail.animate([
        {transform:'translate(0,0) scale(.4)',opacity:0},
        {transform:'translate('+(dx*0.4)+'px,'+(dy*0.4-30)+'px) scale(1)',opacity:.9,offset:.4},
        {transform:'translate('+dx+'px,'+dy+'px) scale(.3)',opacity:0}
      ],{duration:1500,delay:i*90,easing:'ease-out'}).onfinish=function(){ this.effect.target.remove(); };
    }
  }
  function balanceCount(from,to){
    if(!from&&from!==0)return;
    if(from===to)return;
    var el=document.querySelector('.chip.gold b'); if(!el)return;
    var start=performance.now(),dur=1200;
    el.animate([
      {color:'var(--gold)',backgroundColor:'transparent'},
      {color:'#7d4a24',backgroundColor:'#efe0c8',offset:.3},
      {color:'var(--gold)',backgroundColor:'transparent'}
    ],{duration:dur});
    function frame(now){
      var t=Math.min(1,(now-start)/dur), e=1-Math.pow(1-t,3);
      el.textContent=Math.round(from+(to-from)*e).toLocaleString('en-US');
      if(t<1)requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function rowFlash(row,color){
    row.animate([
      {backgroundColor:'transparent',transform:'scale(1)',boxShadow:'0 0 0 0 rgba(138,90,56,0)'},
      {backgroundColor:color||'#d8bfa0',transform:'scale(1.02)',boxShadow:'0 0 0 3px rgba(138,90,56,.35)',offset:.28},
      {backgroundColor:'transparent',transform:'scale(1)',boxShadow:'0 0 0 0 rgba(138,90,56,0)'}
    ],{duration:1300,easing:'ease-out'});
  }
  function burst(row){
    if(!row)return;
    var b=document.createElement('span');
    b.className='burst-ring';
    row.appendChild(b);
    b.animate([
      {transform:'translate(-50%,-50%) scale(.2)',opacity:.9},
      {transform:'translate(-50%,-50%) scale(2.6)',opacity:0}
    ],{duration:750,easing:'ease-out'}).onfinish=function(){ b.remove(); };
  }
  function stamp(row,text,good){
    if(!row)return;
    var s=document.createElement('div');
    s.className='rune-stamp'+(good?' good':'');
    s.textContent=text;
    row.appendChild(s);
    s.animate([
      {transform:'translate(-50%,-50%) scale(2.1) rotate(-8deg)',opacity:0},
      {transform:'translate(-50%,-50%) scale(1) rotate(-3deg)',opacity:1,offset:.22},
      {transform:'translate(-50%,-50%) scale(1.06) rotate(-3deg)',opacity:1,offset:.72},
      {transform:'translate(-50%,-50%) scale(.95) rotate(-3deg)',opacity:0}
    ],{duration:1700,easing:'ease-out'}).onfinish=function(){ s.remove(); };
  }
  function nums(s){
    var m=String(s||'').match(/\\d+%/g)||[];
    return m.map(function(x){return parseInt(x,10);});
  }
  function statSwap(row,before,after){
    var el=row?row.querySelector('.rune-stats'):null;
    if(!el)return;
    var oldNums=nums(before), newNums=nums(after);
    var html=String(after||'').replace(/\\d+%/g,function(){return '<span class="stat-num">0%</span>';});
    el.innerHTML=html;
    rowFlash(row);
    var spans=el.querySelectorAll('.stat-num');
    var start=performance.now(), dur=1400;
    function frame(now){
      var t=Math.min(1,(now-start)/dur);
      var e=1-Math.pow(1-t,3);
      for(var i=0;i<spans.length;i++){
        var a=oldNums[i]==null?0:oldNums[i];
        var b=newNums[i]==null?a:newNums[i];
        spans[i].textContent=Math.round(a+(b-a)*e)+'%';
      }
      if(t<1)requestAnimationFrame(frame);
      else el.textContent=after||el.textContent;
    }
    requestAnimationFrame(frame);
  }
  function confetti(row){
    var c=row?rectCenter(row):{x:window.innerWidth/2,y:window.innerHeight/2,w:200};
    var colors=['#8a5a38','#c9a872','#efe3cf','#a9762f','#d9c7ab'];
    for(var i=0;i<44;i++){
      var p=document.createElement('i');
      p.className='confetti-piece';
      p.style.left=(c.x-c.w/2+Math.random()*c.w)+'px';
      p.style.top=(c.y-8)+'px';
      p.style.background=colors[i%colors.length];
      document.body.appendChild(p);
      var dx=(Math.random()-0.5)*300;
      var dy=180+Math.random()*340;
      p.animate([
        {transform:'translate(0,0) rotate(0deg)',opacity:1},
        {transform:'translate('+dx+'px,'+dy+'px) rotate('+(Math.random()*720-360)+'deg)',opacity:0}
      ],{duration:1300+Math.random()*900,easing:'cubic-bezier(.2,.6,.3,1)'}).onfinish=function(){ this.effect.target.remove(); };
    }
  }
  function materialize(row){
    if(!row)return;
    rowFlash(row);
    burst(row);
    row.animate([
      {transform:'scale(.8)',opacity:0},
      {transform:'scale(1.06)',opacity:1,offset:.42},
      {transform:'scale(1)',opacity:1}
    ],{duration:750,easing:'ease-out'});
  }
  function inlineError(btn,msg){
    if(!btn)return;
    btn.animate([
      {transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},
      {transform:'translateX(-3px)'},{transform:'translateX(0)'}
    ],{duration:280,easing:'ease-in-out'});
    var s=document.createElement('span');
    s.className='inline-error'; s.textContent=msg;
    btn.parentNode.appendChild(s);
    setTimeout(function(){ s.remove(); },2600);
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
          var actionEl=f.querySelector('input[name="action"]');
          var action=actionEl?actionEl.value:'';
          var ridEl=f.querySelector('input[name="runeId"]');
          var oldRow=ridEl?rowById(ridEl.value):null;
          var oldStats=oldRow?oldRow.querySelector('.rune-stats'):null;
          var before=oldStats?oldStats.textContent:'';
          var oldCenter=oldRow?rectCenter(oldRow):null;
          var oldRect=oldCenter;
          var chip=document.querySelector('.chip.gold');
          try{
            var body=new URLSearchParams();
            new FormData(f).forEach(function(v,k){ body.append(k,v); });
            var res=await fetch(f.getAttribute('action'),{method:'POST',body:body,headers:{'Accept':'application/json','X-Requested-With':'XMLHttpRequest'}});
            var data=await res.json();
            if(!data.ok){ inlineError(btn,data.msg); if(btn)btn.disabled=false; return; }
            var box=document.getElementById('runes-content');
            var consumed=data.consumedIds||[];
            if(data.fx==='sell'&&data.runeId&&consumed.indexOf(data.runeId)<0)consumed.push(data.runeId);
            consumed.forEach(function(id,idx){ var r=rowById(id); if(r)setTimeout(function(){ r.classList.add('row-out'); },idx*55); });

            if(data.fx==='fuse')sound('fuse');
            if(data.fx==='upgrade'){ sound('upgrade'); confetti(oldRow); }
            if(data.fx==='buy'||data.fx==='sell')sound('coin');
            if(data.fx==='sell')money(data.balanceAfter-data.balanceBefore,oldRect||chip,chip);

            var wait=consumed.length?420:0;
            setTimeout(function(){
              if(data.html&&box){
                box.outerHTML=data.html;
                var row=data.runeId?rowById(data.runeId):null;
                var lunaChip=document.querySelector('.chip.gold');
                balanceCount(data.balanceBefore,data.balanceAfter);
                if(data.fx==='equip'||data.fx==='unequip'){
                  stamp(row,data.status,data.fx==='equip');
                  rowFlash(row);
                }
                if(data.fx==='upgrade'||data.fx==='reroll'){
                  if(data.fx==='upgrade')burst(row);
                  statSwap(row,before||data.before,data.after);
                }
                if(data.fx==='buy'||data.fx==='fuse'){
                  materialize(row);
                  if(data.fx!=='fuse')money(data.balanceAfter-data.balanceBefore,lunaChip,row);
                }
              }
              bind();
            },wait);
          }catch(err){
            inlineError(btn,'Connection failed'); if(btn)btn.disabled=false;
            setTimeout(function(){ try{ f.submit(); }catch(e){} },600);
          }
        });
      })(forms[i]);
    }
  }
  bind();
})();
<\/script>`;
}

module.exports = { effectsScript };
