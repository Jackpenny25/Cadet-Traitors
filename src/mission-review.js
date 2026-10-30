import {esc,panel,field,text,check,select,form} from './event-ui.js';
import {missionPlan,missionTimetable,missionPlanId} from './mission-plan.js';

export function privateMissionPack(value){
 const rows=value?.private_material;
 if(!Array.isArray(rows)||rows.length!==3)throw new Error('Choose a private pack containing all three stages.');
 return missionPlan.map(m=>{
  const matches=rows.filter(r=>r.idx===m.idx),r=matches[0];
  if(matches.length!==1||['notes','answer','scoring'].some(k=>typeof r[k]!=='string'||!r[k].trim()||r[k].length>24000))throw new Error('Every stage needs private clues, answers, hints and marking rules.');
  return {idx:m.idx,notes:r.notes,answer:r.answer,scoring:r.scoring};
 });
}
export function missionPlanReview(state,pack){
 if(!state.host)return '';
 return panel('Review the 2 November mission plan',`<p>Selected event: <strong>${esc(state.title)}</strong> · ${esc(state.date)}${state.practice?' · Rehearsal':''}. This replaces only this event’s three stage cards and running order. Saved players, roles, votes, scores and current stages are preserved.</p><p>Two missions: the final review continues The Evidence Room. Three round tables and both murder opportunities remain. The supervised second objective is opened separately during the case and published at the break.</p><details><summary>Review the full proposed running order</summary><ol class="mission-plan-order">${missionTimetable.map(r=>`<li><time>${r.time}</time> · ${esc(r.label)}</li>`).join('')}</ol>${missionPlan.map(m=>`<h3>${esc(m.title)}</h3><p>${esc(m.instructions)}</p><p>Equipment: ${esc(m.equipment)}</p><p>Maximum ${m.max_points} points</p>`).join('')}</details><details><summary>Load private material and apply to this event</summary><p>Keep answer packs on the organiser device and in the private NCO handouts folder. Private text is saved to protected server fields. Review each field before applying.</p><label class="field">Private stage pack (JSON)<input id="private-mission-pack" type="file" accept="application/json,.json"></label>${form('apply_mission_plan',missionPlan.map(m=>{const p=pack?.find(r=>r.idx===m.idx)||state.missions.find(r=>r.idx===m.idx)||{};return `<fieldset><legend>${esc(m.title)} · Staff only</legend>${text('notes_'+m.idx,'Exact printed clues, delivery notes and scheduled hints',p.notes,24000)}${text('answer_'+m.idx,'Verified answer and reasoning',p.answer,24000)}${text('scoring_'+m.idx,'Exact marking rules',p.scoring,24000)}</fieldset>`;}).join('')+field('confirm','Type the selected event title to confirm','text','','required autocomplete="off" maxlength="80"'),'Apply plan to this event only',{plan_id:missionPlanId,revision:state.timetable_revision,mission_revision:state.mission_revision})}</details>`,'mission-plan-review');
}
function scoreEditor(state,mission,group,saved){
 const allowed=state.host||state.nco_permissions?.includes('score');
 const inputs=select('group','Score for group',state.groups,group?.id,'data-score-group')
  +field('points','Stage total (replaces the saved total)','number',saved?.points??0,`required min="0" max="${mission.max_points}" step="1"`)
  +check('completed','Stage completed',saved?.completed)
  +field('reason','Evidence or completed stage','text',saved?.reason||'','required maxlength="200"');
 const note=allowed?'Save this stage’s total. Repeated saves do not add points. Mission points do not decide the deduction winner.'
  :'Scoring is read-only for your account. Ask the main host to enable the score permission in Setup.';
 return form('score',`<fieldset class="score-fields stack" ${allowed?'':'disabled'}>${inputs}</fieldset><p class="tiny muted">${note}</p>`,'Save stage total',{mission:mission.idx},allowed?'':'disabled');
}
export function missionCards(state,target=''){
 return state.missions.map(m=>{
  const group=state.groups.find(g=>g.id===target)||state.groups[0];
  const saved=state.scores.find(s=>s.group_id===group?.id&&s.mission===m.idx);
  return panel(m.title,`<p>${esc(m.instructions)}</p><p>Maximum ${m.max_points} points</p><p>Equipment: ${esc(m.equipment)}</p><div class="saved-stage-scores">${state.groups.map(g=>{const s=state.scores.find(r=>r.group_id===g.id&&r.mission===m.idx);return `<p><strong>${esc(g.name)}</strong>: ${s?`${s.points} / ${m.max_points} points · ${s.completed?'Completed':'In progress'}`:'No score saved'}${s?.reason?`<br><span class="tiny muted">${esc(s.reason)}</span>`:''}</p>`;}).join('')}</div><details class="private-mission-notes"><summary>Staff only: clues, hints, answers and marking</summary><h3>Delivery and clues</h3><p class="mission-copy">${esc(m.notes||'No private delivery pack saved yet.')}</p><h3>Verified answer</h3><p class="mission-copy">${esc(m.answer||'No verified answer saved yet.')}</p><h3>Marking rules</h3><p class="mission-copy">${esc(m.scoring)}</p></details>${scoreEditor(state,m,group,saved)}${state.host?`<details><summary>Edit stage card</summary>${form('edit_mission',field('title','Title','text',m.title,'required maxlength="80"')+text('instructions','Public briefing',m.instructions)+text('equipment','Public equipment checklist',m.equipment,500)+text('notes','Private clues, hints and NCO notes',m.notes,24000)+text('answer','Private verified answer',m.answer,24000)+text('scoring','Private marking rules',m.scoring,24000)+field('max_points','Maximum points','number',m.max_points,'required min="0" max="1000" step="1"')+`<input type="hidden" name="minutes" value="${m.minutes}">`,'Save stage',{mission:m.idx,mission_revision:state.mission_revision})}</details>`:''}`);
 }).join('');
}
