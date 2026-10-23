import {esc,btn} from './event-ui.js';

export const flightNames=['Phantom Flight','Spectre Squadron','Wraith Wing','Nightfall Command'];
export const wings=`<svg class="night-wings" viewBox="0 0 240 64" aria-hidden="true"><path d="M120 12l9 19 89-15-22 17-57 9 36 2-22 10-28-8-5 14-5-14-28 8-22-10 36-2-57-9-22-17 89 15z"/><circle cx="120" cy="32" r="7"/></svg>`;
export function roleEnvelope(me,released,open){
 if(open)return `<section class="role-theatre ${open==='reveal'?'role-fullscreen':''} ${me.role==='Traitor'?'role-traitor':'role-faithful'}" ${open==='reveal'?'role="dialog" aria-modal="true"':'role="region"'} aria-labelledby="role-title"><div class="role-orbit" aria-hidden="true"></div><div class="role-dossier">${wings}<p class="eyebrow">2427 · Classified personnel file</p><p class="role-prelude">The seal is broken. Your allegiance is revealed.</p><h2 id="role-title">${esc(me.role||'Awaiting orders')}</h2><p class="role-oath">${me.role==='Traitor'?'Loyalty is your disguise. Betrayal is your mission.':'Hold your nerve. Trust carefully. Find the traitors.'}</p><p class="tiny">Keep this file private.</p><div class="btns">${open==='reveal'?btn('private_dashboard','Open my dashboard'):''}${btn('hide_role','Seal my file',{},'id="seal-role"')}</div></div></section>`;
 return `<button class="envelope classified-envelope" id="role-hold" type="button" aria-label="Press and hold to open your private role" ${released?'':'disabled'}><span class="envelope-lines" aria-hidden="true"></span><span class="eyebrow">Eyes only · Player ${esc(me.number)}</span><span class="wax-seal" aria-hidden="true">2427</span><span class="envelope-label">${released?'Your allegiance awaits':'Awaiting the host’s orders'}</span><span class="tiny">${released?'Hold to break the seal':'Your file is sealed'}</span></button>`;
}

export function moveSchedule(rows,index,direction){
 const next=index+direction;if(next<0||next>=rows.length)return rows.map(r=>({...r}));
 const result=rows.map(r=>({...r}));[result[index],result[next]]=[result[next],result[index]];
 return reflowSchedule(result,rows[0].time);
}
export function reflowSchedule(rows,start=rows[0]?.time||'19:00'){
 let minutes=start.split(':').reduce((a,v,i)=>a+Number(v)*(i?1:60),0);
 return rows.map(r=>{const time=String(Math.floor(minutes/60)%24).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');minutes+=Number(r.minutes);return {...r,time};});
}

// An initial load shows the saved roster immediately. Later deaths wait for their reveal.
export class EliminationQueue{
 constructor(){this.initial=true;this.presented=new Set();this.known=new Set();this.pending=[];}
 update(players){
  for(const p of players){
   if(!['Banished','Murdered'].includes(p.status)||this.known.has(p.id))continue;
   this.known.add(p.id);if(this.initial)this.presented.add(p.id);else this.pending.push({...p});
  }
  this.initial=false;
 }
 next(){return this.pending.shift();}
 complete(id){this.presented.add(id);}
}
