export const schemaQuery=`select jsonb_build_object(
 'columns',(select jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable,'default',column_default)) from information_schema.columns where table_schema='private' or table_schema='public' and table_name in ('events','event_groups','players','player_secrets')),
 'constraints',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid))) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where k.contype<>'n' and (n.nspname='private' or n.nspname='public' and c.relname in ('events','event_groups','players','player_secrets'))),
 'indexes',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef)) from pg_indexes where schemaname='private' or schemaname='public' and tablename in ('events','event_groups','players','player_secrets')),
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or n.nspname='public' and c.relname in ('events','event_groups','players','player_secrets')))
) as schema_audit`;

export function schemaDifferences(expected,actual){
 const key=(type,row)=>[row.schema,row.table,type==='columns'?row.column:type==='tables'?'':row.name].join('.');
 const result={};
 for(const type of ['tables','columns','constraints','indexes']){
  const found=new Map(actual[type].map(row=>[key(type,row),row]));
  result[type]=expected[type].flatMap(row=>{
   const other=found.get(key(type,row));
   if(!other)return [{missing:row}];
   const fields=type==='columns'?['type','nullable','default']:type==='tables'?['rls']:['definition'];
   const changed=fields.filter(field=>row[field]!==other[field]);
   return changed.length?[{expected:row,actual:other,changed}]:[];
  });
 }
 return result;
}
