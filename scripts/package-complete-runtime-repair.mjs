import {readFile,writeFile,readdir} from 'node:fs/promises';
import {sqlFunctions} from './sql-functions.mjs';
const definitions=new Map();
for(const file of ['002-connected.sql','005-security.sql','event-runtime.sql']){
 for(const fn of sqlFunctions(await readFile('supabase/'+file,'utf8')))definitions.set(fn.name,fn.sql);
}
if(definitions.size!==23)throw new Error('Unexpected complete runtime function count: '+definitions.size);
const files=await readdir('supabase/migrations');
const previous=await readFile('supabase/migrations/'+files.find(n=>n.endsWith('_restore_runtime_routing.sql')),'utf8');
const file=files.find(n=>n.endsWith('_restore_complete_runtime.sql'));
if(!file)throw new Error('Create the restore_complete_runtime migration with Supabase CLI first.');
const prefix=previous.slice(previous.indexOf('do $$'),previous.indexOf('create or replace function'));
const grants=previous.slice(previous.indexOf('-- Keep browser clients'));
await writeFile('supabase/migrations/'+file,`-- Restore ALL canonical runtime functions after older setup definitions were reinstalled.
-- Includes dashboard snapshots, projector reads, protected commands and authentication.
-- No records, account credentials or event configuration are changed.
${prefix}${[...definitions.values()].join('\n\n')}\n\n${grants}`);
console.log('Packaged '+file+' ('+definitions.size+' functions)');
