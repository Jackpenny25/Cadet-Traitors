// These migrations use $$ function bodies without nested dollar quotes.
export function sqlFunctions(sql){
 return [...sql.matchAll(/^create(?: or replace)? function\s+([\w.]+)\b[\s\S]*?\$\$[\s\S]*?\$\$;/gm)].map(match=>({
  name:match[1],sql:match[0].replace(/^create function /,'create or replace function '),
 }));
}
