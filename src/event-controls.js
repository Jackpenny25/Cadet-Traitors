// These checks are calculated by the same server code that accepts the command.
export function controlAvailability(state,cmd,args={}){
 if(!state?.organiser)return {allowed:true,reason:''};
 if(state.ended)return {allowed:false,reason:'This event has finished. Open Event home and create a separate rehearsal to practise further.'};
 if(cmd==='start_task'){
  const row=state.timetable.find(r=>r.id===args.row);if(!row)return {allowed:false,reason:'Reload the timetable to find this activity.'};
  cmd=row.action;args={...args,mission:row.mission,slot:row.slot,...(row.action==='discussion'?{round:Number(row.id.match(/^round([1-3])$/)?.[1])||undefined}:{})};
 }
 if(cmd==='publish_ready')cmd=args.kind==='murder'?'publish_murder':'publish_ballot';
 const selected=state.groups.filter(g=>!args.group||g.id===args.group);
 const checks=selected.map(g=>{
  const key=['mission','open_murder','publish_murder'].includes(cmd)?cmd+'_'+Number(cmd==='mission'?args.mission:args.slot):['discussion','publish_ballot'].includes(cmd)?cmd+'_'+Number(args.round||g.mission+1):args.round&&['open_vote','close_vote','runoff','random_draw','reopen_ballot','skip_ballot','test_votes'].includes(cmd)?cmd+'_'+args.round:cmd;
  return {group:g,check:g.control_checks?.[key]};
 }).filter(item=>item.check);
 if(!checks.length)return {allowed:true,reason:''};
 const blocked=checks.filter(({check})=>!check.allowed&&!check.noop);
 const ready=checks.filter(({check})=>check.allowed);const completed=checks.filter(({check})=>check.noop);
 return {allowed:!blocked.length&&ready.length>0,reason:(blocked.length?blocked:ready.length?completed:checks).map(({group,check})=>group.name+': '+check.reason).join('\n'),ready:ready.map(({group})=>group.id),completed:completed.map(({group})=>group.id)};
}

export const nextLabels={mission:'Begin mission',discussion:'Start discussion',open_vote:'Open voting',close_vote:'Close voting',runoff:'Start tied runoff',random_draw:'Draw after tied runoff',reopen_ballot:'Reopen empty ballot',skip_ballot:'Skip empty ballot',publish:'Reveal outcome',open_murder:'Open murder opportunity',lock_murder:'Lock standard choices',page:'Open private controls',finale:'Start finale',resume:'Resume timer'};
