import {esc,btn,field,text,check,select,form,panel} from './event-ui.js';

const choices=[{id:'disabled',name:'Disabled'},{id:'optional',name:'Optional'},{id:'required',name:'Required'}];
const name=(state,id)=>state.players.find(p=>p.id===id)?.name||'No submission';
export function hostTaskDrafts(report){
 return panel('Private task drafts',`${btn('back','Back to Event home')}<p>Prepare and save one task for each flight before an event exists. These drafts are visible only to your host account. Saving does not send anything. After completing event setup, open Private tasks and copy these saved drafts into that event.</p>${[1,2,3,4].map(f=>{
  const d=report?.drafts?.find(d=>d.flight===f);
  return `<article class="plain-flight"><h3>${f} Flight</h3>${form('save_task_draft',text('task','Proposed private task',d?.task||'',1500)+select('explanation','Written explanation',choices,d?.explanation||'required')+select('photo','Photo evidence',choices,d?.photo||'optional')+check('nco','Allow assigned NCO evidence assistance when copied',d?.nco),'Save private flight draft',{flight:f,revision:d?.revision??null})}</article>`;
 }).join('')}`);
}
export function plainTimetableControls(state,row,target='',dirty=false){
 const groups=state.groups.filter(g=>!target||g.id===target);let html='';
 for(const g of groups){
  const t=(state.plain_tasks||[]).find(t=>t.group===g.id);const args={group:g.id,revision:t?.revision};
  const enabled=state.host&&!state.ended&&!dirty;
  if(['task-send','round2'].includes(row.id))html+=btn('plain_send','Send private task: '+g.name,args,enabled&&t?.state==='draft'&&state.roles_released&&!g.done?'':'disabled');
  if(row.id==='break')html+=btn('plain_open','Open submissions: '+g.name,args,enabled&&t?.state==='sent'&&g.mission===1&&!g.done?'':'disabled');
  if(row.id==='task-close')html+=btn('plain_close','Close submissions: '+g.name,args,enabled&&t?.state==='open'?'':'disabled');
  if(row.id==='task-reveal'){
   const r=state.reveals.find(r=>r.opportunity===t?.opportunity);const p=state.players.find(p=>p.id===r?.target);
   const valid=!r?.target||p?.status==='Active'&&p.role==='Faithful';
   html+=btn('publish','Reveal murder: '+g.name,{group:g.id,reveal:r?.id},enabled&&t?.state==='reviewed'&&r&&!r.published&&g.banishments>=2&&!['open','tie','empty'].includes(g.ballot?.status)&&valid?'':'disabled');
  }
 }
 return html+btn('page','Private task editor, evidence and review',{page:'plain'});
}
export function fellowTraitors(state,visible=false){
 if(!state.roles_released||state.me?.role!=='Traitor'||state.me.status!=='Active')return '';
 return panel('Your private circle',visible?`<ul>${(state.fellows||[]).map(p=>`<li>${esc(p.name)} <span class="pill">${esc(p.status)}</span></li>`).join('')||'<li>No other Traitors in your flight.</li>'}</ul>${btn('hide_fellows','Hide fellow Traitors')}`:btn('meet_fellows','Meet your fellow Traitors'));
}
export function plainPlayer(state){
 if(!state.roles_released||state.me?.role!=='Traitor'||state.me.status!=='Active')return '';
 return (state.plain_tasks||[]).filter(t=>t.group===state.me.group&&t.state!=='draft').map(t=>{
  const s=t.submission;const args={group:t.group,task:t.id};
  return panel('Murder in Plain Sight',`<p class="eyebrow">Private flight task · ${esc(t.state)}</p><h3>${esc(t.task)}</h3><p>Complete this physical action with the person you propose as the victim. A report alone never eliminates anyone. FS Penny reviews it and reveals the outcome separately.</p>${s?`<div role="status"><h3>Completion received</h3><p>Reported by ${esc(name(state,s.reporter))} for ${esc(name(state,s.target))} at ${esc(new Date(s.submitted_at).toLocaleTimeString())}.</p><p>${esc(s.explanation)}</p>${s.photos?.length?btn('plain_photos','View submitted photographs',{task:t.id}):''}</div>`:t.state==='open'?form('plain_submit',select('target','Person involved and proposed victim',state.players.filter(p=>p.group===state.me.group&&p.status==='Active'&&p.role!=='Traitor').map(p=>({id:p.id,name:p.name})),undefined,'required')+(t.explanation!=='disabled'?text('explanation','Explain what you did with this person'+(t.explanation==='required'?' (required)':' (optional)'),'',1500):'')+(t.photo!=='disabled'?`<label class="field">Photographs of this task and person (${esc(t.photo)})<input name="evidence" type="file" accept="image/*" multiple data-task-photo="${esc(t.id)}"></label><p class="tiny muted">Up to three photos. Images are resized privately on this device before uploading. If your phone’s format cannot be opened, choose a JPEG or take a screenshot of the photo.</p><div id="evidence-preview" class="evidence-previews"></div><p id="evidence-status" role="status"></p>`:'')+`<p class="tiny muted">Check the named person before submitting. One shared completion report is accepted per flight.</p>`,'Submit physical task completion',args):`<p>${t.state==='sent'?'Your task has arrived. Completion reporting will open when FS Penny starts break attempts.':'Completion submissions are closed. Keep the task private and wait for the public reveal.'}</p>`}`,'plain-task classified-card');
 }).join('');
}
export function plainHost(state,group=''){
 if(!state.organiser)return '';
 const host=state.host;
 const groups=state.groups.filter(g=>!group||g.id===group);
 return panel('Murder in Plain Sight',`<p>FS Penny controls delivery, submissions, decisions and staged reveals. CWO Nevard presents. Target order: send before 20:25; attempts during break; close at 20:32; review until 20:33; reveal flights until 20:35. These are manual targets.</p>${host?`<div class="btns">${btn('load_task_drafts','Review my private flight drafts')}${btn('copy_task_drafts','Copy saved drafts into this event',{},state.ended?'disabled':'','Copies only into flights without an existing task. Does not overwrite drafts, send tasks, open submissions or change the current stage. Complete event setup before copying.')}</div>`:''}${select('control-group','Private task flight',[...(host?[{id:'',name:'All four flights'}]:[]),...state.groups.map(g=>({id:g.id,name:(g.registered_flight?g.registered_flight+' Flight · ':'')+g.name}))],group,'id="plain-task-flight"')}${groups.map(g=>{
  const t=(state.plain_tasks||[]).find(t=>t.group===g.id);if(!host&&!t)return '';
  const args={group:g.id,revision:t?.revision??null};const s=t?.submission;const r=state.reveals.find(r=>r.opportunity===t?.opportunity);
  return `<article class="plain-flight"><h3>${esc(g.registered_flight?g.registered_flight+' Flight · '+g.name:g.name)}</h3><p class="pill">${esc(t?.state||'No draft')}</p>${host&&(!t||t.state==='draft')?form('plain_save',text('task','Private physical task',t?.draft||'',1500)+select('explanation','Written explanation',choices,t?.draft_explanation||'required')+select('photo','Photo evidence',choices,t?.draft_photo||'disabled')+check('nco','Permit assigned flight NCOs to read evidence and record verification',t?.draft_nco),'Save draft privately',args)+btn('plain_send','Send saved task to this flight’s active Traitors',args,t?.state==='draft'&&state.roles_released&&!g.done?'':'disabled','Sends the saved draft only to this flight’s active Traitors. It does not open submissions, close voting or change the current stage.'):t?`<h4>${esc(t.task)}</h4><p>Explanation: ${esc(t.explanation)} · Photos: ${esc(t.photo)}</p>`:''}${host&&t?`<div class="btns">${btn('plain_open','Open completion submissions',args,t.state==='sent'&&g.mission===1&&!g.done?'':'disabled')}${btn('plain_close','Close completion submissions',args,t.state==='open'?'':'disabled')}</div>`:''}${s?`<section class="task-submission"><h4>Completion submission</h4><p>Reporting Traitor: ${esc(name(state,s.reporter))}<br>Proposed victim: ${esc(name(state,s.target))}<br>Received: ${esc(new Date(s.submitted_at).toLocaleString())}</p><p>${esc(s.explanation||'No written explanation supplied.')}</p>${s.photos?.length?btn('plain_photos','View private photographs',{task:t.id}):'<p>No photographs supplied.</p>'}${s.verification?`<p>Verification: ${esc(s.verification)}</p>`:''}</section>`:t&&t.state!=='draft'?'<p>No completion received.</p>':''}${t?.state==='closed'&&(host||t.allow_nco)?form('plain_verify',text('reason','Physical verification findings','',500),'Record verification',args):''}${host&&t?.state==='closed'?form('plain_review',select('decision','Host decision',[{id:'rejected',name:'Reject / no murder'},{id:'approved',name:'Approve submitted attempt'}])+text('reason','Decision reason','',500),'Record private decision',args):''}${host&&t?.state==='reviewed'?`<p>Private review: ${esc(t.review_reason)}</p><p>Outcome: ${esc(t.outcome?.reason||'Awaiting decision')}</p><p>${r?.target?'Pending victim: '+esc(name(state,r.target)):'No victim pending. Check the rejection or shield result.'}</p><div class="btns">${btn('publish','Reveal this flight’s murder outcome',{group:g.id,reveal:r?.id},r&&!r.published?'':'disabled')}${r?.target&&(state.players.find(p=>p.id===r.target)?.status!=='Active'||state.players.find(p=>p.id===r.target)?.role!=='Faithful')?form('plain_void',text('reason','Why the pending victim is invalid','',500),'Void invalid outcome',args):''}</div>`:''}</article>`;
 }).join('')}`,'private-tasks');
}

// Re-encode photographs instead of retaining camera EXIF/location metadata.
export async function prepareEvidence(file,env=globalThis){
 if(!file||file.size>20000000)throw new Error('Choose a photo smaller than 20 MB. You can take a screenshot of a larger photograph.');
 if(!file.type.startsWith('image/'))throw new Error('Choose a photograph, such as JPEG, PNG or a phone camera image.');
 const url=env.URL.createObjectURL(file);
 try{
  const img=new env.Image();img.src=url;
  try{await img.decode();}catch{throw new Error('This phone photo format could not be opened. Save it as JPEG or use a screenshot, then choose that image.');}
  const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=env.document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
  if(!blob||blob.size>5242880)throw new Error('The resized photo is still too large. Choose a smaller image or screenshot.');
  return blob;
 }finally{env.URL.revokeObjectURL(url);}
}
