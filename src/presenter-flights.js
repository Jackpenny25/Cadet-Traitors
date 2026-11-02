import {esc} from './event-ui.js';

export function selectedFlights(board,saved){
 const ids=Array.isArray(saved)?saved.filter(id=>board.groups.some(g=>g.id===id)):[];
 return ids.length?[...new Set(ids)]:board.groups.map(g=>g.id);
}
export function flightBoard(board,ids){
 const selected=new Set(ids);
 return {...board,groups:board.groups.filter(g=>selected.has(g.id)),players:board.players.filter(p=>selected.has(p.group)),reveals:board.reveals.filter(r=>selected.has(r.group)),quiz_results:(board.quiz_results||[]).filter(r=>selected.has(r.group))};
}
export function flightPicker(board,ids){
 return `<dialog class="presenter-flights" aria-labelledby="presenter-flights-title"><form id="presenter-flight-form"><h2 id="presenter-flights-title">Flights on this projector</h2><p>Choose any combination for this room. Other projectors keep their own selection.</p>${board.groups.map((g,i)=>`<label><input type="checkbox" name="flight" value="${esc(g.id)}" ${ids.includes(g.id)?'checked':''}>${esc((g.registered_flight||i+1)+' Flight · '+g.name)}</label>`).join('')}<p class="presenter-flight-error" role="alert" hidden>Choose at least one flight.</p><div><button type="submit">Show selected flights</button><button type="button" data-close-flight-picker>Cancel</button></div></form></dialog>`;
}
