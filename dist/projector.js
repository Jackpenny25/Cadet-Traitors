import {supabaseConfig} from './supabase-config.js';
const screen=document.getElementById('screen');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=location.hash.slice(1);
let busy=false;
async function refresh(){
 if(busy)return;busy=true;
 try{
  if(!/^[\da-f-]{36}$/i.test(token))throw new Error('Open the player board using the link in your host controls.');
  const response=await fetch(supabaseConfig.url+'/rest/v1/rpc/tno_board',{method:'POST',headers:{apikey:supabaseConfig.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Player board unavailable. Check your connection and board link.');
  const s=await response.json();
  screen.innerHTML='<header class="board-header"><h1>'+esc(s.title)+'</h1><h2>'+esc(s.stage)+'</h2></header><p role="status">Updated '+new Date().toLocaleTimeString()+'</p><section class="name-board" style="--group-count:'+s.groups.length+'">'+s.groups.map(g=>'<section class="board-group"><header><h2>'+esc(g.name)+'</h2><span>'+g.score+' points</span></header><div class="board-names">'+s.players.filter(p=>p.group===g.id).map(p=>'<article class="name-tile '+(p.status==='Active'?'':'eliminated')+'"><span class="tile-name">'+esc(p.name)+'</span>'+(p.status==='Active'?'':'<span class="name-cross" aria-hidden="true"><i></i><i></i></span>')+'<span class="tile-status">'+esc(p.status)+'</span>'+(p.role?'<span class="tile-role">'+esc(p.role)+'</span>':'')+'</article>').join('')+'</div></section>').join('')+'</section><p class="board-announcement">'+esc(s.announcement)+'</p>';
 }catch(e){screen.innerHTML='<div class="board-empty"><h1>Player board</h1><p role="alert">'+esc(e.message)+'</p></div>';}
 finally{busy=false;}
}
refresh();setInterval(refresh,5000);
