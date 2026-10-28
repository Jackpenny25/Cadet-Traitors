// Descriptions stay separate from command arguments and never contain private mission answers.
export function missionHelp(mission){
 if(!mission)return 'Start the selected physical mission for the selected groups. Release roles first and resolve the previous ballot or murder opportunity.';
 return `${mission.title}. ${mission.instructions||'Follow the mission card and the organiser’s briefing.'} ${mission.equipment?'Equipment: '+mission.equipment+' ':''}Starting changes the selected groups to this mission and starts its ${mission.minutes} minute countdown. Record points separately in Missions.`;
}

export function commandHelp(cmd,args={}){
 const notes={
  create:args.practice?'Create an empty rehearsal, separate from the live event. It has its own roster, roles, votes and scores.':'Create the single live event with four groups. Joining starts closed; complete Setup before admitting players.',
  joining:args.open?'Let registered players join from the website and receive a group with space. After role release, new players join as Faithful; existing roles stay the same. Reset unreleased preparation before reopening joining.':'Stop new players joining. Existing players stay signed in and keep their group and role.',
  prepare_roles:'Randomly assign the configured number of Traitors in each group and close joining. Every group needs more players than Traitors. Players cannot see the roles until you release their files.',
  release_roles:'Let each player privately open their Faithful or Traitor file. Prepare and check all roles first. Released roles cannot be reassigned or rerolled.',
  mission:missionHelp(),
  discussion:'Start a five minute round table for the selected groups. Players discuss suspicions. This does not open voting; use Open voting when discussion is finished.',
  open_vote:'Start a two minute ballot. Active players choose another active player in their own group and may change their vote until you close it. Live vote totals stay private.',
  close_vote:'Stop accepting votes and calculate the result privately. Missing votes count as abstentions. A tie needs a runoff; the name is not public until you reveal the outcome.',
  runoff:'Open a fresh one minute ballot between the tied candidates. Only one runoff is allowed. If that also ties, the main host can use the explicit random draw.',
  random_draw:'Randomly select from the candidates tied after the runoff. This is a main host action. The result stays private until you publish it.',
  skip_ballot:'Deliberately skip a ballot that received no votes. Nobody is banished. This is only available to the main host.',
  reopen_ballot:'Reopen a ballot that received no votes so players can submit again. This is only available to the main host.',
  planning:'Open two minutes of private planning. Active Traitors in their group can coordinate; everyone else sees a neutral device prompt. Authorised organisers can supervise the messages.',
  open_murder:`Open murder opportunity ${Number(args.slot)===1?'two':'one'}. Standard mode lets active Traitors select a Faithful; supervised mode needs a private physical objective and NCO verification. Setup chooses the mode. Opening never publishes a victim.`,
  lock_murder:'Close the standard target choices and record the outcome privately. Disagreements use the designated deciding Traitor. No valid choice means no murder. Publish the outcome separately.',
  pause:'Freeze the selected groups’ countdowns and any open murder deadline. Other groups continue unless All groups is selected.',
  resume:'Restart a paused countdown using its saved remaining time. Connected devices use the same server deadline.',
  extend:'Add one minute to the selected groups’ countdowns and any open murder deadline. No result is revealed automatically.',
  finale:'Start a five minute closing phase for the selected groups. Deduction must be complete and outstanding decisions resolved. This does not reveal the final winners or all roles.',
  finish:'End the event and publicly disclose final group winners and all roles. Finish deduction in every group, close ballots, resolve murder opportunities and publish pending outcomes first. This disclosure cannot be undone.',
  announce:args.text?'Send a neutral “Check your device” announcement to player dashboards. It cannot wake locked phones or send a push notification.':'Replace the announcement on player dashboards with this text. It does not change the phase or publish a private outcome.',
  publish:'Make this outcome public. An eliminated player appears on the projector with a dramatic reveal and a red X. Their hidden role is disclosed separately.',
  reveal_role:'Publicly disclose this banished player’s role. Their elimination has already been published. This does not reveal their partners.',
  export:'Download the selected event’s private recovery record, including roles, votes and pending outcomes. It excludes PIN hashes and session tokens. Store it on the organiser device, away from the projector.',
  rotate_board:'Replace this event’s read only projector link. The old link stops working. Open the new Projector link afterwards; player accounts and the website QR address are unchanged.',
  reset_roles:'Remove prepared roles only while they are still unreleased. Players, groups and accounts remain. Prepare a new distribution afterwards. Released roles cannot be reset.',
  delete:'Permanently delete this event and its roster, roles, votes, scores and event records. Registered accounts and other events remain. Download a private recovery record first and type the exact event title to confirm.',
  set_live:'Choose this preserved, eligible event as the one live event. The public website and joining QR will point players to it. Rehearsals cannot become live events.',
  recover:'Replace this player’s four digit PIN and revoke their previous application sessions. Their player number, role, group and votes remain. Verify the person physically first.',
  withdraw:'Remove this player from deduction with a logged reason. Their record stays in the roster. This is a withdrawal, not a murder or banishment.',
  callsign:'Approve a public roster name for this player. Their private account login name and PIN do not change.',
  manual_role:'Assign an unreleased role to this player. Each group must still have its configured number of Traitors before roles can be released.',
  shield:'Award this player protection against the chosen murder opportunity only. It does not protect against banishment; only the player and authorised organisers see it.',
  proxy_vote:'Record a vote for an active player who cannot use their phone. A reason is required. The same group, eligibility and no self vote rules still apply.',
  late_join:'Admit an existing registered account to a group with space and record the reason. After role release, a late player joins as Faithful without changing existing roles.',
  assign_staff:'Assign a registered organiser account to the checked groups. Their access is limited to those groups and the NCO permissions you choose.',
  permissions:'Choose which actions assigned NCOs can perform in their own groups. The main host retains event administration and account assignment.',
  score:'Save the total points earned so far for this mission, rather than adding a new amount. Record a reason and mark completion when appropriate. Mission points do not decide deduction winners.',
  edit_mission:'Save this mission’s public briefing, equipment, scoring and duration. Notes and verified answers are restricted to authorised organisers.',
  objective:'Privately assign an eligible Faithful and a supervised physical objective. The target stays publicly active unless a verified outcome is later published.',
  confirm_objective:'Record physical verification or rejection of a supervised objective with a reason. A Traitor’s report alone is not proof. The result stays private until publication.',
  organiser_message:'Send a private instruction to active Traitors in this group. Assigned authorised organisers can read the conversation.',
  timetable:'Save this running order for all of your events and future rehearsals. It changes the template without resetting event progress. Other devices must reload stale edits.',
  schedule_reload:'Discard your unsaved timetable changes and reload the latest saved running order.',
  slips:'Open printable player number and group slips. These do not include PINs or hidden roles.',
  add_test_players:'Add clearly labelled test players to this rehearsal only. They have no real accounts, PINs or sign ins. Reset unreleased roles first if needed; existing real players are kept.',
  test_votes:'Generate votes for active test players in the selected rehearsal groups’ current ballots. Real players’ votes are untouched. Close voting and publish the outcome yourself afterwards.',
  preview_role:'Preview this test player’s released role using the same reveal card as a player sees. Only the rehearsal host can use this preview.',
 };
 return notes[cmd==='delete_event'?'delete':cmd]||'';
}

export function taskHelp(row,missions=[]){
 if(!row)return 'Reload the timetable to see this activity’s details.';
 const duration=`The scheduled duration is ${row.minutes} minutes.`;
 if(row.action==='mission'){
  const mission=missions.find(m=>m.idx===Number(row.mission));
  return `${missionHelp(mission)} ${duration} Starting from the timetable uses this scheduled duration.`;
 }
 const activities={
  briefing:'Welcome the cadets, explain the rules, check devices and brief staff. Start begins the selected groups’ activity countdown.',
  break:'Give everyone a short break and bring the group back together. Start begins the activity countdown. Resolve and publish the second murder separately in the control room.',
  clearup:'Collect clues and equipment, clear the room and get ready to form up. Start begins the clear up countdown.',
  parade:'Bring everyone together for final parade and closing instructions. Start begins the parade countdown.',
 };
 const description=row.action==='activity'?(activities[row.id]||`Begin “${row.label}” and its countdown for the selected groups. This does not reveal an outcome.`):commandHelp(row.action,{slot:row.slot});
 return `${description} ${duration}${row.action==='open_murder'?' The scheduled activity opens the opportunity; lock or verify and publish its outcome separately.':''}`;
}
