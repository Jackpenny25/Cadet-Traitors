import {esc,panel} from './event-ui.js';

export function ownGroup(state){return state?.groups.find(g=>g.id===state.me?.group);}
export function groupsNeedDifferentSteps(groups){
 return new Set(groups.map(g=>JSON.stringify([g.phase,g.mission,g.banishments,g.next_step?.next,
  g.next_step?.next_args?.mission,g.next_step?.next_args?.round,g.next_step?.next_args?.slot]))).size>1;
}
export function ballotProgress(group){
 if(!group.ballot)return '';
 const received=group.votes_received??0;
 return `${received}${group.ballot.status==='open'?'/'+(group.eligible??group.active):''} votes received`;
}
export function currentMission(state){const g=ownGroup(state);return g?.phase==='Mission'?state.missions.find(m=>m.idx===g.mission):null;}
export function cadetSummary(state){
 const g=ownGroup(state);if(!g)return '';
 return `<section class="cadet-stage"><div><p class="eyebrow">Your team</p><h2>${esc(g.name)}</h2><p>${esc(g.phase)}</p>${state.ended&&g.winner?`<h3>${esc(g.winner)} win</h3>`:''}</div></section>`;
}
export function cadetMission(state){
 const m=currentMission(state);if(!m)return '';
 return panel(m.title,`<p>${esc(m.instructions)}</p>${m.equipment?`<p><strong>Equipment:</strong> ${esc(m.equipment)}</p>`:''}<p>Maximum ${m.max_points} points</p><p class="tiny muted">Follow your NCO’s briefing. You can put your phone away during the task.</p>`,'current-mission');
}
export function controlIsCurrent(g,cmd,args={}){
 if(cmd==='mission')return g.phase==='Mission'&&g.mission===Number(args.mission);
 if(cmd==='discussion')return g.phase==='Discussion';
 if(cmd==='open_vote')return g.phase==='Voting'&&g.ballot?.status==='open';
 if(cmd==='planning')return Boolean(g.planning);
 if(cmd==='finale')return g.phase==='Finale';
 return false;
}
export function currentTask(g,rows){
 if(g.phase==='Joining')return null;
 if(g.phase==='Results'||g.phase==='Finale')return rows.find(r=>r.action==='finish')?.id;
 if(g.active_task)return rows.find(r=>r.id===g.active_task)?.id||null;
 // Existing events retain a useful highlight before their next organiser action.
 if(g.phase==='Mission')return rows.find(r=>r.action==='mission'&&Number(r.mission)===g.mission)?.id;
 if(['Discussion','Voting','Closed','Planning'].includes(g.phase))return rows.find(r=>r.id==='round'+(g.mission+1))?.id;
 if(g.phase==='Roles')return rows.find(r=>r.action==='release_roles')?.id;
 return null;
}
export function eventUpdates(before,after){
 if(!before||before.id!==after.id)return [];
 const updates=[];
 if(after.announcement&&after.announcement!==before.announcement)updates.push({title:'Announcement',message:after.announcement});
 if(!before.roles_released&&after.roles_released)updates.push({title:'Your file is ready',message:'Hold the seal to open your private role.'});
 const g=ownGroup(after),old=ownGroup(before);
 if(!after.organiser&&g&&old){
  if(after.me.status!==before.me.status)updates.push({title:after.me.status==='Active'?'Player update':'You have been '+after.me.status.toLowerCase(),message:'You can still help your team with physical missions.'});
  if(g.phase!==old.phase||g.mission!==old.mission||g.active_task!==old.active_task){
   const m=currentMission(after);updates.push({title:m?'Mission started':g.phase==='Voting'?'Voting is open':'New stage',message:m?.title||g.phase});
  }else if(g.ballot?.id!==old.ballot?.id&&g.ballot?.status==='open')updates.push({title:'Voting is open',message:'A new ballot is ready. Choose your vote on My game.'});
  if(after.messages.some(m=>!before.messages.some(old=>old.id===m.id)))updates.push({title:'Private update',message:'Open your classified file to read your team’s private messages.'});
  for(const r of after.reveals.filter(r=>r.group_id===g.id&&r.published&&!before.reveals.some(old=>old.id===r.id&&old.published))){
   const p=after.players.find(p=>p.id===r.target);if(p&&p.id!==after.me.id)updates.push({title:'Team update',message:`${p.name} has been ${r.kind.toLowerCase()}.`});
  }
 }
 return updates;
}
