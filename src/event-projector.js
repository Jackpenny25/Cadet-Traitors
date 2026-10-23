import QRCode from 'qrcode';
import {supabaseConfig} from '../dist/supabase-config.js';
import {esc,clock,timeLeft} from './event-ui.js';
const screen=document.getElementById('screen');const token=location.hash.slice(1);
let busy=false,seen=null,queued=[],revealing=false,offset=0,current=null,qr='',joinUrl='',lastSync=0;
function showNext(){
 if(revealing||!queued.length)return;revealing=true;const r=queued.shift();
 const player=current.players.find(p=>p.id===r.target);const group=current.groups.find(g=>g.id===r.group);
 const overlay=document.createElement('section');overlay.className='dramatic-reveal';overlay.setAttribute('role','status');
  overlay.innerHTML=`<div class="reveal-content"><span class="eyebrow">${esc(group?.name)} · ${esc(!r.target?'No elimination':r.kind)}</span><h2>${esc(player?.name||'Everyone returns')}</h2><p>${r.redundant?'Already eliminated. No replacement victim.':r.role?esc(r.role):r.target?'Out of deduction. Still part of the team.':'No elimination.'}</p></div>`;
 document.body.append(overlay);setTimeout(()=>{overlay.remove();revealing=false;showNext();},6000);
}
function draw(){
 const s=current;const joining=s.joining&&!s.ended;
 screen.innerHTML=`<header class="projector-header"><div><p class="eyebrow">2427 · Biggin Hill${s.practice?' · Separate rehearsal':''}</p><h1>${esc(s.title)}</h1><p id="board-connection" role="status">Updated ${new Date(lastSync).toLocaleTimeString()}</p></div><aside class="join-qr"><img width="144" height="144" src="${qr}" alt="QR code to open the event website"><div><h2>${joining?'Join the event':'Event website'}</h2><p>Scan, then use your name<br>and four-digit PIN.</p><a href="${esc(joinUrl)}">${esc(joinUrl.replace(/^https?:\/\//,''))}</a></div></aside></header>${s.announcement?`<section class="projector-announcement" role="status">${esc(s.announcement)}</section>`:''}<section class="projector-groups" style="--group-count:${s.groups.length}">${s.groups.map(g=>`<article class="projector-group"><header><h2>${esc(g.name)}</h2><p>${g.score} mission points</p><p>${esc(g.phase)} · <span data-board-clock="${g.id}">${clock(timeLeft(g,Date.now()+offset))}</span></p></header>${g.winner?`<h3 class="winner">${esc(g.winner)} win</h3>`:''}<div class="board-names">${s.players.filter(p=>p.group===g.id).map(p=>`<div class="name-tile ${['Banished','Murdered'].includes(p.status)?'eliminated':''}"><span class="tile-number">${esc(p.number)}</span><span class="tile-name">${esc(p.name)}</span>${['Banished','Murdered'].includes(p.status)?'<span class="name-cross" aria-hidden="true"><i></i><i></i></span>':''}<span class="tile-status">${esc(p.status)}</span>${p.role?`<span class="tile-role">${esc(p.role)}</span>`:''}</div>`).join('')||'<p class="muted">Waiting for players</p>'}</div>${g.phase==='Mission'?`<div class="projector-mission"><h3>${esc(s.missions.find(m=>m.idx===g.mission)?.title)}</h3><p>${esc(s.missions.find(m=>m.idx===g.mission)?.instructions)}</p></div>`:''}</article>`).join('')}</section><footer class="board-announcement">Stay with your group. Put your phone away during physical tasks until called back.</footer>`;
}
async function refresh(){
 if(busy)return;busy=true;
 try{
  if(!/^[\da-f-]{36}$/i.test(token))throw new Error('Open the projector from the organiser dashboard.');
  const response=await fetch(supabaseConfig.url+'/rest/v1/rpc/tno_board',{method:'POST',headers:{apikey:supabaseConfig.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Projector unavailable. Check the connection and current board link.');
  current=await response.json();lastSync=Date.now();offset=Date.parse(current.server_now)-lastSync;
  if(!joinUrl){const url=new URL('./index.html',location.href);if(current.practice)url.searchParams.set('practice',current.id);joinUrl=url.href;qr=await QRCode.toDataURL(joinUrl,{width:220,margin:2,errorCorrectionLevel:'M',color:{dark:'#111410',light:'#fff9e9'}});}
  if(seen!==null)for(const r of current.reveals)if(!seen.has(r.id+':'+(r.role||'name')))queued.push(r);
  seen=new Set(current.reveals.map(r=>r.id+':'+(r.role||'name')));draw();showNext();
 }catch(error){const status=document.getElementById('board-connection');if(status)status.textContent='Connection lost. Displayed information may be out of date.';else screen.innerHTML=`<div class="board-empty"><h1>Trust No One</h1><p role="alert">${esc(error.message)}</p></div>`;}
 finally{busy=false;}
}
refresh();setInterval(refresh,2000);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!current)return;document.querySelectorAll('[data-board-clock]').forEach(el=>{const g=current.groups.find(g=>g.id===el.dataset.boardClock);el.textContent=clock(timeLeft(g,Date.now()+offset))+(g.paused?' · paused':'');});},1000);
