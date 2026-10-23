import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claimName,validateJoin} from '../dist/identity.js';
import {initial,publicData} from '../dist/engine.js';
test('PIN requires exactly four digits and matching confirmation',()=>{
 for(const pin of ['123','12345','abcd','12 3'])assert.throws(()=>validateJoin('Jack',pin,pin));
 assert.throws(()=>validateJoin('Jack','0123','0124'));
 assert.deepEqual(validateJoin(' Jack  P ','0123','0123'),{display:'Jack P',key:'jack p'});
});
test('joining claims a stable player, stores a salted hash, and keeps credentials out of public data',async()=>{
 const s=initial(),result=await claimName(s,'Demo Cadet','0123','0123');
 assert.equal(result.player.name,'Demo Cadet');assert.equal(result.player.id,1);
 assert.equal(s.identities.length,1);assert.notEqual(s.identities[0].hash,'0123');assert.equal(s.identities[0].salt.length,16);
 assert.ok(!JSON.stringify(publicData(s)).includes('nameKey'));assert.ok(!JSON.stringify(publicData(s)).includes('"hash"'));assert.ok(!JSON.stringify(publicData(s)).includes('"salt"'));
 const returning=await claimName(s,'demo cadet','0123','0123');assert.equal(returning.returning,true);assert.equal(returning.player.id,1);
 await assert.rejects(claimName(s,'Demo Cadet','9999','9999'),/already registered/);
 assert.equal(s.identities.length,1);
});
test('new players cannot join after closure but registered players can return',async()=>{
 const s=initial();await claimName(s,'Test','0007','0007');s.joining=false;
 await assert.rejects(claimName(s,'New','0007','0007'),/closed/);
 assert.equal((await claimName(s,'Test','0007','0007')).returning,true);
});
test('failed confirmation cannot rename or claim a player',async()=>{
 const s=initial();await assert.rejects(claimName(s,'Test','0007','0008'),/match/);
 assert.equal(s.players[0].name,'Player 01');assert.equal(s.identities,undefined);
});
test('different players get distinct salts and the same PIN does not create equal hashes',async()=>{
 const s=initial();await claimName(s,'One','1234','1234');await claimName(s,'Two','1234','1234');
 assert.notEqual(s.identities[0].hash,s.identities[1].hash);
});
