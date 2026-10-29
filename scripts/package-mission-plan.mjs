// Only public content belongs in the migration. Private packs stay outside the repo.
import {readFile,writeFile} from 'node:fs/promises';
import {missionPlan,missionTimetable} from '../src/mission-plan.js';
const path='supabase/migrations/20261028205344_evidence_room_stages.sql';
let sql=await readFile(path,'utf8');
sql=sql.split('-- BEGIN GENERATED PUBLIC MISSION PLAN')[0];
sql+='-- BEGIN GENERATED PUBLIC MISSION PLAN\n';
for(const [name,value] of [['mission_plan_cards',missionPlan],['mission_plan_timetable',missionTimetable]]){
 sql+=`create or replace function private.${name}() returns jsonb language sql immutable set search_path='' as $$ select '${JSON.stringify(value).replaceAll("'","''")}'::jsonb; $$;\nrevoke all on function private.${name}() from public,anon,authenticated;\n`;
}
await writeFile(path,sql);
