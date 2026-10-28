export const flightNames=['Phantom Flight','Spectre Squadron','Wraith Wing','Nightfall Command'];
export function orderGroups(groups){
 const rank=g=>flightNames.includes(g.name)?flightNames.indexOf(g.name):flightNames.length;
 return [...groups].sort((a,b)=>rank(a)-rank(b)||String(a.name||a.id).localeCompare(String(b.name||b.id)));
}
