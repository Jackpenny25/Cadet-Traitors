import {esc,btn,check,form,panel} from './event-ui.js';
import {controlAvailability} from './event-controls.js';

export function secondModeSettings(state){
 if(!state.host)return '';
 return panel('Second murder format',`<p>The first murder always keeps its RAF quiz, shield scoring and 90-second Traitor chat.</p>${form('second_murder_mode',check('standard','Use a standard second murder instead of Murder in Plain Sight',state.second_murder_standard)+`<p>${state.second_murder_standard?'Standard selection: private targets over the break, then manual locking and publication. No quiz or timed chat.':'Murder in Plain Sight: send physical tasks, collect completion and evidence, then FS Penny reviews and reveals.'}</p><p>Choose before sending a physical task or opening the second murder. Unsent drafts are kept if you switch back.</p>`,'Save second murder format',{expected:Boolean(state.second_murder_standard)},state.ended||state.second_mode_locked?'disabled':'')}${state.second_mode_locked?'<p class="schedule-warning">The format is locked because a task has been sent or a second-murder opportunity has opened. Finish the selected format; use a new rehearsal to test the other.</p>':''}`);
}
export function standardSecondControls(state,target='',dirty=false,row=null){
 if(!state.organiser||!state.second_murder_standard)return '';
 const permitted=()=>state.host;
 const groups=state.groups.filter(g=>!target||g.id===target);
 let html='';
 for(const g of groups){
  const w=state.windows.find(w=>w.group_id===g.id&&w.slot===1),r=state.reveals.find(r=>r.opportunity===w?.id);
  const action=(cmd,label,args={},ready=true)=>{
   const payload={group:g.id,expected_opportunities:{[g.id]:w?.id||null},...args};
   const availability=controlAvailability(state,cmd,payload);
   return btn(cmd,label,payload,!state.ended&&!dirty&&ready&&permitted()&&availability.allowed?'':'disabled',availability.reason||undefined);
  };
  if(!row||row.id==='break')html+=action('open_murder','Open second murder: '+g.name,{slot:1},!w);
  if(!row||row.id==='task-close')html+=action('lock_murder','Lock second murder choices: '+g.name,{opportunity:w?.id},w?.status==='open');
  if(!row||row.id==='task-reveal')html+=action('publish','Reveal second murder: '+g.name,{reveal:r?.id},r&&!r.published);
 }
 return row?html:panel('Standard second murder',`<p>After round table 2, open private choices during the break. Active Traitors choose an eligible Faithful in their own flight. Lock the saved choices, then publish the result separately. There is no RAF quiz or automatic chat window.</p><p>If their choices differ, the designated deciding Traitor’s choice is used; by default this is the first active Traitor by player number. FS Penny can record a manual decision with a reason.</p><div class="btns">${html}</div>`);
}
