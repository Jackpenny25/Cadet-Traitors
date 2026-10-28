export function actionableError(error,cmd,args={},state){
 if(cmd==='start_task'){
  const row=state?.timetable.find(r=>r.id===args.row);if(row){cmd=row.action;args={...args,slot:row.slot,mission:row.mission};}
 }
 const message=error?.message||'The action could not be saved.';
 if(message.startsWith('Nothing has changed.'))return message;
 if(/fetch|network|timeout|abort/i.test(message))return 'The connection was interrupted. Check Wi-Fi, then try the same action again. A retry will not submit it twice.';
 if(/Check the submitted values/i.test(message))return 'Some fields are missing or invalid. Check the highlighted fields, enter a valid date and whole numbers within the limits, then try again.';
 if(!state?.organiser)return message;
 const groups=state.groups.filter(g=>!args.group||g.id===args.group);
 if(/Check this opportunity|cannot start another discussion|Release roles and resolve|Start discussion before opening/i.test(message)){
  if(!state.roles_released)return 'Prepare random roles, then release the private envelopes in Main host before starting this stage.';
  for(const g of groups){
   const prefix=g.name+': ';
   if(g.done)return prefix+'deduction is complete. Continue the physical missions, then use Start finale when outstanding outcomes have been revealed.';
   if(g.ballot&&!g.ballot.published&&g.ballot.status!=='skipped'){
    if(g.ballot.status==='open')return prefix+'voting is still open. Close voting, resolve any tie, then reveal the outcome before continuing.';
    if(g.ballot.status==='tie')return prefix+(g.ballot.runoff?'the runoff tied. Use Draw after tied runoff, then reveal the outcome.':'the ballot tied. Start tied runoff, close the new vote, then reveal the outcome.');
    if(g.ballot.status==='empty')return prefix+'nobody voted. Reopen the empty ballot, or deliberately skip it, before continuing.';
    return prefix+'reveal the pending ballot outcome before starting the next stage.';
   }
   if(cmd==='open_murder'&&Number(args.slot)===0&&g.banishments<1)return prefix+'complete the first round table: start discussion, open voting, close voting and reveal the outcome. Then open the first murder.';
   if(cmd==='open_murder'&&Number(args.slot)===1&&g.mission!==1)return prefix+'start The Vault mission before opening the second murder opportunity.';
   if(g.phase==='Discussion')return prefix+'discussion is already running. Open voting when everyone is ready.';
  }
 }
 const guidance=[
  [/No open standard opportunity/, 'Open a standard murder opportunity first. If this is a supervised objective, use Assign objective and Resolve privately instead of Lock choices.'],
  [/No open supervised objective/, 'Open the supervised murder opportunity during its mission, assign a target and objective, then record the physical verification.'],
  [/Choose an active deciding Traitor/, 'Choose a currently active Traitor in this group under Designated murder decision maker, then open the opportunity again.'],
  [/No open ballot/, 'Start discussion, then open voting. Close voting after players have submitted.'],
  [/changed.*Refresh|changed.*current identifier/i, 'Another organiser moved this stage on. Reload the current group, check its latest stage, then repeat the action.'],
  [/Lock the standard murder/, 'Use Lock decisions privately for the open murder opportunity, then reveal its outcome before starting the next stage.'],
  [/Resolve the current murder/, 'Finish the open murder first: lock standard choices, or verify the supervised objective. Reveal its outcome, then open the next opportunity.'],
 ];
 return guidance.find(([pattern])=>pattern.test(message))?.[1]||message;
}
