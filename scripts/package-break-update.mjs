import {readFile,writeFile} from 'node:fs/promises';
import {missionPlan,missionTimetable} from '../src/mission-plan.js';
const path=process.argv[2];
if(!path?.endsWith('_break_2010_2030.sql')&&!path?.endsWith('_optional_evidence_envelopes.sql'))throw new Error('Pass the CLI-created timetable or envelope migration path.');
const json=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).replaceAll("'","''");
if(path.endsWith('_optional_evidence_envelopes.sql')){
 await writeFile(path,`-- Clarify optional packaging for new events; existing mission records stay intact.\ncreate or replace function private.mission_plan_cards() returns jsonb language sql immutable set search_path='' as $$\n select '${json(missionPlan)}'::jsonb;\n$$;\nrevoke all on function private.mission_plan_cards() from public,anon,authenticated;\n`);
 process.exit(0);
}
const template=await readFile(new URL('./break-update.sql',import.meta.url),'utf8');
await writeFile(path,template.replace('PUBLIC_CARDS_JSON',json(missionPlan)).replace('PUBLIC_TIMETABLE_JSON',json(missionTimetable)));
