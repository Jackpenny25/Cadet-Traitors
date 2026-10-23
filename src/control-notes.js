// One floating note avoids clipping in cards. Hover, focus and the information button share it.
export function installControlNotes(doc=document){
 const note=doc.createElement('div');note.id='floating-control-note';note.className='control-note';note.setAttribute('role','tooltip');note.hidden=true;
 doc.body.append(note);
 let anchor=null,pinned=false,closeTimer=null;
 const hide=()=>{clearTimeout(closeTimer);if(anchor){anchor.querySelector('[data-cmd],button[type="submit"]')?.removeAttribute('aria-describedby');anchor.querySelector('.control-info')?.setAttribute('aria-expanded','false');}anchor=null;pinned=false;note.hidden=true;};
 const position=()=>{
  if(!anchor?.isConnected){hide();return;}
  const rect=anchor.getBoundingClientRect(),viewport=doc.documentElement;const width=Math.min(360,viewport.clientWidth-24);
  note.style.width=width+'px';note.style.left=Math.max(12,Math.min(rect.left,viewport.clientWidth-width-12))+'px';
  const height=note.getBoundingClientRect().height;note.style.top=Math.max(12,Math.min(rect.bottom+10+height>viewport.clientHeight?rect.top-height-10:rect.bottom+10,viewport.clientHeight-height-12))+'px';
 };
 const show=el=>{
  clearTimeout(closeTimer);if(anchor!==el){hide();anchor=el;note.textContent=el.dataset.note;}
  note.hidden=false;anchor.querySelector('[data-cmd],button[type="submit"]')?.setAttribute('aria-describedby',note.id);anchor.querySelector('.control-info')?.setAttribute('aria-expanded','true');position();
 };
 const later=()=>{clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!pinned&&!anchor?.contains(doc.activeElement))hide();},180);};
 doc.addEventListener('pointerover',e=>{const el=e.target.closest('[data-note]');if(el&&!el.contains(e.relatedTarget))show(el);});
 doc.addEventListener('pointerout',e=>{const el=e.target.closest('[data-note]');if(el&&!el.contains(e.relatedTarget)&&!note.contains(e.relatedTarget))later();});
 note.addEventListener('pointerenter',()=>clearTimeout(closeTimer));note.addEventListener('pointerleave',later);
 doc.addEventListener('focusin',e=>{const el=e.target.closest('[data-note]');if(el)show(el);});
 doc.addEventListener('focusout',e=>{if(anchor?.contains(e.target)&&!anchor.contains(e.relatedTarget))later();});
 doc.addEventListener('click',e=>{const info=e.target.closest('.control-info');if(!info)return;e.preventDefault();const el=info.closest('[data-note]');if(anchor===el&&pinned)hide();else{show(el);pinned=true;}});
 doc.addEventListener('pointerdown',e=>{if(anchor&&!anchor.contains(e.target)&&!note.contains(e.target))hide();});
 doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&!note.hidden){e.stopImmediatePropagation();hide();}},true);
 doc.defaultView.addEventListener('resize',hide);doc.addEventListener('scroll',hide,true);
 return {hide};
}
