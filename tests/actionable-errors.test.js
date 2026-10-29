import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionableError} from '../src/event-errors.js';

test('creation errors identify the actual count to correct without an event snapshot',()=>{
 const error=new Error('Check group sizes, role counts and event title.');
 assert.match(actionableError(error,'create',{title:'Rehearsal',size:2,traitors:2}),/at least 3 Players per group/);
 assert.match(actionableError(error,'create',{title:'Rehearsal',size:26,traitors:2}),/2 to 25.*100 players/);
 assert.match(actionableError(error,'create',{title:'   ',size:13,traitors:2}),/event name/);
});

test('manual vote errors distinguish self voting from crossing groups',()=>{
 const state={organiser:true,groups:[],players:[{id:'a',group:'one'},{id:'b',group:'two'}]};
 const error=new Error('Choose an eligible active player in this group, without self voting.');
 assert.match(actionableError(error,'proxy_vote',{group:'one',voter:'a',target:'a'},state),/cannot vote for themselves.*different active player/);
 assert.match(actionableError(error,'proxy_vote',{group:'one',voter:'a',target:'b'},state),/both belong to the selected Group/);
});

test('an unavailable deployed command gives an update path and preserves unrelated security errors',()=>{
 assert.match(actionableError(new Error('Unknown event command.'),'apply_mission_plan'),/database update.*not saved/);
 assert.match(actionableError(new Error('Confirm the selected event title and mission plan.'),'apply_mission_plan',{}, {title:'QA rehearsal'}),/exact selected event title: QA rehearsal/);
 assert.equal(actionableError(new Error('Only the main host can do that.'),'delete_event'), 'Only the main host can do that.');
});
