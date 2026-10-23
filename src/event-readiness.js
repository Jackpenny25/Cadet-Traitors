export function roleReadiness(event){
 const groups=event.groups.map(group=>{
  const players=event.players.filter(p=>p.group===group.id);
  const active=players.filter(p=>p.status==='Active').length;
  const assigned=players.filter(p=>['Traitor','Faithful'].includes(p.role)).length;
  const traitors=players.filter(p=>p.role==='Traitor').length;
  const needed=Math.max(0,group.traitors+1-active);
  return {id:group.id,name:group.name,active,assigned,total:players.length,traitors,required:group.traitors,needed,ready:needed===0&&assigned===players.length&&traitors===group.traitors};
 });
 const hasPrepared=event.players.some(p=>p.role==='Traitor'||p.role==='Faithful');
 return {groups,hasPrepared,canPrepare:!event.roles_released&&!hasPrepared&&groups.length>0&&groups.every(g=>g.needed===0),canRelease:!event.roles_released&&groups.length>0&&groups.every(g=>g.ready)};
}
