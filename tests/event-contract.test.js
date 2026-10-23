import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lobbySnapshot,eventSnapshot,boardSnapshot} from '../src/event-contract.js';

test('incompatible dashboard and projector payloads fail with an actionable version error',()=>{
 const legacy={id:'event',host:true,groups:[],players:[],games:[]};
 for(const validate of [lobbySnapshot,eventSnapshot,boardSnapshot])assert.throws(()=>validate(legacy),error=>error.code==='TNO_RUNTIME_MISMATCH'&&/already be saved/.test(error.message));
});

test('an incomplete organiser response cannot reach map calls in Setup',()=>{
 const value={id:'event',host:true,organiser:true,server_now:new Date().toISOString(),groups:[{id:'g',phase:'Joining',paused:true,remaining:600}],players:[],missions:[],timetable:[],scores:[],reveals:[],windows:[],messages:[],helps:[],audit:[],nco_permissions:[],staff:[]};
 assert.equal(eventSnapshot(value),value);
 for(const key of ['staff','nco_permissions','missions','groups']){
  const missing={...value};delete missing[key];assert.throws(()=>eventSnapshot(missing),{code:'TNO_RUNTIME_MISMATCH'});
 }
});
