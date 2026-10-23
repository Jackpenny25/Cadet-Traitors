// Tokens are single-use and are verified by Supabase, never by browser code.
export class TurnstileGate {
 constructor({siteKey,document=globalThis.document,window=globalThis.window,onChange=()=>{}}){
  Object.assign(this,{siteKey,document,window,onChange});this.token='';this.widget=null;this.epoch=0;
 }
 clear(){
  this.epoch++;this.token='';
  if(this.widget!==null&&this.window.turnstile)this.window.turnstile.remove(this.widget);
  this.widget=null;this.onChange(false);
 }
 async mount(container){
  this.clear();const epoch=this.epoch;
  const status=container.querySelector('[role="status"]');
  if(!this.siteKey){status.textContent='Sign-in protection is not configured yet. Please contact the organiser.';return;}
  status.textContent='Loading security check…';
  try{
   if(!this.window.turnstile){
    await new Promise((resolve,reject)=>{
     const script=this.document.createElement('script');
     const timer=setTimeout(()=>reject(new Error('Security check timed out. Refresh the page to retry.')),15000);
     script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
     script.onload=()=>{clearTimeout(timer);resolve();};
     script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Security check could not load. Check your connection and refresh.'));};
     this.document.head.append(script);
    });
   }
   if(epoch!==this.epoch||!container.isConnected)return;
   const set=(token,message)=>{if(epoch!==this.epoch)return;this.token=token;status.textContent=message;this.onChange(Boolean(token));};
   this.widget=this.window.turnstile.render(container.querySelector('.turnstile-widget'),{
    sitekey:this.siteKey,theme:'dark',size:'flexible',
    callback:token=>set(token,'Security check complete.'),
    'expired-callback':()=>set('','Security check expired. Please complete it again.'),
    'error-callback':()=>{set('','Security check failed. Refresh to retry.');return true;},
   });
  }catch(e){if(epoch===this.epoch)status.textContent=e.message;}
 }
 takeToken(){if(!this.token)throw new Error('Complete the security check before signing in.');const token=this.token;this.token='';this.onChange(false);return token;}
}
export async function createProtectedSession(client,gate,{enabled=false}={}){
 const options=enabled?{options:{captchaToken:gate.takeToken()}}:{};
 const {data,error}=await client.auth.signInAnonymously(options);
 if(error)throw new Error(enabled?'Could not verify this session. Please retry the security check.':'Could not start a session. Please wait a moment and try again.');
 return data.session;
}
