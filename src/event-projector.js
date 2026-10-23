import QRCode from 'qrcode';
import {supabaseConfig} from '../dist/supabase-config.js';
import {esc} from './event-ui.js';
import {boardSnapshot} from './event-contract.js';
import {EliminationQueue,wings} from './event-theatre.js';
const screen=document.getElementById('screen');const token=location.hash.slice(1);
const deaths=new EliminationQueue();
let busy=false,revealing=false,current=null,qr='',joinUrl='',lastDraw='';
const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function showNext(){
 if(revealing)return;const player=deaths.next();if(!player)return;
 revealing=true;
 const group=current.groups.find(g=>g.id===player.group);
 const overlay=document.createElement('section');overlay.className='elimination-theatre';overlay.setAttribute('role','status');
 overlay.innerHTML=`<div class="elimination-ring" aria-hidden="true"></div><div class="elimination-dossier"><p class="eyebrow">${esc(group?.name)}</p><p class="elimination-verdict">${esc(player.status)}</p><h2>${esc(player.name)}</h2><span class="verdict-cross" aria-hidden="true"></span></div>`;
 screen.append(overlay);
 setTimeout(()=>{
  deaths.complete(player.id);overlay.remove();revealing=false;draw();
  const tile=screen.querySelector(`[data-player="${player.id}"]`);if(tile)tile.classList.add('just-eliminated');
  showNext();
 },reducedMotion()?1200:4800);
}
function draw(){
 const s=current;
 const fingerprint=JSON.stringify([s.title,s.groups.map(g=>[g.id,g.name]),s.players,[...deaths.presented]]);
 if(fingerprint===lastDraw)return;lastDraw=fingerprint;
 let board=screen.querySelector('.projector-groups');
 if(!board){
  screen.innerHTML=`<header class="projector-header"><div class="projector-title">${wings}<p class="eyebrow">2427 Biggin Hill Air Cadets${s.practice?' · Rehearsal':''}</p><h1>${esc(s.title)}</h1></div><a class="join-qr" href="${esc(joinUrl)}" aria-label="Open the event website"><img width="144" height="144" src="${qr}" alt="Scan to open Trust No One"></a></header><p id="board-connection" class="board-connection" role="status" hidden></p><section class="projector-groups" style="--group-count:${s.groups.length}" aria-label="Player groups"></section>`;
  board=screen.querySelector('.projector-groups');
 }
 screen.querySelector('h1').textContent=s.title;
 screen.style.setProperty('--roster-rows',Math.max(1,...s.groups.map(g=>s.players.filter(p=>p.group===g.id).length)));
 board.style.setProperty('--group-count',s.groups.length);
 board.innerHTML=s.groups.map((g,i)=>`<article class="projector-group flight-${i}"><header><span class="flight-index" aria-hidden="true">0${i+1}</span><h2>${esc(g.name)}</h2></header><div class="board-names">${s.players.filter(p=>p.group===g.id).sort((a,b)=>a.number-b.number).map(p=>{
  const dead=deaths.presented.has(p.id);return `<div data-player="${esc(p.id)}" class="name-tile ${dead?'eliminated':''} ${p.status==='Withdrawn'?'withdrawn':''}"><span class="tile-number">${esc(String(p.number).padStart(2,'0'))}</span><span class="tile-name">${esc(p.name)}</span>${dead?'<span class="name-cross" aria-hidden="true"><i></i><i></i></span>':''}<span class="sr-only">${dead?esc(p.status):p.status==='Withdrawn'?'Withdrawn':'Active'}</span></div>`;
 }).join('')}</div></article>`).join('');
}
async function refresh(){
 if(busy)return;busy=true;
 try{
  if(!/^[\da-f-]{36}$/i.test(token))throw new Error('Open the projector from the organiser dashboard.');
  const response=await fetch(supabaseConfig.url+'/rest/v1/rpc/tno_board',{method:'POST',headers:{apikey:supabaseConfig.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Projector unavailable. Check the connection and current board link.');
  current=boardSnapshot(await response.json());
  if(!joinUrl){const url=new URL('./index.html',location.href);if(current.practice)url.searchParams.set('practice',current.id);joinUrl=url.href;qr=await QRCode.toDataURL(joinUrl,{width:240,margin:2,errorCorrectionLevel:'M',color:{dark:'#111410',light:'#fff9e9'}});}
  deaths.update(current.players);draw();showNext();
  const status=document.getElementById('board-connection');if(status)status.hidden=true;
 }catch(error){
  const status=document.getElementById('board-connection');
  if(status){status.hidden=false;status.textContent='Connection lost. The roster may be out of date.';}
  else screen.innerHTML=`<div class="board-empty"><h1>Trust No One</h1><p role="alert">${esc(error.message)}</p></div>`;
 }finally{busy=false;}
}
refresh();setInterval(refresh,2000);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
