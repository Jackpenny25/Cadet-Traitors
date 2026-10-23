// Device-local demo identity. Replace this adapter with server-side verification for connected play.
export function validateJoin(name,pin,repeat){
  const display=String(name??'').trim().replace(/\s+/g,' ');
  if(!display||display.length>30||/[\u0000-\u001f\u007f]/.test(display))throw Error('Enter a name or callsign, up to 30 characters.');
  if(!/^\d{4}$/.test(String(pin)))throw Error('Choose a four-digit PIN.');
  if(pin!==repeat)throw Error('The PINs do not match. Try again.');
  return {display,key:display.normalize('NFKC').toLocaleLowerCase('en-GB')};
}
export async function pinHash(pin,salt){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:Uint8Array.from(salt),iterations:100000,hash:'SHA-256'},key,256);
  return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function claimName(s,name,pin,repeat){
  const {display,key}=validateJoin(name,pin,repeat);
  s.identities??=[];
  s.joinAttempts??={count:0,since:Date.now()};
  if(Date.now()-s.joinAttempts.since>60000)s.joinAttempts={count:0,since:Date.now()};
  if(s.joinAttempts.count>=5)throw Error('Too many incorrect PINs. Wait one minute or ask your NCO.');
  const existing=s.identities.find(x=>x.nameKey===key);
  if(existing){
    const valid=await pinHash(pin,existing.salt)===existing.hash;
    if(!valid){s.joinAttempts.count++;throw Error('That name is already registered. Check your name and PIN, or ask your NCO.');}
    const player=s.players.find(p=>p.id===existing.playerId);
    if(!player)throw Error('Your player record is unavailable. Ask your NCO.');
    s.joinAttempts.count=0;
    return {player,returning:true};
  }
  if(!s.joining)throw Error('Joining is closed. Ask your NCO.');
  const player=s.players.find(p=>!s.identities.some(x=>x.playerId===p.id));
  if(!player)throw Error('The demo is full. Ask your NCO.');
  const salt=Array.from(crypto.getRandomValues(new Uint8Array(16)));
  const hash=await pinHash(pin,salt);
  // Check again after the asynchronous hash, in case another request used this slot.
  if(!s.joining)throw Error('Joining closed while you were signing up. Ask your NCO.');
  if(s.identities.some(x=>x.playerId===player.id||x.nameKey===key))throw Error('The player list changed. Please try again.');
  s.identities.push({nameKey:key,playerId:player.id,salt,hash});
  player.displayName=display;player.name=display;
  return {player,returning:false};
}
