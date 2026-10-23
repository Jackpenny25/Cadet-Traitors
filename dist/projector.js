// Public display: reads only the allow-listed snapshot, never the private demo state.
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function roleLabel(s,p){const role=s.ended?p.role:s.published?.findLast(e=>e.id===p.id&&e.role)?.role;return role?'<span class="tile-role">'+esc(role)+'</span>':'';}
const screen=document.getElementById('screen');
let fingerprint='',seenReveal=null,started=false,revealUntil=0,revealTimer;
function format(n){return String(Math.floor(Math.max(0,n)/60)).padStart(2,'0')+':'+String(Math.floor(Math.max(0,n)%60)).padStart(2,'0');}
function announceReveal(r){
 if(!r?.id||!['Murdered','Banished'].includes(r.kind))return;
 const old=document.getElementById('dramatic-reveal');if(old)old.remove();
 const overlay=document.createElement('section');overlay.id='dramatic-reveal';overlay.className='dramatic-reveal';overlay.setAttribute('role','status');
 overlay.innerHTML='<div class="reveal-content"><span class="eyebrow">'+esc(r.group)+' · '+esc(r.kind)+'</span><h2>'+esc(r.name)+'</h2><div class="reveal-cross" aria-hidden="true"><i></i><i></i></div><p>Out of the game. Still part of the team.</p></div>';
 document.body.appendChild(overlay);screen.classList.add('board-dimmed');revealUntil=Date.now()+6000;
 clearTimeout(revealTimer);revealTimer=setTimeout(()=>{overlay.remove();screen.classList.remove('board-dimmed');},6000);
}
function draw(){
 let s;try{s=JSON.parse(localStorage.getItem('tno-public-v1'));}catch{}
 if(!s){screen.innerHTML='<div class="board-empty"><span class="eyebrow">2427</span><h1>Trust No One</h1><p>Waiting for the host on this browser.</p></div>';fingerprint='';return;}
 const seconds=s.running?Math.max(0,Math.ceil((s.deadline-Date.now())/1000)):s.remaining;
 const newReveal=s.lastReveal?s.lastReveal.kind+':'+s.lastReveal.id:null;
 const changed=JSON.stringify([s.phase.name,s.groups,s.players,s.announcements[0],s.ended,s.results,s.lastReveal,s.running]);
 if(changed!==fingerprint){
   fingerprint=changed;
   const out=s.players.filter(p=>p.status!=='Active').length;
   screen.innerHTML='<header class="board-header"><div><span class="eyebrow">2427 · BIGGIN HILL</span><h1>Trust No One</h1></div><div class="board-phase"><h2>'+esc(s.phase.name)+'</h2><span class="timer" id="board-timer">'+format(seconds)+'</span></div></header><div class="board-meta"><span>'+String(s.players.length-out)+' remaining <span class="muted">/ '+s.players.length+'</span></span><span class="tiny muted">Local demo · this browser only</span></div><section class="name-board" aria-label="All players" style="--group-count:'+s.groups.length+'">'+s.groups.map(g=>'<section class="board-group"><header><h2>'+esc(g.name)+'</h2><span>'+g.score+' pts</span></header><div class="board-names">'+s.players.filter(p=>p.group===g.name).map(p=>'<article class="name-tile '+(p.status!=='Active'?'eliminated':'')+'" data-player="'+p.id+'" aria-label="'+esc(p.name+', '+p.status)+'"><span class="tile-number">'+String(p.id).padStart(2,'0')+'</span><span class="tile-name">'+esc(p.name)+'</span>'+(p.status!=='Active'?'<span class="name-cross" aria-hidden="true"><i></i><i></i></span><span class="tile-status">'+p.status+'</span>':'')+roleLabel(s,p)+'</article>').join('')+'</div>'+(s.ended?'<div class="board-winner">'+esc(s.results.find(r=>r.name===g.name)?.winner??'')+' win</div>':'')+'</section>').join('')+'</section>'+(s.announcements[0]?'<footer class="board-announcement">'+esc(s.announcements[0].text)+'</footer>':'');
 }
 const timer=document.getElementById('board-timer');if(timer)timer.textContent=format(seconds);
 if(started&&newReveal!==seenReveal)announceReveal(s.lastReveal);
 seenReveal=newReveal;started=true;
}
window.addEventListener('storage',e=>{if(e.key==='tno-public-v1')draw();});
setInterval(draw,500);draw();
