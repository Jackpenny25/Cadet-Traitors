// Public briefings only. Answer material is entered through protected server fields.
export const missionPlanId='2026-11-02-archive-evidence';
export const legacyMissionPlan=[
 {idx:0,title:'The Locked Archive',minutes:25,max_points:100,
  instructions:'Work in three teams to decode Signals, Plotting and Registry evidence. Combine your digits in that order and ask the NCO to check the code before opening the archive. Keep clues within your flight. Explain your reasoning. Phones away during the physical task unless an NCO asks otherwise.',
  equipment:'Three printed clue packs, response sheet, pens and a three digit lockbox or sealed envelope.'},
 {idx:1,title:'The Evidence Room: Case investigation',minutes:20,max_points:125,
  instructions:"A fictional classified file called RAVEN has been stolen. Compare the witness statement, badge register, door log, clock notice and storage records. Identify the suspect, theft time, exact hiding place, false claim and the evidence chain. Submit one flight response. These fictional characters have no connection to players’ secret roles.",
  equipment:'Printed case packs, response sheet and pens. Keep final-review evidence sealed until the later activity.'},
 {idx:2,title:'The Evidence Room: Final Review',minutes:15,max_points:100,
  instructions:'Reopen the same case. Compare the new evidence with the original file. Decide which new report is false, explain why and identify who submitted it. State whether your original conclusion changes. Submit one final flight response.',
  equipment:'Retained case papers, sealed final-review pack, response sheet and pens.'},
];
const rows=[
 ['briefing','19:00',10,'Welcome and joining','activity'],
 ['roles','19:10',5,'Joining checks and role release','release_roles'],
 ['archive','19:15',25,'The Locked Archive','mission',0],
 ['round1','19:40',10,'Round table 1','discussion'],
 ['murder1','19:50',5,'First murder opportunity and reveal','open_murder',null,0],
 ['vault','19:55',20,'The Evidence Room: Case investigation','mission',1],
 ['round2','20:15',10,'Round table 2','discussion'],
 ['break','20:25',10,'Break and second murder reveal','activity'],
 ['transmission','20:35',15,'The Evidence Room: Final Review','mission',2],
 ['round3','20:50',15,'Final round table','discussion'],
 ['results','21:05',5,'Final reveals and awards','finish'],
 ['clearup','21:10',5,'Clear up and form up','activity'],
 ['parade','21:15',15,'Parade','activity'],
];
// Retain stored activity IDs so current-stage highlights survive the update.
export const legacyMissionTimetable=rows.map(([id,time,minutes,label,action,mission=null,slot=null])=>({id,time,minutes,label,action,mission,slot}));

export const missionPlan=legacyMissionPlan.map(m=>m.idx===0?{...m,instructions:'Work in three teams to decode Signals, Plotting and Registry evidence. Combine your digits in that order and explain your reasoning to your flight NCO. The NCO checks the existing code and authorises opening your sealed ARCHIVE envelope. There are four ARCHIVE envelopes, one per flight. Keep the CASE RAVEN envelope inside sealed until the Evidence Room begins. Keep clues within your flight. Phones away unless an NCO asks otherwise.',equipment:'Four sealed ARCHIVE envelopes, each containing a sealed CASE RAVEN envelope; three printed clue packs per flight, response sheets and pens. Wax-style seals are optional decoration.'}:m);
export const missionTimetable=[...legacyMissionTimetable.map(r=>r.id==='break'?{...r,label:'Break and Murder in Plain Sight attempts'}:r),
 {id:'task-send',time:'20:24',minutes:1,label:'Send private Murder in Plain Sight tasks',action:'activity',mission:null,slot:null},
 {id:'task-close',time:'20:32',minutes:1,label:'Close submissions and private review',action:'activity',mission:null,slot:null},
 {id:'task-reveal',time:'20:33',minutes:2,label:'Staged second murder reveals',action:'activity',mission:null,slot:null},
].sort((a,b)=>a.time.localeCompare(b.time));
