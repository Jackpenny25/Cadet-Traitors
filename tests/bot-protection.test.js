import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TurnstileGate,createProtectedSession} from '../src/bot-protection.js';

test('default session creation adds no CAPTCHA or third-party widget requirement',async()=>{
 let sent;const client={auth:{signInAnonymously:async args=>{sent=args;return {data:{session:{id:'s'}}};}}};
 const gate={takeToken(){throw new Error('Must not request a CAPTCHA');}};
 assert.deepEqual(await createProtectedSession(client,gate),{id:'s'});assert.deepEqual(sent,{});
});
test('optional CAPTCHA passes its token to Supabase and cannot reuse it',async()=>{
 const gate=new TurnstileGate({siteKey:'test',document:{},window:{}});gate.token='one-use-token';
 let sent;const client={auth:{signInAnonymously:async args=>{sent=args;return {data:{session:{id:'s'}}};}}};
 await createProtectedSession(client,gate,{enabled:true});assert.equal(sent.options.captchaToken,'one-use-token');
 await assert.rejects(()=>createProtectedSession(client,gate,{enabled:true}),/security check/);
});
test('optional widget expires tokens, ignores stale callbacks, and blocks unconfigured mode',async()=>{
 let callbacks;const status={textContent:''};const box={isConnected:true,querySelector:selector=>selector.includes('status')?status:{}};
 const gate=new TurnstileGate({siteKey:'test',document:{},window:{turnstile:{render:(el,args)=>{callbacks=args;return 'widget';},remove(){}}}});
 await gate.mount(box);callbacks.callback('token');assert.equal(gate.token,'token');
 callbacks['expired-callback']();assert.equal(gate.token,'');
 gate.clear();callbacks.callback('late-token');assert.equal(gate.token,'');
 const unconfigured=new TurnstileGate({siteKey:'',document:{},window:{}});await unconfigured.mount(box);assert.match(status.textContent,/not configured/);
});
