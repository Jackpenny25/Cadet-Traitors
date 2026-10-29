const labels={
 publish_ready:'Reveal outcomes',release_roles:'Release envelopes',prepare_roles:'Prepare roles',
 reset_roles:'Reset unreleased roles',publish:'Reveal outcome',reveal_role:'Reveal role',
 finish:'Reveal final results',random_draw:'Draw a player',close_vote:'Close voting',
 lock_murder:'Lock decisions',confirm_objective:'Confirm verification',withdraw:'Withdraw player',
 recover:'Reset PIN',rotate_board:'Replace link',export:'Download private record'
};

export function confirmAction(command,message,root=document){
 return new Promise(resolve=>{
  const previous=root.activeElement;
  const dialog=root.createElement('dialog');
  dialog.className='event-confirmation';
  dialog.setAttribute('aria-labelledby','event-confirm-title');
  dialog.setAttribute('aria-describedby','event-confirm-message');
  const title=root.createElement('h2');title.id='event-confirm-title';title.textContent=labels[command]||'Confirm action';
  const description=root.createElement('p');description.id='event-confirm-message';description.textContent=message;
  const actions=root.createElement('div');actions.className='btns';
  const cancel=root.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const confirm=root.createElement('button');confirm.type='button';confirm.className='gold';confirm.textContent=labels[command]||'Confirm';
  actions.append(cancel,confirm);dialog.append(title,description,actions);root.body.append(dialog);
  let settled=false;
  const finish=value=>{
   if(settled)return;settled=true;
   dialog.close();dialog.remove();
   if(previous?.isConnected)previous.focus();
   resolve(value);
  };
  cancel.addEventListener('click',()=>finish(false));
  confirm.addEventListener('click',()=>finish(true));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
  dialog.showModal();cancel.focus();
 });
}
