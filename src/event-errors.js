export function actionableError(error,cmd,args={},state){
 if(cmd==='start_task'){
  const row=state?.timetable.find(r=>r.id===args.row);if(row){cmd=row.action;args={...args,slot:row.slot,mission:row.mission};}
 }
 const message=error?.message||'The action could not be saved.';
 if(message.startsWith('Nothing has changed.'))return message;
 if(/fetch|network|timeout|abort/i.test(message))return 'The connection was interrupted. Check Wi-Fi, then try the same action again. A retry will not submit it twice.';
 if(cmd==='create'&&/Check group sizes, role counts and event title/.test(message)){
  const size=Number(args.size??13),traitors=Number(args.traitors??2);
  if(!String(args.title??'').trim()||String(args.title).trim().length>80)return 'Enter an event name between 1 and 80 characters, then create the event again.';
  if(!Number.isInteger(size)||size<2||size>25)return 'Enter a whole number from 2 to 25 for Players per group. Four groups can hold at most 100 players in total.';
  if(!Number.isInteger(traitors)||traitors<1||traitors>5)return 'Enter a whole number from 1 to 5 for Traitors per group.';
  if(traitors>=size)return `Each group needs at least one Faithful. With ${traitors} Traitors, enter at least ${traitors+1} Players per group, or reduce Traitors per group.`;
 }
 if(/Unknown event command/.test(message))return 'This control needs a database update that has not been installed yet. Your action was not saved. Ask the main host to update the game database, then reload this page before trying again.';
 if(cmd==='apply_mission_plan'&&/Confirm the selected event title/.test(message))return `Type the exact selected event title${state?.title?': '+state.title:''} in the confirmation field, then apply the plan again. Your private stage fields have been kept.`;
 if(/Check the submitted values/i.test(message))return 'Some fields are missing or invalid. Check the highlighted fields, enter a valid date and whole numbers within the limits, then try again.';
 if(!state?.organiser)return message;
 if(/The event has (finished|ended)/i.test(message))return 'This event has finished. Open Event home and create a separate rehearsal to practise further. The completed event stays available for viewing and private export.';
 if(cmd==='proxy_vote'&&/eligible active player.*self voting/.test(message)){
  if(args.voter===args.target)return 'A player cannot vote for themselves. Choose a different active player in Vote target, keep the reason, then record the manual vote again.';
  const voter=state.players?.find(p=>p.id===args.voter),target=state.players?.find(p=>p.id===args.target);
  if(voter?.group!==args.group||target?.group!==args.group)return 'The voter and vote target must both belong to the selected Group. Choose players from that group, then record the manual vote again.';
  const ballot=state.groups.find(g=>g.id===args.group)?.ballot;
  if(ballot?.runoff&&ballot.candidates?.length&&!ballot.candidates.includes(args.target)){
   const names=ballot.candidates.map(id=>state.players.find(p=>p.id===id)?.name).filter(Boolean);
   return `This is a runoff. Choose one of the tied candidates${names.length?': '+names.join(', '):' shown on this ballot'} in Vote target, then record the manual vote again.`;
  }
 }
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
   if(cmd==='open_murder'&&Number(args.slot)===1&&g.mission!==1)return prefix+'start The Evidence Room: Case investigation mission before opening the second murder opportunity.';
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
