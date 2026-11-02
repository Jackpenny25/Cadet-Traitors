import {esc} from './event-ui.js';
import {eliminationScene} from './event-theatre.js';

const eliminated=p=>['Murdered','Banished'].includes(p.status);

// Only the public board payload enters this queue. A cue never publishes a game outcome.
export function boardCues(board){
 const cues=(board.quiz_results||[]).map(result=>({id:`quiz:${result.id}`,type:'quiz',result,group:board.groups.find(g=>g.id===result.group)}));
 for(const r of [...board.reveals].sort((a,b)=>String(a.time||'').localeCompare(String(b.time||''))||a.id.localeCompare(b.id))){
  const player=board.players.find(p=>p.id===r.target),group=board.groups.find(g=>g.id===r.group);
  const elimination=player&&!r.redundant&&['Murdered','Banished'].includes(r.kind);
  cues.push({id:`outcome:${r.id}`,type:elimination?'elimination':'outcome',player:player?{...player,status:r.kind}:null,group,kind:r.kind,redundant:r.redundant});
  if(player&&r.role)cues.push({id:`role:${r.id}`,type:'role',player,group,role:r.role});
 }
 // Compatibility with older saved events that have an elimination but no public reveal row.
 for(const player of board.players.filter(eliminated))if(!board.reveals.some(r=>r.target===player.id&&!r.redundant)){
  cues.push({id:`status:${player.id}:${player.status}`,type:'elimination',player,group:board.groups.find(g=>g.id===player.group)});
 }
 if(board.ended)for(const group of board.groups)if(group.winner)cues.push({id:`winner:${group.id}:${group.winner}`,type:'winner',group});
 return cues;
}

export class PresenterCues{
 constructor(saved){
  this.completed=new Set(Array.isArray(saved?.completed)?saved.completed.filter(v=>typeof v==='string'):[]);
  this.presented=new Set(Array.isArray(saved?.presented)?saved.presented.filter(v=>typeof v==='string'):[]);
  this.pending=[];this.active=null;
 }
 update(board){this.pending=boardCues(board).filter(c=>!this.completed.has(c.id)&&c.id!==this.active?.id);}
 next(){if(this.active)return null;this.active=this.pending.shift()||null;return this.active;}
 complete(){
  if(!this.active)return null;
  const cue=this.active;this.completed.add(cue.id);
  if(cue.type==='elimination')this.presented.add(cue.player.id);
  this.active=null;return cue;
 }
 save(){return {completed:[...this.completed],presented:[...this.presented]};}
}

export function presenterScene(cue){
 if(cue.type==='elimination')return eliminationScene(cue.player,cue.group);
 if(cue.type==='quiz')return `<div class="verdict-fog" aria-hidden="true"></div><div class="elimination-ring" aria-hidden="true"></div><div class="elimination-dossier quiz-verdict"><p class="eyebrow">${esc(cue.group?.name)}</p><p class="verdict-warning">RAF shield challenge</p><p class="elimination-verdict">${cue.result.winner?'Shield awarded':'Quiz complete'}</p><div class="verdict-nameplate"><h2>${esc(cue.result.name||'No shield awarded')}</h2></div><p class="presenter-result">${cue.result.winner?`${esc(cue.result.score)} / ${esc(cue.result.total)} correct`: 'No eligible numerical estimate was submitted'}</p><p class="verdict-stamp">${cue.result.winner?'Protected from this murder':'No quiz winner'}</p></div>`;
 const heading=cue.type==='role'?cue.role:cue.type==='winner'?`${cue.group.winner} win`:cue.redundant?'No further elimination':cue.kind==='Murdered'?'No murder tonight':'No banishment';
 const name=cue.type==='role'?cue.player.name:cue.type==='winner'?cue.group.name:'';
 return `<div class="verdict-fog" aria-hidden="true"></div><div class="elimination-ring" aria-hidden="true"></div><div class="elimination-dossier"><p class="eyebrow">${esc(cue.group?.name)}</p><p class="verdict-warning">${cue.type==='role'?'The allegiance is revealed':cue.type==='winner'?'The final verdict':'The verdict is sealed'}</p><p class="elimination-verdict">${cue.type==='role'?'Allegiance':cue.type==='winner'?'Flight result':'Round table and murder results'}</p><div class="verdict-nameplate"><h2>${esc(name||heading)}</h2></div>${name?`<p class="presenter-result">${esc(heading)}</p>`:''}<p class="verdict-stamp">${cue.type==='winner'?'Case closed':'Verdict revealed'}</p></div>`;
}

const forwardKeys=new Set(['PageDown','ArrowRight','ArrowDown',' ','Spacebar','Enter','n','N']);
export function installPresenterControls(doc,advance){
 const interactive=target=>{
  const control=target?.closest?.('a,button,input,textarea,select,dialog,[contenteditable="true"]');
  return control&&!control.hasAttribute('data-presenter-next');
 };
 const click=event=>{if(!doc.hidden&&event.button===0&&event.detail<=1&&!interactive(event.target))advance();};
 const key=event=>{
  if(doc.hidden||!forwardKeys.has(event.key)||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing||interactive(event.target))return;
  event.preventDefault();if(!event.repeat)advance();
 };
 doc.addEventListener('click',click);doc.addEventListener('keydown',key);
 return ()=>{doc.removeEventListener('click',click);doc.removeEventListener('keydown',key);};
}
