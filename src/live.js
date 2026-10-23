import {createClient} from '@supabase/supabase-js';
import {supabaseConfig} from '../dist/supabase-config.js';
import {MISSIONS} from '../dist/engine.js';

const client=createClient(supabaseConfig.url,supabaseConfig.publishableKey,{
 global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})},
});
const app=document.getElementById('app');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session=null, lobby=null, game=null, selected=null, busy=false, notice='', lastSync=0;
let showRole=false;
const button=(cmd,label,args={})=>`<button class="gold" data-cmd="${esc(cmd)}" data-args="${esc(JSON.stringify(args))}">${esc(label)}</button>`;
const input=(name,label,type='text',extra='')=>`<label class="field">${label}<input name="${name}" type="${type}" required ${extra}></label>`;
const form=(cmd,body,label)=>`<form data-form="${cmd}" class="stack">${body}<button class="gold" type="submit">${label}</button></form>`;
const panel=(title,body)=>`<section class="panel"><div class="panel-head"><h2>${title}</h2></div><div class="panel-body">${body}</div></section>`;
const options=items=>items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
const playerName=id=>game.players.find(p=>p.id===id)?.name||'No banishment';
const groupName=id=>game.groups.find(g=>g.id===id)?.name||'';
function authPage(){
 const name=input('name','Name or callsign','text','maxlength="30" autocomplete="username"');
 const pin=input('pin','Four-digit PIN','password','inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="current-password"');
 return `<div class="card-grid">${panel('Sign in',form('login',name+pin,'Sign in'))}${panel('Create an account',form('signup',name+pin+input('repeat','Repeat PIN','password','inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password"'),'Create account'))}</div><p>Forgot your PIN? Ask the organiser to reset it.</p>`;
}
function lobbyPage(){return `<h2>Your games</h2><div class="btns">${(lobby?.games||[]).map(g=>button('select',g.title+(g.host?' · Host':''),{id:g.id})).join('')||'<p>You haven’t joined a game yet.</p>'}</div><div class="card-grid section-gap">${panel('Join a game',form('join',input('code','Game code','text','maxlength="12" autocomplete="off"')+input('name','Your callsign','text','maxlength="30"'),'Join game'))}${lobby?.can_host?panel('Create a game',form('create',input('title','Game name','text','maxlength="80" value="Trust No One"')+input('groups','Number of groups','number','min="1" max="5" value="5"')+input('capacity','Maximum players','number','min="2" max="100" value="50"')+input('traitors','Traitors per group','number','min="1" max="5" value="2"'),'Create game')):'<p>Hosting is available to accounts approved by the organiser.</p>'}</div>`;}
function gamePage(){
 const me=game.me, active=me?.status==='Active';
 const eligible=game.players.filter(p=>p.group===me?.group&&p.id!==me?.id&&p.status==='Active');
 let body=`<div class="page-heading"><h2>${esc(game.title)}</h2>${button('back','Your games')}</div><div class="notice">${esc(game.stage)}${game.ended?' · Game ended':''}${game.host?' · Joining code: '+esc(game.code):' · '+esc(groupName(me.group))}</div>`;
 if(game.announcement)body+=panel('Announcement',`<p>${esc(game.announcement)}</p>`);
 if(me){body+=panel('Your envelope',`<p>${esc(me.status)}</p>${button('show-role',showRole?'Hide role':'Open your role')} ${showRole?`<h2>${esc(me.role||'Waiting for the host to assign roles')}</h2>`:''}${me.role==='Traitor'&&active&&game.objective?`<p>${esc(game.objective)}</p>`:''}`);
 if(active&&!game.ended&&game.ballot_open)body+=panel('Your vote',form('vote',`<label class="field">Vote for<select name="target" required>${options(eligible)}</select></label>`,'Save vote')+(me.vote?`<p>Saved vote: ${esc(playerName(me.vote))}. You can change it until voting closes.</p>`:''));
 if(active&&!game.ended&&game.stage==='Night'&&me.role==='Traitor')body+=panel('Choose a target',form('propose',`<label class="field">Target<select name="target" required>${options(eligible.filter(p=>p.role!=='Traitor'))}</select></label>`,'Send choice')+(me.proposal?`<p>Your choice: ${esc(playerName(me.proposal))}. Awaiting host confirmation.</p>`:''));
 }
 body+=`<div class="card-grid section-gap">${game.groups.map(g=>panel(esc(g.name),`<p>${g.score} mission points${g.winner?' · '+esc(g.winner)+' win':''}</p><div class="stack">${game.players.filter(p=>p.group===g.id).map(p=>`<div class="live-player ${p.status==='Active'?'':'out'}"><span>${esc(p.name)}</span><span>${esc(p.status)}${p.role?' · '+esc(p.role):''}</span></div>`).join('')}</div>`)).join('')}</div>`;
 if(game.host)body+=`<p><a href="projector.html#${esc(game.display_token)}" target="_blank" rel="noopener">Open player board</a> · Anyone with that board link can see names and published results.</p>`;
 if(game.host&&!game.ended){body+=panel('Host controls',`<div class="btns">${game.stage==='Joining'?button('assign','Close joining and assign roles'):['Mission','Round table','Night'].filter(s=>s!==game.stage).map(s=>button('stage','Move to '+s,{stage:s})).join('')}${game.stage==='Round table'?button(game.ballot_open?'close_vote':'open_vote',game.ballot_open?'Close voting':'Open voting'):''}${button('finish','End game and reveal winners')}</div>`);
 body+=`<div class="card-grid section-gap">${panel('Mission points',form('score',`<label class="field">Group<select name="group">${options(game.groups)}</select></label>`+input('delta','Points to add or subtract','number','min="-1000" max="1000"')+input('reason','Reason','text','maxlength="200"'),'Save points'))}${panel('Public announcement',form('announce','<label class="field">Message<textarea name="text" maxlength="1000"></textarea></label>','Publish announcement'))}${panel('Private Traitor objective',form('objective','<label class="field">Objective for all active Traitors<textarea name="text" maxlength="1000"></textarea></label>','Send objective'))}</div>`;
 if(game.stage==='Night')body+=panel('Private target choices',game.proposals.map(p=>`<p>${esc(playerName(p.actor))} chose ${esc(playerName(p.target))} ${button('confirm_murder','Confirm outcome privately',{target:p.target})}</p>`).join('')||'<p>No choices submitted yet.</p>');
 if(game.tally?.length)body+=panel('Closed ballot tally',game.tally.map(t=>`<p>${esc(playerName(t.target))}: ${t.votes} vote(s) ${button('resolve_tie','Use if tied',{target:t.target})}</p>`).join(''));
 }
 if(game.outcomes.length)body+=panel('Outcomes',game.outcomes.map(o=>`<p>${esc(groupName(o.group))} · ${esc(o.kind)} · ${esc(playerName(o.target))} ${!o.published?'(held privately)':''} ${game.host&&!o.published?button('publish',o.target?'Publish name':'Publish no banishment',{outcome:o.id}):''} ${game.host&&o.published&&o.target&&o.kind==='Banished'&&!o.reveal_role?button('reveal','Reveal role',{outcome:o.id}):''}</p>`).join(''));
 body+=panel('Physical missions',MISSIONS.map(m=>`<h3>${esc(m.title)}</h3><p>${esc(m.instructions)}</p>`).join(''));
 if(game.host)body+=panel('Event log',game.audit.map(a=>`<p>${esc(new Date(a.created_at).toLocaleTimeString())} · ${esc(a.action)} · ${esc(JSON.stringify(a.details))}</p>`).join('')||'<p>No actions yet.</p>');
 return body;
}
function render(){
 const focused=document.activeElement; const field=focused?.name; const frm=focused?.closest('form')?.dataset.form;
 // Polls never redraw while a form is being edited.
 app.innerHTML=`<header class="welcome-nav"><h1>Trust No One</h1><div class="btns">${lobby?button('logout','Sign out'):''}</div></header><main class="workspace live-workspace"><p id="connection" role="status">${busy?'Saving…':!lobby?'Sign in with your name and PIN to get started.':lastSync?'Last synced '+new Date(lastSync).toLocaleTimeString():'Connecting…'}</p><p id="notice" role="alert">${esc(notice)}</p>${!lobby?authPage():game?gamePage():lobbyPage()}</main>`;
 document.querySelectorAll('button').forEach(b=>b.disabled=busy);
 if(field&&frm)document.querySelector(`form[data-form="${frm}"] [name="${field}"]`)?.focus();
}
async function rpc(name,args){const {data,error}=await client.rpc(name,args);if(error)throw new Error(error.code==='PGRST202'?'The connected database upgrade is missing. Ask the host to run 002-connected.sql.':error.message);return data;}
async function refresh(redraw=true){
 const data=await rpc('tno_snapshot',{eid:selected});
 if(selected)game=data;else{lobby=data;game=null;}lastSync=Date.now();
 if(redraw)render();
}
const confirms={assign:'Close joining and assign private roles? This cannot be repeated.',finish:'End this game and make every role public?',publish:'Publish this outcome to everyone?',reveal:'Reveal this player’s role to everyone?',close_vote:'Close voting? Unsubmitted votes will not count.',confirm_murder:'Confirm this target privately? Check physical completion first.'};
async function perform(cmd,args={}){
 if(busy)return;
 if(confirms[cmd]&&!window.confirm(confirms[cmd]))return;
 busy=true;notice='';document.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{
  if(cmd==='login'||cmd==='signup'){
   if(cmd==='signup'&&args.pin!==args.repeat)throw new Error('The PINs do not match.');
   if(!session){const {data,error}=await client.auth.signInAnonymously();if(error)throw new Error('Could not start a session. Check Anonymous Sign-Ins is enabled in Supabase. '+error.message);session=data.session;}
   const result=await rpc('tno_login',{display_name:args.name,pin:args.pin,register:cmd==='signup'});
   if(result.error)throw new Error(result.error);
   selected=null;game=null;showRole=false;await refresh(false);
  }else if(cmd==='logout'){await rpc('tno_logout',{});const {error}=await client.auth.signOut();if(error)throw error;session=null;game=null;lobby=null;selected=null;showRole=false;
  }else if(cmd==='select'){selected=args.id;showRole=false;await refresh(false);
  }else if(cmd==='back'){selected=null;game=null;showRole=false;await refresh(false);
  }else if(cmd==='show-role'){showRole=!showRole;
  }else{
   const data=await rpc('tno_command',{cmd,eid:selected,args});selected=data.id;await refresh(false);notice='Saved to the game.';
  }
 }catch(e){notice=e.message||'Could not save. Check your connection and try again.';}
 finally{busy=false;render();}
}
document.addEventListener('submit',e=>{if(!e.target.dataset.form)return;e.preventDefault();perform(e.target.dataset.form,Object.fromEntries(new FormData(e.target)));});
document.addEventListener('click',e=>{const b=e.target.closest('[data-cmd]');if(b)perform(b.dataset.cmd,JSON.parse(b.dataset.args));});
client.auth.onAuthStateChange((event,s)=>{session=s;if(event==='SIGNED_OUT'){selected=null;game=null;lobby=null;showRole=false;render();}});
try{const {data,error}=await client.auth.getSession();if(error)throw error;session=data.session;if(session)await refresh(false);}catch(e){if(!e.message.includes('Sign in first'))notice=e.message;}render();
setInterval(async()=>{
 if(!session||!lobby||busy||document.hidden)return;
 try{await refresh(!document.activeElement?.closest('form'));const status=document.getElementById('connection');if(status)status.textContent='Last synced '+new Date(lastSync).toLocaleTimeString();}
 catch(e){if(e.message.includes('Sign in first')){game=null;lobby=null;selected=null;showRole=false;notice='Your session expired. Sign in again.';render();}else{const status=document.getElementById('connection');if(status)status.textContent='Connection lost. Displayed data may be outdated. '+e.message;}}
},5000);
