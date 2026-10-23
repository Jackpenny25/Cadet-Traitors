export const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const btn=(cmd,label,args={},extra='')=>`<button type="button" class="gold" data-cmd="${esc(cmd)}" data-args="${esc(JSON.stringify(args))}" ${extra}>${esc(label)}</button>`;
export const field=(name,label,type='text',value='',extra='')=>`<label class="field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const text=(name,label,value='',max=1000)=>`<label class="field">${esc(label)}<textarea name="${esc(name)}" maxlength="${max}">${esc(value)}</textarea></label>`;
export const check=(name,label,on=false)=>`<label class="check"><input name="${name}" type="checkbox" ${on?'checked':''}>${esc(label)}</label>`;
export const options=(items,value)=>items.map(i=>`<option value="${esc(i.id)}" ${String(i.id)===String(value)?'selected':''}>${esc(i.name)}</option>`).join('');
export const select=(name,label,items,value,extra='')=>`<label class="field">${esc(label)}<select name="${name}" ${extra}>${options(items,value)}</select></label>`;
export const form=(cmd,body,label='Save',args={})=>`<form data-form="${cmd}" data-args="${esc(JSON.stringify(args))}" class="stack">${body}<button class="gold" type="submit">${esc(label)}</button></form>`;
export const panel=(title,body,cls='')=>`<section class="panel ${cls}"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="panel-body">${body}</div></section>`;
export const timeLeft=(group,serverNow=Date.now())=>group.paused?Math.max(0,group.remaining):Math.max(0,Math.ceil((Date.parse(group.deadline)-serverNow)/1000));
export const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export function lateAdvice(timetable,date,now=Date.now()){
 const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
 const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(localDate!==date)return 'The event timetable uses Europe/London. Actual phase clocks start only when an organiser presses a control.';
 const [h,m]=localTime.split(':').map(Number);const remaining=Math.max(0,21*60+10-(h*60+m));
 const shortenable=timetable.filter(r=>/Archive|Vault|Transmission/i.test(r.label)&&r.minutes>10&&r.time>=localTime);
 return `${remaining} minutes remain until the 21:10 results deadline. ${shortenable.length?'Consider shortening '+shortenable[0].label+' by five minutes.':'Keep final reveals, clear up and parade protected.'} Nothing is skipped automatically.`;
}
