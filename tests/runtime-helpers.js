import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile} from 'node:fs/promises';
export async function eventDatabase(count=55){
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',auth.uid())$$;
 grant usage on schema public,auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;`);
 try{for(const file of ['001-foundation.sql','002-connected.sql','005-security.sql','event-runtime.sql'])await db.exec(await readFile('supabase/'+file,'utf8'));}catch(error){await db.close();throw error;}
 const users=Array.from({length:count},()=>crypto.randomUUID());
 for(let i=0;i<count;i++){
  await db.query('insert into auth.users values($1,null,null)',[users[i]]);
  await db.query('insert into auth.sessions values($1,$1)',[users[i]]);
  await db.query("insert into private.accounts(id,name,name_key,pin_hash) values($1,$2,lower($2),extensions.crypt('0123',extensions.gen_salt('bf',4)))",[users[i],i===0?'Host':'Person '+i]);
  await db.query('insert into private.sessions(auth_user,account_id,auth_session) values($1,$1,$1)',[users[i]]);
 }
 await db.query('insert into private.hosts values($1)',[users[0]]);
 let serial=Promise.resolve();
 async function queryAs(index,sql,params=[]){
  const work=serial.then(async()=>{
   await db.exec('reset role');
   await db.query("select set_config('request.uid',$1,false)",[index===null||index===-1?'':users[index]]);
   if(index!==-1)await db.exec(`set role ${index===null?'anon':'authenticated'}`);
   return db.query(sql,params);
  });serial=work.catch(()=>{});return work;
 }
 const rpc=async(index,name,args)=>{
  const entries=Object.entries(args);const sql=`select public.${name}(${entries.map(([key],i)=>key+'=> $'+(i+1)).join(',')}) as data`;
  const result=(await queryAs(index,sql,entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].data;
  if(result?.error)throw new Error(result.error);return result;
 };
 return {db,users,rpc,queryAs,
  cmd:async(i,cmd,eid=null,args={})=>{
   if(['close_vote','runoff','random_draw','skip_ballot','reopen_ballot','lock_murder'].includes(cmd)){
    const state=await rpc(i,'tno_snapshot',{eid});
    args={expected_ballots:Object.fromEntries(state.groups.map(g=>[g.id,g.ballot?.id||null])),expected_opportunities:Object.fromEntries(state.groups.map(g=>[g.id,state.windows.find(w=>w.group_id===g.id&&w.status==='open')?.id||null])),...args};
   }
   return rpc(i,'tno_command',{cmd,eid,args:{request_id:crypto.randomUUID(),...args}});
  },
  snap:(i,eid=null)=>rpc(i,'tno_snapshot',{eid}),
  board:token=>rpc(null,'tno_board',{token}),
  close:async()=>{await serial;await db.close();},
 };
}
