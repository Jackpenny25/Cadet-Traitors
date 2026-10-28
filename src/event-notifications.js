// Kept outside the refreshed app so polling cannot dismiss an unread update.
export function installNotifications(doc=document){
 const region=doc.createElement('section');region.className='event-notifications';region.setAttribute('aria-label','Event updates');doc.body.append(region);
 return {show(title,message,error=false){
  if([...region.children].some(card=>card.dataset.title===title&&card.dataset.message===message))return;
  const card=doc.createElement('article');card.className='event-notification'+(error?' is-error':'');card.setAttribute('role',error?'alert':'status');
  card.dataset.title=title;card.dataset.message=message;
  const heading=doc.createElement('h2');heading.textContent=title;const body=doc.createElement('p');body.textContent=message;
  const close=doc.createElement('button');close.type='button';close.textContent='Dismiss';close.setAttribute('aria-label','Dismiss '+title);close.addEventListener('click',()=>card.remove());
  card.append(heading,body,close);region.append(card);
 }};
}
