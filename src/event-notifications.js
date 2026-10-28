// Kept outside the refreshed app so polling cannot dismiss an unread update.
export function installNotifications(doc=document,{schedule=setTimeout,cancel=clearTimeout}={}){
 const region=doc.createElement('section');region.className='event-notifications';region.setAttribute('aria-label','Event updates');doc.body.append(region);
 return {show(title,message,error=false){
  if([...region.children].some(card=>card.dataset.title===title&&card.dataset.message===message))return;
  const card=doc.createElement('article');card.className='event-notification'+(error?' is-error':'');card.setAttribute('role',error?'alert':'status');
  card.dataset.title=title;card.dataset.message=message;
  const heading=doc.createElement('h2');heading.textContent=title;const body=doc.createElement('p');body.textContent=message;
  let timer;const dismiss=()=>{cancel(timer);card.remove();};
  const lifetime=error?14000:7000;const start=()=>{cancel(timer);timer=schedule(dismiss,lifetime);};
  const close=doc.createElement('button');close.type='button';close.textContent='Dismiss';close.setAttribute('aria-label','Dismiss '+title);close.addEventListener('click',dismiss);
  card.addEventListener('pointerenter',()=>cancel(timer));card.addEventListener('pointerleave',start);card.addEventListener('focusin',()=>cancel(timer));card.addEventListener('focusout',e=>{if(!card.contains(e.relatedTarget))start();});
  card.append(heading,body,close);region.append(card);
  start();
 }};
}
