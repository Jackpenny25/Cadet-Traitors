import {client,rpc,supabaseConfig,download} from './event-api.js';
import {TurnstileGate,createProtectedSession} from './bot-protection.js';
import {esc,btn,field,text,check,select,form,panel,clock,timeLeft,lateAdvice} from './event-ui.js';
import {lobbySnapshot,eventSnapshot} from './event-contract.js';
import {flightNames,crest,roleEnvelope,sortSchedule} from './event-theatre.js';
import {hauntedProps} from './haunted-art.js';
import {commandHelp,missionHelp,taskHelp} from './event-help.js';
import {installControlNotes} from './control-notes.js';
import {roleReadiness} from './event-readiness.js';
import {cadetSummary,cadetMission,controlIsCurrent,currentTask,eventUpdates,groupsNeedDifferentSteps} from './event-presentation.js';
import {installNotifications} from './event-notifications.js';
import {actionableError} from './event-errors.js';
import {controlAvailability,nextLabels} from './event-controls.js';
import {missionPlanReview,missionCards,privateMissionPack} from './mission-review.js';
import {captureFormDrafts,restoreFormDrafts} from './form-drafts.js';
import {confirmAction} from './event-confirmation.js';

const app=document.getElementById('app');
const controlNotes=installControlNotes();
const notifications=installNotifications();
let session=null,lobby=null,event=null,eid=null,page='overview',target='',busy=false,confirming=false,notice='',epoch=0,pending=null;
let synced=0,serverOffset=0,roleOpen=false,holdTimer=null,sound=false,previousExpired=new Set(),draft=null,wizardStep=0;
let renderedFingerprint='',interactionAt=0;
let timetableDraft=null,timetableRevision=null;
let timetableRenderedRows=[],timetableRenderedRevision=null;
let rolePreview=null,noticeError=false;
let privatePlanDraft=null;
const fingerprint=()=>JSON.stringify(event||lobby,(key,value)=>key==='server_now'?undefined:key==='seen_at'?(page==='players'&&value?Math.floor(Date.parse(value)/20000):undefined):value);
const practiceId=new URLSearchParams(location.search).get('practice');
const gate=new TurnstileGate({siteKey:supabaseConfig.turnstileSiteKey,onChange:()=>document.querySelectorAll('.auth-form button').forEach(b=>b.disabled=busy||(!session&&supabaseConfig.turnstileEnabled&&!gate.token))});
const groupBy=id=>event?.groups.find(g=>g.id===id);
const playerBy=id=>event?.players.find(p=>p.id===id);
const numberName=p=>p?`${String(p.number).padStart(2,'0')} · ${p.name}`:'No elimination';
const groupLabel=id=>groupBy(id)?.name||'';
function controls(cmd,label,args={},permitted=true){
 const payload={...(target?{group:target}:{}),
  expected_ballots:Object.fromEntries((event?.groups||[]).map(g=>[g.id,g.ballot?.id||null])),
  expected_opportunities:Object.fromEntries((event?.groups||[]).map(g=>[g.id,event?.windows.find(w=>w.group_id===g.id&&w.status==='open')?.id||null])),
  expected_reveals:(event?.reveals||[]).filter(r=>!r.published).map(r=>r.id),...args};
 const availability=controlAvailability(event,cmd,payload);const note=[!permitted?(page==='timetable'&&timetableDraft?'Save your timetable edits before using this control.':'This control needs the main host or the appropriate NCO permission.'):'',!availability.allowed?availability.reason:'',controlHelp(cmd,args)].filter(Boolean).join(' ');
 return btn(cmd,label,payload,`${permitted&&availability.allowed?'':'disabled'} ${event?.groups.filter(g=>!payload.group||g.id===payload.group).some(g=>controlIsCurrent(g,cmd,args))?'data-current-stage':''}`,note);
}
function groupGuidance(){
 const groups=event.groups.filter(g=>!target||g.id===target);
 const different=groupsNeedDifferentSteps(groups);
 return `<section class="group-guidance"><h3>${different?'Groups need different next steps':'Next steps for your groups'}</h3>${different?'<p>Results and empty ballots can leave groups at different stages. An all-groups action checks every group first. Already completed steps are kept; blocked groups must be resolved before the action runs.</p>':''}<div class="next-step-grid">${groups.map(g=>{
 const step=g.next_step;if(!step)return '';const args={group:g.id,...step.next_args};
 const label=step.next==='mission'?'Begin '+(event.missions.find(m=>m.idx===Number(args.mission))?.title||'mission'):step.next==='discussion'?'Start round table '+(args.round||g.mission+1):nextLabels[step.next];
 return `<article><h4>${esc(g.name)}</h4><p class="tiny muted">${esc(g.phase)} &middot; ${g.banishments} round tables completed</p><p>${esc(step.reason)}</p>${step.next&&label?controls(step.next,label,args,step.next==='page'||can(step.next)):''}</article>`;
 }).join('')}</div></section>`;
}
function controlHelp(cmd,args={}){return cmd==='start_task'?taskHelp(event?.timetable.find(r=>r.id===args.row),event?.missions):cmd==='mission'?missionHelp(event?.missions.find(m=>m.idx===Number(args.mission))):commandHelp(cmd,args);}
const can=cmd=>event?.host||event?.nco_permissions?.includes(['pause','resume','extend'].includes(cmd)?'timer':cmd);
const empty=p=>`<p class="muted">${esc(p)}</p>`;
function authScreen(){
 const name=field('name','Name or callsign','text','','required maxlength="30" autocomplete="username"');
 const pin=field('pin','Four-digit PIN','password','','required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password"');
 return `<section class="intro"><p class="eyebrow">2427 · Biggin Hill</p><h2>Loyalty has a<br>shadow.</h2><p>Sign in, join your group and keep your envelope private.</p></section><div class="card-grid">${panel('Sign in',form('login',name+pin,'Sign in'),'auth-form')}${panel('First time here?',form('signup',name+pin+field('repeat','Repeat PIN','password','','required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password"'),'Create account'),'auth-form')}</div><p class="tiny muted">Forgot your PIN? Ask an organiser to reset it. No email address is needed.</p>`;
}
function lobbyScreen(){
 const live=lobby.live;
 let view=`<section class="intro"><p class="eyebrow">Welcome, ${esc(lobby.name)}</p><h2>${esc(live?.title||'Trust No One')}</h2>`;
 if(live)view+=`<p>${live.ended?'The event has finished.':live.joining?'Your group is waiting. Join when your NCO asks you to.':'Joining is closed. Please wait for the organiser.'}</p><div class="btns">${live.organiser?btn('select','Open organiser dashboard',{id:live.id}):live.joined?btn('select','Open my dashboard',{id:live.id}):live.joining?btn('join','Join the event'):''}</div>`;
 else view+=empty('The organiser is setting up the event. This page will update automatically.');
 view+='</section>';
 if(practiceId&&/^[\da-f-]{36}$/i.test(practiceId))view+=panel('Separate NCO rehearsal',`<p>This link joins practice, not the live event.</p>${btn('join','Join rehearsal',{practice_event:practiceId})}`);
 if(!practiceId&&lobby.rehearsals?.length)view+=panel('Rehearsals',lobby.rehearsals.map(r=>`<div class="managed-event"><h3>${esc(r.title)}</h3>${r.joined?btn('select','Open my rehearsal',{id:r.id}):btn('join','Join rehearsal',{practice_event:r.id})}</div>`).join(''));
 if(lobby.can_host){view+=`<div class="card-grid">${!live?panel('Create the live event',createForm(false)):''}${panel('Separate rehearsal',createForm(true))}</div>`;}
 if(lobby.events?.length)view+=panel('Your events',lobby.events.map(e=>`<div class="managed-event"><div><h3>${esc(e.title)}</h3><p class="tiny muted">${e.practice?'Separate rehearsal':'Live event'}</p></div><div class="btns">${btn('select','Open dashboard',{id:e.id})}${e.host?btn('select','Manage event',{id:e.id,page:'admin'}):''}</div></div>`).join(''));
 return view;
}
function createForm(practice){return form('create',field('title','Event name','text',practice?'NCO rehearsal':'2427: Trust No One','required maxlength="80"')+field('date','Event date','date','','required')+field('groups','Number of groups','number',4,'readonly')+field('size','Players per group','number',13,'required min="2" max="25"')+field('traitors','Traitors per group','number',2,'required min="1" max="5"'),practice?'Create rehearsal':'Create live event',{practice});}
function groupCard(g){
 const mission=event.missions.find(m=>m.idx===g.mission);
 return panel(g.name,`<div class="group-summary"><span class="pill">${esc(g.phase)}</span><span class="clock" data-clock="${g.id}">${clock(timeLeft(g,Date.now()+serverOffset))}</span></div><p>${g.active} active · ${g.score} mission points</p>${event.organiser?`<p>${g.votes_received??0}/${g.eligible??g.active} votes received${g.done?' · Deduction complete':''}</p>`:''}<p>${g.phase==='Mission'?esc(mission?.title):g.planning?'Check your device. Quiet planning time for everyone.':g.paused?'Timer paused.':'Follow your NCO’s instructions.'}</p>${g.winner?`<h3>${esc(g.winner)} win</h3>`:''}`);
}
function overview(){
 let body=event.organiser?`<div class="card-grid">${event.groups.map(groupCard).join('')}</div>`:cadetSummary(event,Date.now()+serverOffset);
 if(event.announcement)body=panel('Announcement',`<p>${esc(event.announcement)}</p>`)+body;
 if(event.host&&!event.practice&&!event.is_live)body+=panel('Live event selection',`<p>This event is preserved but is not the single live event.</p>${btn('set_live','Use this as the live event')}`);
 if(event.organiser){
  body+=panel('Live controls',select('control-group','Control groups',[...(event.host?[{id:'',name:'All groups'}]:[]),...event.groups],target,'id="control-group"')+
   `${groupGuidance()}<div class="control-grid">${event.missions.map(m=>controls('mission','Start '+m.title,{mission:m.idx},can('mission'))).join('')}${controls('discussion','Start discussion',{},can('discussion'))}${controls('open_vote','Open voting',{},can('open_vote'))}${controls('close_vote','Close voting',{},can('close_vote'))}${controls('runoff','Start tied runoff',{},can('runoff'))}${controls('random_draw','Draw after tied runoff',{},event.host)}${controls('skip_ballot','Skip empty ballot',{},event.host)}${controls('reopen_ballot','Reopen empty ballot',{},event.host)}${controls('planning','Open private planning',{},can('planning'))}${controls('open_murder','Open first murder',{slot:0},can('open_murder'))}${controls('open_murder','Open second murder',{slot:1},can('open_murder'))}${controls('lock_murder','Lock first murder choices',{},can('lock_murder'))}${controls('pause','Pause',{},can('pause'))}${controls('resume','Resume',{},can('resume'))}${controls('extend','Add one minute',{seconds:60},can('extend'))}${controls('finale','Start finale',{},event.host)}</div><p class="tiny muted">Choose one group if groups are at different stages. The server checks every transition. An expired timer never reveals a result automatically.</p>`);
  if(event.host){body+=mainHostPanel();if(event.practice)body+=rehearsalTools();}
  const reveals=event.reveals.filter(r=>!r.published||r.kind==='Banished'&&!r.role_revealed);
  body+=panel('Pending public reveals',reveals.length?reveals.map(r=>`<div class="action-row"><p>${esc(groupLabel(r.group_id))} · ${esc(r.kind)} · ${esc(numberName(playerBy(r.target)))}</p>${!r.published?btn('publish','Reveal outcome',{group:r.group_id,reveal:r.id},can('publish')?'':'disabled'):btn('reveal_role','Reveal role',{group:r.group_id,reveal:r.id},can('reveal_role')?'':'disabled')}</div>`).join(''):empty('No outcomes waiting for publication.'));
  body+=murderControls();
  if(event.host){const open=event.windows.filter(w=>w.mode==='standard'&&w.status==='open');if(open.length)body+=panel('Manual murder decision',`<p>Use only when recording a decision taken off the website. A reason is required and the outcome stays private until publication.</p>${open.map(w=>form('lock_murder',`<h3>${esc(groupLabel(w.group_id))}</h3>`+select('target','Eligible target',event.players.filter(p=>p.group===w.group_id&&p.status==='Active'&&p.role==='Faithful').map(p=>({id:p.id,name:numberName(p)})))+field('reason','Why is a manual decision needed?','text','','required maxlength="200"'),'Record private decision',{group:w.group_id,opportunity:w.id})).join('')}`);}
  if(can('open_murder'))body+=panel('Designated murder decision maker',event.groups.map(g=>form('open_murder',`<h3>${esc(g.name)}</h3>`+select('slot','Opportunity',[{id:0,name:'First murder'},{id:1,name:'Second murder'}])+select('decider','Designated active Traitor',event.players.filter(p=>p.group===g.id&&p.status==='Active'&&p.role==='Traitor').map(p=>({id:p.id,name:numberName(p)}))),'Open this opportunity',{group:g.id})).join(''));
  if(can('objective'))body+=panel('Supervised private communication',event.groups.map(g=>`<details><summary>${esc(g.name)}</summary>${form('organiser_message',text('text','Instruction to active Traitors','',240),'Send privately',{group:g.id})}${event.messages.filter(m=>m.group_id===g.id).map(m=>`<p>${esc(m.sender)}: ${esc(m.body)}</p>`).join('')}</details>`).join(''));
  body+=panel('Running late?',`<p>${esc(lateAdvice(event.timetable,event.date))}</p>`);
 }else body+=playerActions();
 return body;
}
function mainHostPanel(){
 const ready=roleReadiness(event);
 const message=event.roles_released?'Private files have been released. Players can now hold the seal on their own dashboard.':ready.canRelease?'All four groups are ready. Release private envelopes to let players open their files.':ready.hasPrepared?'Roles are partly or fully prepared, but the release checks below are not yet complete. To reopen joining or change the distribution, reset unreleased roles in Administration first.':ready.canPrepare?'All groups have enough players. Prepare random roles, check them, then release the private envelopes.':'Waiting for players. Each group needs at least one more active player than its configured number of Traitors before roles can be prepared.';
 return panel('Main host',`${event.roles_released?'<p class="tiny muted">Reopening joining admits new players as Faithful to groups with space. Existing roles stay the same.</p>':''}<div class="role-readiness" role="status"><h3>${event.roles_released?'Envelopes released':ready.canRelease?'Ready to release':'Before you release the envelopes'}</h3><p>${esc(message)}</p>${!event.roles_released?`<div class="readiness-groups">${ready.groups.map(g=>`<div class="readiness-group ${g.ready?'is-ready':''}"><span>${esc(g.name)}</span><p>${g.active} active players · minimum ${g.required+1}</p><p>${g.assigned}/${g.total} roles assigned · ${g.traitors}/${g.required} Traitors</p>${g.needed?`<p>Needs ${g.needed} more active player${g.needed===1?'':'s'}.</p>`:''}</div>`).join('')}</div>`:''}</div><div class="btns">${btn('joining',event.joining?'Close joining':'Open joining',{open:!event.joining},ready.hasPrepared&&!event.roles_released?'disabled':'')}${btn('prepare_roles','Prepare random roles',{},ready.canPrepare?'':'disabled')}${btn('release_roles',event.roles_released?'Envelopes released':'Release private envelopes',{},ready.canRelease?'':'disabled')}${btn('finish','Reveal final results')}${btn('announce','Check your device',{text:'Check your device. The organiser has moved the evening on.'})}${btn('page','Manage this event',{page:'admin'})}</div>`+form('announce',text('text','Public announcement',event.announcement),'Publish'));
}
function rehearsalTools(){
 const ready=roleReadiness(event),locked=ready.hasPrepared||event.roles_released||event.ended;
 const tests=event.players.filter(p=>p.test_player);const fillTarget=Math.min(50,event.groups.reduce((n,g)=>n+g.capacity,0));const openBallot=event.groups.some(g=>g.ballot?.status==='open'&&!g.paused);
 return panel('Rehearsal test players',`<p>Practise on your own with test players in the four groups. They have no login or PIN. Real player accounts and the live event are kept separate.</p>${locked?`<p class="schedule-warning">${event.roles_released?'Roles are released, so the roster is locked. You can still preview test files and generate test votes during open ballots.':'Reset unreleased roles before adding test players. Your existing players stay in their groups.'}</p>`:''}<div class="btns">${btn('add_test_players','Fill groups for a role test',{minimum:true},locked||ready.groups.every(g=>g.needed===0)?'disabled':'')}${btn('add_test_players','Fill rehearsal to '+fillTarget+' players',{target_total:fillTarget},locked||event.players.length>=fillTarget?'disabled':'')}${!event.roles_released&&ready.hasPrepared?btn('reset_roles','Reset unreleased roles',{confirm:'RESET UNRELEASED ROLES'}):''}${controls('test_votes','Generate test votes',{},tests.length>0&&openBallot&&!event.ended)}</div>${!locked?`<details><summary>Add a specific number or one named test player</summary>${form('add_test_players',field('count','Number of test players','number',1,'required min="1" max="100"')+field('name','Name for a single test player (optional)','text','','maxlength="30"'),'Add test players')}</details>`:''}<p>${tests.length} test players · ${event.players.length-tests.length} real players. Prepare and release roles using Main host, then open Players to preview each test file. For voting, start discussion, open voting, generate test votes, close voting and reveal the outcome.</p>`,'rehearsal-panel');
}
function administrationScreen(){
 if(!event.host)return empty('Only the main host can administer this event.');
 return panel('Event administration',`<div class="admin-event-summary"><p class="eyebrow">${event.practice?'Separate rehearsal':'Live event'}</p><h3>${esc(event.title)}</h3><p>${event.players.length} players · ${event.groups.length} groups · ${event.roles_released?'Roles released':'Roles unreleased'}</p></div><div class="admin-control-grid">${panel('Player access',`<p>Control joining and open the roster for callsigns, withdrawals and PIN recovery.</p><div class="btns">${btn('joining',event.joining?'Close joining':'Open joining',{open:!event.joining},roleReadiness(event).hasPrepared&&!event.roles_released?'disabled':'')}${btn('page','Manage players',{page:'players'})}${btn('page','NCO access and setup',{page:'setup'})}</div>`)}${panel('Recovery and projector',`<p>Keep a private recovery record and replace a projector link if it has been shared accidentally.</p><div class="btns">${btn('export','Download private recovery record')}${btn('rotate_board','Replace projector link')}${btn('slips','Print player slips')}</div>`)}${panel('Unreleased role preparation',`<p>Reset only if you need to undo prepared roles before release. This keeps accounts, players and groups.</p>${btn('reset_roles','Reset unreleased roles',{confirm:'RESET UNRELEASED ROLES'},event.roles_released?'disabled':'')}`)}</div>`)+(event.practice?rehearsalTools():'')+panel(event.practice?'Delete this rehearsal':'Delete this event',`<p>Delete “${esc(event.title)}” and all of its game records permanently. Registered accounts and other events are kept. Download a recovery record first if you want a copy.</p>${form('delete_event',field('confirm','Type the exact event title to confirm','text','','required maxlength="80" autocomplete="off"')+`<p class="tiny muted">Exact title: ${esc(event.title)}</p>`,event.practice?'Permanently delete rehearsal':'Permanently delete event')}<p id="delete-feedback" class="admin-feedback" role="status"></p>`,'danger-panel')+panel('Other events',`<div class="managed-events">${lobby.events.filter(e=>e.host&&e.id!==event.id).map(e=>`<div class="managed-event"><div><h3>${esc(e.title)}</h3><p class="tiny muted">${e.practice?'Separate rehearsal':'Live event'}</p></div>${btn('select','Manage event',{id:e.id,page:'admin'})}</div>`).join('')||empty('No other host events.')}</div>`);
}
function playerActions(){
 const me=event.me;const g=groupBy(me.group);const active=me.status==='Active';
 let body=panel('Your classified file',`<p>${esc(me.name)} · ${esc(me.status)}</p>${roleEnvelope(me,event.roles_released,roleOpen)}<p class="tiny muted">Keep your screen private. Your file seals when you switch tabs.</p>`);
 if(!active)body+=panel('Still part of the team',`<p>Keep helping with physical missions and team points. Please stay out of accusations. Eliminated Traitors must keep their partners’ identities secret.</p>`);
 body+=cadetMission(event);
 if(active&&g.phase==='Voting'&&g.ballot?.status==='open'){
  const candidates=event.players.filter(p=>p.group===me.group&&p.status==='Active'&&p.id!==me.id&&(!g.ballot.candidates||g.ballot.candidates.includes(p.id))).map(p=>({id:p.id,name:numberName(p)}));
  body+=panel('Your vote',form('vote',select('target','Choose a player',candidates,me.vote),'Save vote',{ballot:g.ballot.id})+`<p>${me.vote?'Server receipt: your current vote is for '+esc(numberName(playerBy(me.vote)))+'.':'No vote submitted yet.'}</p><p class="tiny muted">You may change your vote until the ballot closes.</p>`);
 }
 if(active&&me.role==='Traitor'&&roleOpen){
  const partners=event.players.filter(p=>p.id!==me.id&&p.group===me.group&&p.status==='Active'&&p.role==='Traitor');
  body+=panel('Your private circle',`<p>${partners.length?'Active partners: '+partners.map(p=>esc(numberName(p))).join(', '):'No active partners remain.'}</p><p class="tiny muted">Authorised organisers can read this area and its messages.</p>`);
  for(const w of event.windows.filter(w=>w.group_id===me.group&&w.status==='open')){
   if(w.mode==='standard')body+=panel('Private target choice',form('propose',select('target','Choose an active Faithful',event.players.filter(p=>p.group===me.group&&p.status==='Active'&&p.role!=='Traitor').map(p=>({id:p.id,name:numberName(p)})),me.proposal),'Confirm my choice',{opportunity:w.id})+`<p>${me.proposal?'Saved choice: '+esc(numberName(playerBy(me.proposal))):'No choice submitted yet.'}</p>`);
   else body+=panel('Secret objective',`<p>${esc(w.objective||'Wait for your NCO’s private objective.')}</p><p>${w.target?'Target: '+esc(numberName(playerBy(w.target))):''}</p>${btn('report_objective',w.reported?'Reported to NCO':'Report completion',{opportunity:w.id})}<p>Only NCO verification can confirm an outcome.</p>`);
  }
  if(g.planning){body+=panel('Private messages',`<div class="btns">${['I agree.','Please suggest another target.','Check the objective.','Ready when you are.'].map(message=>btn('message',message,{text:message})).join('')}</div>${event.chat_enabled?form('message',text('text','Short message','',240),'Send message'):''}<div class="message-list">${event.messages.filter(m=>m.group_id===me.group).map(m=>`<p><span class="muted">${esc(m.sender)}:</span> ${esc(m.body)}</p>`).join('')}</div>`);}
 }
 if(me.shields.length)body+=panel('Your protection','<p>You have a shield for opportunity '+me.shields.map(s=>s+1).join(', ')+'. It does not protect against banishment.</p>');
 return body;
}
function murderControls(){
 return event.windows.map(w=>{
  const args={group:w.group_id,opportunity:w.id};
  return panel(`${groupLabel(w.group_id)} · Murder opportunity ${w.slot+1}`,`<p>${w.mode==='plain'?'Supervised objective':'Standard selection'} · ${esc(w.status)}${w.reason?' · '+esc(w.reason):''}</p><p>${w.target?'Private target: '+esc(numberName(playerBy(w.target))):'No target confirmed.'}</p>${w.mode==='plain'?`<p>${esc(w.objective)}</p><p>${w.reported?'Traitor reports completion; verify physically.':'No completion report yet.'}</p>${w.status==='open'?form('objective',select('target','Eligible target',event.players.filter(p=>p.group===w.group_id&&p.status==='Active'&&p.role==='Faithful').map(p=>({id:p.id,name:numberName(p)})),w.target)+text('text','Private physical objective',w.objective,500),'Assign objective',args,can('objective')?'':'disabled')+form('confirm_objective',check('success','Physical objective succeeded')+field('reason','Verification or rejection reason','text','','required maxlength="200"'),'Resolve privately',args,can('confirm_objective')?'':'disabled'):''}`:`${(w.proposals||[]).map(p=>`<p>${esc(numberName(playerBy(p.actor)))} chose ${esc(numberName(playerBy(p.target)))}</p>`).join('')}${w.status==='open'?btn('lock_murder','Lock decisions privately',args,can('lock_murder')?'':'disabled'):''}`}`);
 }).join('');
}
function playersScreen(){
 let body=panel('Roster',`<p>Connection is an estimate from recent requests. A stale phone is not automatically eliminated.</p><div class="roster">${event.players.map(p=>{
  const args={group:p.group,player:p.id};const recent=p.seen_at&&Date.now()+serverOffset-Date.parse(p.seen_at)<20000;
  return `<article class="roster-player"><h3>${esc(numberName(p))}</h3><p>${esc(groupLabel(p.group))} · ${esc(p.status)} · ${esc(p.role||'Not assigned')}</p><p class="tiny muted">${p.test_player?'Rehearsal test player. No login or PIN.':'Account: '+esc(p.account_name||p.name)}</p><p class="tiny muted">${recent?'Recently seen':p.seen_at?'Last seen '+esc(new Date(p.seen_at).toLocaleTimeString()):'No recent device request'}</p><details><summary>Player tools</summary>${event.host&&event.practice&&p.test_player?btn('preview_role','Preview role reveal',{player:p.id},event.roles_released?'':'disabled'):''}${event.host&&!event.roles_released?form('manual_role',select('role','Role',[{id:'Faithful',name:'Faithful'},{id:'Traitor',name:'Traitor'}],p.role,p.role?'disabled':''),'Save unreleased role',{player:p.id},p.role?'disabled':'')+(p.role?'<p class="tiny muted">This role is already prepared. To replace the distribution, open Administration, reset unreleased roles, then assign every player again before release.</p>':''):''}${event.host?form('callsign',field('name','Approved callsign','text',p.name,'required maxlength="30"')+field('reason','Reason','text','','required maxlength="200"'),'Save callsign',args)+form('withdraw',field('reason','Withdrawal reason','text','','required maxlength="200"'),'Withdraw player',args):''}${can('recover')&&!p.test_player?form('recover',field('pin','Replacement four-digit PIN','password','','required inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password"'),'Reset PIN and revoke old sessions',args):''}${event.shields_enabled&&can('shield')?form('shield',select('slot','Protect against opportunity',[{id:0,name:'First murder'},{id:1,name:'Second murder'}]),'Award shield',args):''}</details></article>`;
 }).join('')}</div>`);
 if(event.organiser){body+=panel('Manual vote entry',form('proxy_vote',select('group','Group',event.groups,target)+select('voter','Voter',event.players.filter(p=>p.status==='Active').map(p=>({id:p.id,name:numberName(p)})))+select('target','Vote target',event.players.filter(p=>p.status==='Active').map(p=>({id:p.id,name:numberName(p)})))+field('reason','Why is a manual vote needed?','text','','required maxlength="200"'),'Record manual vote',{expected_ballots:Object.fromEntries(event.groups.map(g=>[g.id,g.ballot?.id||null]))}));
 if(event.host)body+=panel('Late arrival approval',form('late_join',field('name','Registered account name','text','','required maxlength="30"')+select('group','Group',event.groups)+field('reason','Reason for admitting this late player','text','','required maxlength="200"'),'Approve late arrival')+'<p>A late player admitted after role release joins as Faithful. Existing players’ roles are preserved.</p>')+btn('slips','Print player slips');}
 return body;
}
function missionsScreen(){return missionPlanReview(event,privatePlanDraft?.event===event.id?privatePlanDraft.rows:null)+missionCards(event,target);}
function setupScreen(){
 if(!event.host)return empty('Only the main host can configure the event.');
 let body='';
 if(!event.players.length&&!event.roles_released){
  draft??={title:event.title,date:event.date,count:event.groups.length,groups:event.groups.map(g=>({name:g.name,size:g.capacity,traitors:g.traitors})),shields:event.shields_enabled,chat:event.chat_enabled,plain_slot:event.plain_slot};
  const step=wizardStep===0?field('title','Event name','text',draft.title,'required maxlength="80"')+field('date','Event date','date',draft.date,'required')+field('count','Number of groups','number',4,'readonly'):wizardStep===1?Array.from({length:Number(draft.count)},(_,i)=>`<fieldset><legend>Group ${i+1}</legend>${field('name_'+i,'Group name','text',draft.groups[i]?.name||flightNames[i],'required maxlength="30"')}${field('size_'+i,'Players','number',draft.groups[i]?.size||13,'required min="2" max="50"')}${field('traitors_'+i,'Traitors','number',draft.groups[i]?.traitors||2,'required min="1" max="5"')}</fieldset>`).join(''):check('shields','Enable shields for designated murder opportunities',draft.shields)+check('chat','Enable short free text in supervised private planning',draft.chat)+select('plain_slot','Supervised secret objective opportunity',[{id:1,name:'Second murder (default)'},{id:0,name:'First murder'},{id:-1,name:'Neither: two standard murders'}],draft.plain_slot)+'<p>Shields are visible only to their owner and authorised organisers. Ties use one runoff, then an explicit host random draw. Choose above which murder opportunity uses an NCO-supervised objective.</p>';
  body+=panel(`Setup · Step ${wizardStep+1} of 3`,form('wizard',step,wizardStep===2?'Save event setup':'Next')+(wizardStep?btn('wizard_back','Previous step'):''));
 }else body+=empty('Group sizes and role settings are locked once players join. Missions and timetable remain editable.');
 body+=panel('Assign group NCOs',form('assign_staff',field('name','Registered organiser account name','text','','required maxlength="30"')+event.groups.map(g=>check('group_'+g.id,g.name)).join(''),'Save assignments')+event.staff.map(s=>`<p>${esc(s.name)} · ${esc(groupLabel(s.group))}</p>`).join(''));
 const perms=['timer','score','proxy_vote','confirm_objective','recover','open_vote','close_vote','runoff','open_murder','lock_murder','planning','publish','reveal_role','mission','discussion','shield','objective'];
 body+=panel('Permitted NCO actions',form('permissions',perms.map(p=>check(p,p.replaceAll('_',' '),event.nco_permissions.includes(p))).join(''),'Save permissions'));
 body+=panel('Event administration',`<p>Open Administration for rehearsal test players, private recovery records, projector links, role resets and event deletion.</p>${btn('page','Open Administration',{page:'admin'})}`);
 return body;
}
function captureTimetable(){
 if(!event?.host)return;
 const f=document.querySelector('[data-form="timetable"]');if(!f)return;
 const values=Object.fromEntries(new FormData(f));timetableDraft??=timetableRenderedRows.map(r=>({...r}));timetableRevision??=timetableRenderedRevision;
 timetableDraft=timetableDraft.map((r,i)=>({...r,time:values['time_'+i],minutes:Number(values['minutes_'+i]),label:values['label_'+i]}));
}
function taskGroups(row){return event.groups.filter(g=>(!target||g.id===target)&&currentTask(g,event.timetable)===row.id);}
function canStartTask(row){return event.host?(row.action!=='release_roles'||roleReadiness(event).canRelease):['mission','discussion','open_murder'].includes(row.action)&&can(row.action);}
function taskMenu(row,dirty){
 const groups=event.groups.filter(g=>!target||g.id===target);
 const beginLabel={activity:'Begin '+row.label,release_roles:'Release private envelopes',mission:'Begin mission',discussion:'Start discussion',open_murder:'Open murder opportunity',finish:'Reveal final results'}[row.action];
 let items=controls('start_task',beginLabel,{row:row.id,revision:event.timetable_revision},!dirty&&canStartTask(row));
 const action=(cmd,label,args={},permitted=can(cmd))=>controls(cmd,label,args,!dirty&&permitted);
 if(row.action==='release_roles')items=action('joining',event.joining?'Close joining':'Open joining',{open:!event.joining},event.host&&(!roleReadiness(event).hasPrepared||event.roles_released))+action('prepare_roles','Prepare random roles',{},event.host&&roleReadiness(event).canPrepare)+items;
 if(row.action==='mission')items+=action('planning','Open private planning')+btn('page','Mission card and scoring',{page:'missions'});
 if(row.action==='discussion'){
  const round=Number(row.id.match(/^round([1-3])$/)?.[1])||undefined;
  items+=action('publish_ready','Reveal ready round-table outcomes',{kind:'ballot',round},can('publish'));
  items+=action('open_vote','Open voting',{round})+action('close_vote','Close voting',{round})+action('runoff','Start tied runoff',{round})+action('random_draw','Draw after tied runoff',{round},event.host)+action('reopen_ballot','Reopen empty ballot',{round},event.host)+action('skip_ballot','Skip empty ballot',{round},event.host);
  if(event.host&&event.practice)items+=action('test_votes','Generate test votes',{round},true);
 }
 if(row.action==='open_murder'||row.id==='break'||row.action==='mission'&&Number(row.mission)===1){
  const slot=row.action==='open_murder'?Number(row.slot):1;
  if(row.action!=='open_murder')items+=action('open_murder','Open second murder',{slot});
  items+=action('publish_ready','Reveal ready murder outcomes',{kind:'murder',slot},can('publish'));
  items+=action('lock_murder','Lock standard choices')+btn('page','Private objective and verification',{page:'overview'});
 }
 if(['discussion','open_murder'].includes(row.action)||row.id==='break'){
  for(const r of event.reveals.filter(r=>groups.some(g=>g.id===r.group_id)&&(row.action==='discussion'?r.ballot:r.opportunity)&&(!r.published||r.kind==='Banished'&&!r.role_revealed))){
   items+=btn(r.published?'reveal_role':'publish',(r.published?'Reveal role: ':'Reveal outcome: ')+groupLabel(r.group_id),{group:r.group_id,reveal:r.id},dirty||!can(r.published?'reveal_role':'publish')?'disabled':'');
  }
 }
 if(row.action==='finish')items=action('finale','Start finale',{},event.host)+items;

 return `<details class="task-menu" data-task-menu="${esc(row.id)}"><summary>Activity controls</summary><div class="task-menu-options"><p>${esc(row.label)}${dirty?' · Save your time changes before starting or changing a stage.':''}</p>${items}</div></details>`;
}
function timetableScreen(){
 const rows=timetableDraft||event.timetable;const dirty=Boolean(timetableDraft);const stale=dirty&&timetableRevision!==event.timetable_revision;
 timetableRenderedRows=rows.map(r=>({...r}));timetableRenderedRevision=timetableDraft?timetableRevision:event.timetable_revision;
 return panel('The running order',`<p>Open the activity controls for its mission, voting and reveal actions. Choose the groups above before using a control.</p>${event.organiser?select('control-group','Start activities for',[...(event.host?[{id:'',name:'All four groups'}]:[]),...event.groups],target,'id="control-group"'):''}${groupGuidance()}${event.host?`<p class="tiny muted">Change a target time to move an activity. Rows sort by time when you leave the field. Save to update this event only. Other events and future rehearsals keep their saved running orders.</p>${stale?'<p class="schedule-warning" role="alert">The saved order changed on another device. Reload before saving.</p>':''}${form('timetable',rows.map((r,i)=>`<div class="schedule-row ${taskGroups(r).length?'is-current-stage':''}"><span class="schedule-number">${String(i+1).padStart(2,'0')}</span><div class="schedule-edit">${field('time_'+i,'Target time','time',r.time,'required')}${field('minutes_'+i,'Minutes','number',r.minutes,'required min="1" max="60"')}${field('label_'+i,'Activity','text',r.label,'required maxlength="80"')}</div>${taskGroups(r).length?'<p class="stage-marker">Current: '+esc(taskGroups(r).map(g=>g.name).join(', '))+'</p>':''}<div class="schedule-actions">${taskMenu(r,dirty)}</div></div>`).join(''),'Save order for this event')}${dirty?`<p class="schedule-warning">${stale?'Reload the latest saved order.':'Save your changes before starting an activity.'}</p>${btn('schedule_reload','Discard edits and reload')}`:''}`:rows.map(r=>`<div class="schedule-row ${taskGroups(r).length?'is-current-stage':''}"><time>${esc(r.time)}</time><span>${esc(r.label)} &middot; ${r.minutes} min${taskGroups(r).length?'<small class="stage-marker">Current stage</small>':''}</span>${event.organiser?taskMenu(r,false):''}</div>`).join('')}`);
}
function slipsScreen(){return `<div class="btns">${btn('print','Print slips')}${btn('page','Back to roster',{page:'players'})}</div><section id="slips">${event.players.map(p=>`<article class="player-slip"><h2>Trust No One</h2><h3>Player ${esc(p.number)} · ${esc(p.name)}</h3><p>Group: ${esc(groupLabel(p.group))}</p><p>Scan the QR code on the projector, then sign in with your own name and four-digit PIN.</p><p>Keep your PIN and role private. Ask your NCO if you need access recovery.</p></article>`).join('')}</section>`;}
function logScreen(){return panel('Chronological organiser log',`<p>Newest actions first. Private decisions appear only to authorised organisers. Full technical records are retained in the private recovery export.</p>${event.audit.map(a=>{
 const d=a.details;const groups=(d.groups||[]).map(groupLabel).filter(Boolean).join(', ');
 const details=[groups,d.reason,d.text,d.name,d.points!==undefined?d.points+' points':'',d.target?'Target: '+numberName(playerBy(d.target)):'',d.player?'Player: '+numberName(playerBy(d.player)):''].filter(Boolean).join(' · ');
 return `<p><time>${esc(new Date(a.created_at).toLocaleString('en-GB',{timeZone:'Europe/London'}))}</time> · ${esc(a.actor||'Organiser')} · ${esc(a.action.replaceAll('_',' '))}<br><span class="tiny muted">${esc(details)}</span></p>`;
 }).join('')}`);}
function render(){
 const failedDrafts=noticeError?captureFormDrafts(app):null;
 const openMenus=[...document.querySelectorAll('.task-menu[open]')].map(el=>el.dataset.taskMenu);
 const focused=document.activeElement;const editing=focused?.closest('form');let editName=focused?.name;const editForm=editing?.dataset.form;
 const editParts=editForm==='timetable'?editName?.match(/^(time|minutes|label)_(\d+)$/):null;const editRow=editParts?timetableRenderedRows[Number(editParts[2])]?.id:null;
 gate.clear();
 controlNotes.hide();
 if(event&&!event.organiser)page='overview';
 const screen=!lobby?authScreen():!event?lobbyScreen():page==='players'?playersScreen():page==='missions'?missionsScreen():page==='admin'?administrationScreen():page==='setup'?setupScreen():page==='timetable'?timetableScreen():page==='slips'?slipsScreen():page==='log'?logScreen():overview();
 app.innerHTML=`<header class="event-header"><a class="event-brand" href="index.html">${crest}<span>Trust No One<small>2427 Biggin Hill Air Cadets</small></span></a><div class="btns">${event?.practice?'<span class="pill">Separate rehearsal</span>':''}${lobby?btn('logout','Sign out'):''}</div></header>${event?`<nav class="event-nav" aria-label="Event pages">${[['overview',event.organiser?'Control room':'My game'],...(event.organiser?[['players','Players'],['missions','Missions'],['timetable','Timetable']]:[]),...(event.host?[['admin','Administration'],['setup','Setup']]:[]),...(event.organiser?[['log','Event log']]:[])].map(([p,label])=>btn('page',label,{page:p},p===page?'aria-current="page"':'')).join('')}${event.host?`<a href="projector.html#${esc(event.display_token)}" target="_blank" rel="noopener">Projector ↗</a>`:''}${btn('back','Event home')}</nav>`:''}<main class="workspace event-workspace">${hauntedProps}<div class="connection-row ${event&&!event.organiser?'cadet-connection':''}"><p id="connection" role="status">${busy?'Saving to the event…':synced?'Synced '+new Date(synced).toLocaleTimeString():'Name and PIN only. No email needed.'}</p>${event?`<label class="check"><input id="sound-toggle" type="checkbox" ${sound?'checked':''}>Timer sound</label>`:''}</div><p class="sr-only ${noticeError?'form-error':'form-success'}" id="notice" role="${noticeError?'alert':'status'}" ${notice?'':'hidden'}>${esc(notice)}</p>${event?`<h1 class="event-title">${esc(event.title)}</h1>`:''}${screen}<footer class="event-footer"><span>2427 Biggin Hill Air Cadets &middot; Trust No One</span>${event?.practice?'<span>Rehearsal data is separate from the live event.</span>':''}</footer></main>`;
 app.querySelectorAll('button').forEach(b=>{if(busy)b.disabled=true;});
 if(!lobby&&!session&&supabaseConfig.turnstileEnabled){const box=document.createElement('section');box.innerHTML='<div class="turnstile-widget"></div><p role="status"></p>';document.querySelector('.card-grid').before(box);void gate.mount(box);}
 if(rolePreview&&event?.host&&event.practice&&event.roles_released){const p=event.players.find(p=>p.id===rolePreview&&p.test_player);if(p)app.insertAdjacentHTML('beforeend',roleEnvelope(p,true,'reveal',{preview:true}));}
 for(const menu of document.querySelectorAll('.task-menu'))menu.open=openMenus.includes(menu.dataset.taskMenu);
 if(failedDrafts)restoreFormDrafts(app,failedDrafts);
 if(editRow){const index=timetableRenderedRows.findIndex(r=>r.id===editRow);if(index>=0)editName=editParts[1]+'_'+index;}
 if(editName&&editForm)document.querySelector(`form[data-form="${editForm}"] [name="${editName}"]`)?.focus();
 renderedFingerprint=fingerprint();
}
async function sync(redraw=true){
 const token=epoch;const requested=eid;
 const value=await rpc('tno_snapshot',{eid:requested});
 if(token!==epoch||requested!==eid)return;
 if(requested)eventSnapshot(value);else lobbySnapshot(value);
 if(requested){if(!busy)for(const update of eventUpdates(event,value))notifications.show(update.title,update.message);if(event?.me?.status!==value.me?.status)roleOpen=false;event=value;serverOffset=Date.parse(value.server_now)-Date.now();if(target&&!value.groups.some(g=>g.id===target))target='';if(!value.host&&!target)target=value.groups[0]?.id||'';}
 else{if(!busy&&lobby&&((value.live?.joining&&!lobby.live?.joining)||(value.rehearsals||[]).some(r=>!(lobby.rehearsals||[]).some(old=>old.id===r.id))))notifications.show('Joining is open','You can now join from Event home.');lobby=value;event=null;}
 synced=Date.now();if(redraw&&roleOpen!=='reveal'&&!rolePreview&&fingerprint()!==renderedFingerprint&&Date.now()-interactionAt>1000)render();
}
const confirmation={publish_ready:'Reveal the ready outcomes for the selected groups? The displayed results become public.',release_roles:'Release every player’s private role? Roles cannot be reassigned after release.',prepare_roles:'Close joining and prepare roles once?',reset_roles:'Delete only the unreleased roles so they can be prepared again?',publish:'Publish this outcome? Everyone will see the player name. This disclosure cannot be undone.',reveal_role:'Reveal this banished player’s role publicly?',finish:'Release all roles and final winners publicly?',random_draw:'Run an explicit random draw between the tied runoff candidates?',close_vote:'Close voting? Missing votes become abstentions.',lock_murder:'Lock this opportunity and hold the outcome privately?',confirm_objective:'Confirm the physical verification or rejection? A report alone is not proof.',withdraw:'Withdraw this player and keep a logged record?',recover:'Replace this player’s PIN and revoke all their old application sessions?',rotate_board:'Replace the projector link? The old link will stop working.',export:'Download the PRIVATE recovery record, including hidden roles and pending outcomes?'};
async function perform(cmd,args={}){
 if(['logout','select','back'].includes(cmd))privatePlanDraft=null;
 if(busy||confirming)return;
 if(confirmation[cmd]){
  confirming=true;let accepted;
  try{accepted=await confirmAction(cmd,confirmation[cmd]);}finally{confirming=false;}
  if(!accepted)return;
 }
 if(cmd==='delete'){const typed=window.prompt('Type the event title to permanently delete its records. Export a private recovery record first.');if(typed!==event.title)return;args.confirm=typed;}
 busy=true;notice='';noticeError=false;app.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{
  if(cmd==='login'||cmd==='signup'){
   if(cmd==='signup'&&args.pin!==args.repeat)throw new Error('The PINs do not match.');
   if(!session)session=await createProtectedSession(client,gate,{enabled:supabaseConfig.turnstileEnabled});
   try{await rpc('tno_login',{display_name:args.name,pin:args.pin,register:cmd==='signup'});}catch(error){if(/session has expired/i.test(error.message)){await client.auth.signOut({scope:'local'});session=null;throw new Error('Your device session expired. Please sign in again.');}throw error;}epoch++;await sync(false);
   if(lobby.live&&(lobby.live.joined||lobby.live.organiser)&&!practiceId){eid=lobby.live.id;await sync(false);}
  }else if(cmd==='logout'){
   await rpc('tno_logout');epoch++;lobby=null;event=null;eid=null;roleOpen=false;rolePreview=null;pending=null;timetableDraft=null;timetableRevision=null;const {error}=await client.auth.signOut({scope:'local'});session=null;notice=error?'Signed out of the game. The authentication service could not confirm sign out; reload before signing in again.':'You have signed out.';
  }else if(cmd==='select'){eid=args.id;target='';page=args.page||'overview';roleOpen=false;rolePreview=null;draft=null;timetableDraft=null;timetableRevision=null;await sync(false);if(page==='admin')await loadHostEvents();
  }else if(cmd==='back'){eid=null;event=null;page='overview';roleOpen=false;rolePreview=null;draft=null;timetableDraft=null;timetableRevision=null;await sync(false);
  }else if(cmd==='page'){page=args.page;if(page==='admin')await loadHostEvents();
  }else if(cmd==='preview_role'){
   const p=event?.players.find(p=>p.id===args.player);if(!event?.host||!event.practice||!event.roles_released||!p?.test_player)throw new Error('Only released test files in your rehearsal can be previewed.');rolePreview=p.id;
  }else if(cmd==='close_preview'){rolePreview=null;
  }else if(cmd==='delete_event'){
   if(!event?.host)throw new Error('Only the main host can delete this event.');
   if(args.confirm!==event.title)throw new Error('Type the exact event title shown above to confirm deletion.');
   await submitCommand('delete',{confirm:args.confirm});page='overview';draft=null;timetableDraft=null;timetableRevision=null;notice='Event deleted. Accounts and other events are kept.';
  }else if(cmd==='private_dashboard'){roleOpen=true;
  }else if(cmd==='hide_role'){roleOpen=false;
  }else if(cmd==='wizard_back'){wizardStep=Math.max(0,wizardStep-1);
  }else if(cmd==='wizard'){
   if(wizardStep===0){Object.assign(draft,{title:args.title,date:args.date,count:Number(args.count)});wizardStep=1;}
   else if(wizardStep===1){draft.groups=Array.from({length:draft.count},(_,i)=>({name:args['name_'+i],size:Number(args['size_'+i]),traitors:Number(args['traitors_'+i])}));wizardStep=2;}
   else{await submitCommand('configure',{title:draft.title,date:draft.date,groups:draft.groups,chat:Boolean(args.chat),shields:Boolean(args.shields),plain_slot:Number(args.plain_slot)});draft=null;wizardStep=0;page='overview';}
  }else if(cmd==='slips'){page='slips';
  }else if(cmd==='print'){window.print();
  }else if(cmd==='export'){const data=await rpc('tno_export',{eid});download('PRIVATE-trust-no-one-recovery.json',data);notice='Private recovery record downloaded. Store it away from the projector.';
  }else if(cmd==='recover'){await rpc('tno_recover',{eid,pid:args.player,new_pin:args.pin});await sync(false);notice='PIN replaced. Previous sessions are revoked; the player keeps their number, group, role and votes.';
  }else if(cmd==='assign_staff'){const groups=Object.keys(args).filter(k=>k.startsWith('group_')&&args[k]).map(k=>k.slice(6));await submitCommand(cmd,{name:args.name,groups});
  }else if(cmd==='permissions'){await submitCommand(cmd,{permissions:Object.keys(args).filter(k=>args[k]===true)});
  }else if(cmd==='apply_mission_plan'){
   const private_material=privateMissionPack({private_material:[0,1,2].map(idx=>({idx,notes:args['notes_'+idx],answer:args['answer_'+idx],scoring:args['scoring_'+idx]}))});
   await submitCommand(cmd,{plan_id:args.plan_id,confirm:args.confirm,revision:args.revision,mission_revision:args.mission_revision,private_material});privatePlanDraft=null;timetableDraft=null;timetableRevision=null;notice='Mission plan saved to this event only. Other events and game progress are preserved.';
  }else if(cmd==='schedule_reload'){timetableDraft=null;timetableRevision=null;
  }else if(cmd==='timetable'){captureTimetable();await submitCommand(cmd,{rows:timetableDraft,revision:timetableRevision});timetableDraft=null;timetableRevision=null;
  }else if(cmd==='start_task'){
   const row=event.timetable.find(r=>r.id===args.row);
   if(!row)throw new Error('Reload the timetable.');
   if(confirmation[row.action]&&!await confirmAction(row.action,confirmation[row.action]))return;
   await submitCommand(cmd,args);
  }else if(cmd==='proxy_vote'){await submitCommand(cmd,{...args,ballot:args.expected_ballots?.[args.group]});
  }else if(cmd==='add_test_players'){await submitCommand(cmd,args);notice='Test players added to this rehearsal. Prepare roles when all groups are ready.';
  }else if(cmd==='test_votes'){await submitCommand(cmd,args);notice='Test votes saved. Votes from real players are unchanged. Close voting when ready.';
  }else if(cmd==='create'){await submitCommand(cmd,args);page='setup';draft=null;wizardStep=0;
  }else await submitCommand(cmd,args);
 }catch(error){noticeError=true;notice=actionableError(error,cmd,args,event);}
 finally{busy=false;render();if(cmd==='preview_role')document.getElementById('seal-role')?.focus();if(cmd==='delete_event'){const feedback=document.getElementById('delete-feedback');if(feedback)feedback.textContent=notice;}if(notice)notifications.show(noticeError?'Could not save':'Event updated',notice,noticeError);}
}
async function loadHostEvents(){const value=lobbySnapshot(await rpc('tno_snapshot',{eid:null}));lobby=value;}
async function submitCommand(cmd,args){
 const requestEvent=cmd==='join'?(args.practice_event||null):cmd==='create'?null:eid;
 const key=JSON.stringify([cmd,requestEvent,args]);if(pending?.key!==key)pending={key,id:crypto.randomUUID()};
 const result=await rpc('tno_command',{cmd,eid:requestEvent,args:{...args,request_id:pending.id}});
 eid=result.id;if(!eid){event=null;await sync(false);}else await sync(false);
 pending=null;notice=result.groups_advanced!==undefined?`${result.groups_advanced} group${result.groups_advanced===1?'':'s'} updated.${result.groups_unchanged?' '+result.groups_unchanged+' already completed or running; kept unchanged.':''}`:cmd==='start_task'?'Activity started.':cmd==='join'?'You have joined your team.':cmd==='mission'?'Mission started.':cmd==='joining'?(args.open?'Joining is open. Players can join from the website.':'Joining is closed.'):cmd==='vote'?'Your vote has been saved.':'Saved to the event.';
}
document.addEventListener('submit',e=>{const f=e.target;if(!f.dataset.form)return;e.preventDefault();const values=Object.fromEntries(new FormData(f));for(const input of f.querySelectorAll('input[type="checkbox"]'))values[input.name]=input.checked;perform(f.dataset.form,{...JSON.parse(f.dataset.args||'{}'),...values});});
document.addEventListener('click',e=>{const b=e.target.closest('[data-cmd]');if(b)perform(b.dataset.cmd,JSON.parse(b.dataset.args||'{}'));});
document.addEventListener('change',async e=>{
 if(e.target.id==='private-mission-pack'){
  try{const file=e.target.files[0];if(!file)return;if(file.size>250000)throw new Error('Private pack is too large.');privatePlanDraft={event:event.id,rows:privateMissionPack(JSON.parse(await file.text()))};render();}
  catch(error){notifications.show('Could not load pack',error.message,true);}return;
 }
 if(e.target.matches('[data-score-group]')){
  const f=e.target.closest('form'),idx=JSON.parse(f.dataset.args).mission;
  const saved=event.scores.find(s=>s.group_id===e.target.value&&s.mission===idx);
  f.elements.points.value=saved?.points??0;f.elements.completed.checked=Boolean(saved?.completed);f.elements.reason.value=saved?.reason||'';return;
 }
});
document.addEventListener('change',e=>{if(e.target.closest('[data-form="timetable"]')&&e.target.type==='time'){captureTimetable();timetableDraft=sortSchedule(timetableDraft);render();return;}if(e.target.id==='control-group'){target=e.target.value;render();}if(e.target.id==='sound-toggle')sound=e.target.checked;});
function beginHold(e){if(!e.target.closest('#role-hold')||!event?.roles_released)return;clearTimeout(holdTimer);e.target.closest('#role-hold').classList.add('seal-charging');holdTimer=setTimeout(()=>{roleOpen='reveal';render();document.getElementById('seal-role')?.focus();},900);}
function endHold(){clearTimeout(holdTimer);document.getElementById('role-hold')?.classList.remove('seal-charging');}
document.addEventListener('pointerdown',e=>{interactionAt=Date.now();beginHold(e);});document.addEventListener('pointerup',endHold);document.addEventListener('pointercancel',endHold);
document.addEventListener('input',e=>{if(e.target.closest('[data-form="timetable"]')){captureTimetable();document.querySelectorAll('.task-menu [data-cmd]').forEach(b=>{if(b.dataset.cmd!=='page')b.disabled=true;});}});
document.addEventListener('keydown',e=>{interactionAt=Date.now();if(e.key==='Escape'&&(roleOpen||rolePreview)){roleOpen=false;rolePreview=null;render();document.getElementById('role-hold')?.focus();}
 if((roleOpen==='reveal'||rolePreview)&&e.key==='Tab'){const buttons=[...document.querySelectorAll('.role-fullscreen button')];const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
});
document.addEventListener('keydown',e=>{if((e.code==='Space'||e.code==='Enter')&&e.target.id==='role-hold'&&!e.repeat){e.preventDefault();beginHold(e);}});document.addEventListener('keyup',endHold);
document.addEventListener('visibilitychange',()=>{if(document.hidden){roleOpen=false;rolePreview=null;endHold();if(event)render();}else if(lobby)refreshNow();});
window.addEventListener('online',()=>{if(lobby)refreshNow();});
client.auth.onAuthStateChange((name,s)=>{session=s;if(name==='SIGNED_OUT'){epoch++;lobby=null;event=null;eid=null;roleOpen=false;rolePreview=null;timetableDraft=null;timetableRevision=null;render();}});
async function refreshNow(){
 if(busy||confirming)return;
 try{await sync(!document.activeElement?.closest('form'));const status=document.getElementById('connection');if(status)status.textContent='Synced '+new Date(synced).toLocaleTimeString();}
 catch(error){if(error.message==='Sign in first.'){epoch++;lobby=null;event=null;eid=null;roleOpen=false;noticeError=true;notice='Your session expired. Sign in again.';render();notifications.show('Sign in again',notice,true);}else if(error.code==='TNO_RUNTIME_MISMATCH'){noticeError=true;notice=error.message;notifications.show('Event unavailable',notice,true);const node=document.getElementById('notice');if(node){node.textContent=notice;node.hidden=false;}}else{const status=document.getElementById('connection');if(status)status.textContent='Connection lost. Displayed information may be out of date. Unsaved actions are not queued.';}}
}
try{const {data,error}=await client.auth.getSession();if(error)throw error;session=data.session;if(session){await sync(false);if(lobby.live&&(lobby.live.joined||lobby.live.organiser)&&!practiceId){eid=lobby.live.id;await sync(false);}}}catch(error){if(error.message!=='Sign in first.'){noticeError=true;notice=error.message;}}render();if(notice)notifications.show('Sign in',notice,noticeError);
setInterval(()=>{if(lobby&&!document.hidden)refreshNow();},2000);
setInterval(()=>{
 if(!event)return;const expired=new Set();
 document.querySelectorAll('[data-clock]').forEach(node=>{const g=groupBy(node.dataset.clock);if(!g)return;const left=timeLeft(g,Date.now()+serverOffset);const label=clock(left);if(node.textContent!==label)node.textContent=label;if(!g.paused&&left===0)expired.add(g.id);});
 if(sound&&[...expired].some(id=>!previousExpired.has(id))){try{const ctx=new AudioContext();const osc=ctx.createOscillator();const gain=ctx.createGain();gain.gain.value=.04;osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.2);osc.onended=()=>ctx.close();}catch{}}
 previousExpired=expired;
},1000);
