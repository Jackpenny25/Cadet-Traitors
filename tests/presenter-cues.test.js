import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PresenterCues,presenterScene,installPresenterControls} from '../src/presenter-cues.js';

const board=()=>({id:'event',ended:false,groups:[{id:'flight',name:'Phantom Flight'}],players:[{id:'harry',name:'Harry',group:'flight',number:1,status:'Active'},{id:'other',name:'Other cadet',group:'flight',number:2,status:'Active'}],reveals:[]});
const outcome=(id,target,kind='Murdered',extra={})=>({id,group:'flight',target,kind,time:'2026-11-02T20:33:00Z',...extra});

test('public results wait for one deliberate advance each, including after refresh during a reveal',()=>{
 const s=board(),q=new PresenterCues();q.update(s);assert.equal(q.pending.length,0);
 s.reveals.push(outcome('one','harry'));s.players[0].status='Murdered';q.update(s);
 assert.equal(q.pending.length,1);assert.equal(q.active,null);assert.equal(q.presented.has('harry'),false);
 q.update(s);assert.equal(q.pending.length,1); // Repeated polling cannot duplicate the result.
 const saved=q.save(),reload=new PresenterCues(saved);reload.update(s);assert.equal(reload.pending.length,1);
 assert.equal(reload.next().player.name,'Harry');assert.equal(reload.next(),null);
 s.reveals.push(outcome('two','other','Banished'));s.players[1].status='Banished';reload.update(s);
 assert.equal(reload.pending.length,1);assert.equal(reload.presented.has('harry'),false);
 const interrupted=new PresenterCues(reload.save());interrupted.update(s);
 assert.equal(interrupted.pending.length,2);assert.equal(interrupted.next().id,'outcome:one'); // Interrupted animations remain pending.
 interrupted.complete();assert.equal(interrupted.active,null);assert.equal(interrupted.presented.has('harry'),true);
 assert.equal(interrupted.presented.has('other'),false);assert.equal(interrupted.pending.length,1); // No automatic chaining.
 const reconnect=new PresenterCues(interrupted.save());reconnect.update(s);
 assert.equal(reconnect.pending.length,1);assert.equal(reconnect.presented.has('harry'),true);
 assert.equal(reconnect.next().id,'outcome:two');reconnect.complete();reconnect.complete();reconnect.update(s);
 assert.equal(reconnect.pending.length,0);assert.equal(reconnect.presented.size,2);
});

test('no-victim outcomes, later public role reveals and final winners also wait without leaking a cross',()=>{
 const s=board(),q=new PresenterCues();s.reveals.push(outcome('blocked',null));q.update(s);
 assert.match(presenterScene(q.next()),/No murder tonight/);q.complete();assert.equal(q.presented.size,0);
 s.reveals.push(outcome('vote','harry','Banished'));s.players[0].status='Banished';q.update(s);
 assert.match(presenterScene(q.next()),/Harry/);q.complete();q.update(s);assert.equal(q.pending.length,0);
 s.reveals[1].role='Traitor';q.update(s);assert.equal(q.pending.length,1);assert.equal(q.pending[0].type,'role');
 assert.match(presenterScene(q.next()),/Traitor/);q.complete();
 s.ended=true;s.groups[0].winner='Faithful';q.update(s);
 assert.equal(q.pending.length,1);assert.match(presenterScene(q.next()),/Faithful win/);q.complete();q.update(s);assert.equal(q.pending.length,0);
 const hostile=presenterScene({type:'role',role:'<script>',player:{name:'<img>'},group:{name:'<svg>'}});
 assert.doesNotMatch(hostile,/<script>|<img>|<svg>/);assert.match(hostile,/&lt;script&gt;/);
});

test('opening a board with published history queues it, while legacy eliminated players and redundant outcomes stay coherent',()=>{
 const s=board(),q=new PresenterCues();s.players[0].status='Banished';q.update(s);
 assert.equal(q.presented.size,0);assert.equal(q.pending.length,1);q.next();q.complete();
 s.reveals.push(outcome('repeat','harry','Murdered',{redundant:true}));q.update(s);
 assert.equal(q.pending.length,1);assert.equal(q.next().type,'outcome');assert.match(presenterScene(q.active),/No further elimination/);q.complete();
 const fresh=new PresenterCues();fresh.update(s);assert.equal(fresh.pending.length,2);
});

test('left clicks and common forward clicker keys advance; held keys, double clicks, links and editing do not',()=>{
 const handlers=new Map(),doc={hidden:false,addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
 let advances=0,prevented=0;const dispose=installPresenterControls(doc,()=>advances++);
 const key=(value,extra={})=>handlers.get('keydown')({key:value,preventDefault:()=>prevented++,...extra});
 for(const value of ['PageDown','ArrowRight','ArrowDown',' ','Enter','n','N'])key(value);
 assert.equal(advances,7);assert.equal(prevented,7);
 key('PageDown',{repeat:true});key('ArrowLeft');key('Escape');key('PageDown',{ctrlKey:true});assert.equal(advances,7);
 const input={closest:()=>({hasAttribute:()=>false})};key('Enter',{target:input});assert.equal(advances,7);
 const click=extra=>handlers.get('click')({button:0,detail:1,...extra});
 click({});click({button:2});click({detail:2});click({target:input});assert.equal(advances,8);
 const marker={closest:()=>({hasAttribute:name=>name==='data-presenter-next'})};click({target:marker});assert.equal(advances,9);
 doc.hidden=true;click({});key('PageDown');assert.equal(advances,9);dispose();assert.equal(handlers.size,0);
});
