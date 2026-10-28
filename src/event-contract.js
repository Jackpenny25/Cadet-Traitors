import {orderGroups} from './group-order.js';
// Reject incompatible payloads before replacing the last renderable state.
const mismatch=()=>{const error=new Error('The database response is from an older game version. Your event may already be saved. Refresh after the runtime update, then open the saved event instead of creating another.');error.code='TNO_RUNTIME_MISMATCH';return error;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const arrays=(value,keys)=>keys.every(key=>Array.isArray(value[key]));
export function lobbySnapshot(value){
 if(!object(value)||typeof value.name!=='string'||typeof value.can_host!=='boolean'||!Array.isArray(value.events)||!('live' in value)||(value.live!==null&&!object(value.live)))throw mismatch();
 return value;
}
export function eventSnapshot(value){
 if(!object(value)||typeof value.id!=='string'||typeof value.host!=='boolean'||typeof value.organiser!=='boolean'||!Number.isFinite(Date.parse(value.server_now))||!arrays(value,['groups','players','missions','timetable','scores','reveals','windows','messages','helps']))throw mismatch();
 if(!value.groups.length||value.groups.some(g=>!object(g)||typeof g.id!=='string'||typeof g.phase!=='string'||typeof g.paused!=='boolean'||!Number.isFinite(g.remaining)))throw mismatch();
 if(value.organiser&&(!arrays(value,['nco_permissions','audit'])||value.host&&!Array.isArray(value.staff)))throw mismatch();
 if(!value.organiser&&(!object(value.me)||!Array.isArray(value.me.shields)))throw mismatch();
 value.groups=orderGroups(value.groups);
 return value;
}
export function boardSnapshot(value){
 if(!object(value)||typeof value.id!=='string'||!Number.isFinite(Date.parse(value.server_now))||!arrays(value,['groups','missions','reveals','players']))throw mismatch();
 value.groups=orderGroups(value.groups);
 return value;
}
