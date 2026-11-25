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
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h4"/></svg>';
  }
  function money(delta,fromEl,toEl){
    if(!delta)return;
    var from=fromEl?(fromEl.width?fromEl:rectCenter(fromEl)):null;
    var to=toEl?(toEl.width?toEl:rectCenter(toEl)):null;
    var el=document.createElement('div');
    el.className='money-fx'+(delta<0?' neg':'');
    el.innerHTML=coinSvg()+'<span>'+(delta>0?'+':'')+delta+'</span>';
    el.style.left=((from?from.x:window.innerWidth/2)-22)+'px';
    el.style.top=((from?from.top:window.innerHeight/2)-10)+'px';
    document.body.appendChild(el);
    var dx=to?to.x-(from?from.x:window.innerWidth/2):(delta<0?70:-70);
    var dy=to?to.y-(from?from.top:window.innerHeight/2):-60;
    var a=el.animate([
      {transform:'translate(0,0) scale(.7)',opacity:0},
      {transform:'translate('+(dx*0.22)+'px,'+(dy*0.18-14)+'px) scale(1.08)',opacity:1,offset:0.22},
      {transform:'translate('+dx+'px,'+dy+'px) scale(.85)',opacity:0}
    ],{duration:1000,easing:'cubic-bezier(.2,.7,.2,1)'});
    a.onfinish=function(){ el.remove(); };
  }
  function rowFlash(row,color){
    row.animate([
      {backgroundColor:'transparent'},
      {backgroundColor:color||'#efe0c8',offset:0.25},
      {backgroundColor:'transparent'}
    ],{duration:900,easing:'ease-out'});
  }
  function stamp(row,text,good){
    if(!row)return;
    var s=document.createElement('div');
    s.className='rune-stamp'+(good?' good':'');
    s.textContent=text;
    row.appendChild(s);
    s.animate([
      {transform:'translate(-50%,-50%) scale(1.6) rotate(-5deg)',opacity:0},
      {transform:'translate(-50%,-50%) scale(1) rotate(-2deg)',opacity:1,offset:0.28},
      {transform:'translate(-50%,-50%) scale(1) rotate(-2deg)',opacity:1,offset:0.7},
      {transform:'translate(-50%,-50%) scale(.96) rotate(-2deg)',opacity:0}
    ],{duration:1100,easing:'ease-out'}).onfinish=function(){ s.remove(); };
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
    var start=performance.now(), dur=850;
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
    for(var i=0;i<26;i++){
      var p=document.createElement('i');
      p.className='confetti-piece';
      p.style.left=(c.x-c.w/2+Math.random()*c.w)+'px';
      p.style.top=(c.y-6)+'px';
      p.style.background=colors[i%colors.length];
      document.body.appendChild(p);
      var dx=(Math.random()-0.5)*180;
      var dy=140+Math.random()*280;
      p.animate([
        {transform:'translate(0,0) rotate(0deg)',opacity:1},
        {transform:'translate('+dx+'px,'+dy+'px) rotate('+(Math.random()*720-360)+'deg)',opacity:0}
      ],{duration:900+Math.random()*700,easing:'cubic-bezier(.2,.6,.3,1)'}).onfinish=function(){ this.effect.target.remove(); };
    }
  }
  function materialize(row){
    if(!row)return;
    rowFlash(row);
    row.animate([
      {transform:'scale(.94)',opacity:0},
      {transform:'scale(1.02)',opacity:1,offset:0.45},
      {transform:'scale(1)',opacity:1}
    ],{duration:520,easing:'ease-out'});
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
            consumed.forEach(function(id,idx){ var r=rowById(id); if(r)setTimeout(function(){ r.classList.add('row-out'); },idx*55); });

            if(data.fx==='fuse')sound('fuse');
            if(data.fx==='upgrade'){ sound('upgrade'); confetti(oldRow); }

            var wait=consumed.length?420:0;
            setTimeout(function(){
              if(data.html&&box){
                box.outerHTML=data.html;
                var row=data.runeId?rowById(data.runeId):null;
                var lunaChip=document.querySelector('.chip.gold');
                if(data.fx==='equip'||data.fx==='unequip'){
                  stamp(row,data.status,data.fx==='equip');
                  rowFlash(row);
                }
                if(data.fx==='upgrade'||data.fx==='reroll'){
                  statSwap(row,before||data.before,data.after);
                }
                if(data.fx==='buy'||data.fx==='fuse'){
                  materialize(row);
                  money(data.balanceAfter-data.balanceBefore,lunaChip,row);
                }
                if(data.fx==='sell'){
                  money(data.balanceAfter-data.balanceBefore,oldRect||lunaChip,lunaChip);
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
