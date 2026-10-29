// Keep correctable inputs after a failed save. Never retain PINs or chosen files.
const editable=control=>control.name&&!['password','file','hidden','submit','button'].includes(control.type);
const key=form=>form.dataset.form+'|'+(form.dataset.args||'');
export function captureFormDrafts(root){
 return new Map([...root.querySelectorAll('form[data-form]')].map(form=>[key(form),[...form.elements].filter(editable).map(control=>({name:control.name,value:control.value,checked:control.checked}))]));
}
export function restoreFormDrafts(root,drafts){
 for(const form of root.querySelectorAll('form[data-form]')){
  for(const saved of drafts.get(key(form))||[]){
   const control=[...form.elements].find(el=>editable(el)&&el.name===saved.name);if(!control)continue;
   if(control.type==='checkbox'||control.type==='radio')control.checked=saved.checked;
   else if(control.tagName!=='SELECT'||[...control.options].some(option=>option.value===saved.value))control.value=saved.value;
  }
 }
}
