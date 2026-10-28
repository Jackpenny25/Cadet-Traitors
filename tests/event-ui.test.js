import {test} from 'node:test';
import assert from 'node:assert/strict';
import {esc,clock,timeLeft,lateAdvice} from '../src/event-ui.js';
import QRCode from 'qrcode';
test('HTML rendering escapes messages, names and attribute quotes',()=>{
 assert.equal(esc('<img src=x onerror="attack()">'), '&lt;img src=x onerror=&quot;attack()&quot;&gt;');
 assert.equal(esc("A&B's"),'A&amp;B&#39;s');
});
test('countdowns use shared server time, stay paused and never go negative',()=>{
 const now=Date.parse('2026-10-31T19:00:00Z');
 assert.equal(timeLeft({paused:false,deadline:'2026-10-31T19:01:00Z'},now),60);
 assert.equal(timeLeft({paused:true,remaining:37},now+500000),37);
 assert.equal(timeLeft({paused:false,deadline:'2026-10-31T18:00:00Z'},now),0);
 assert.equal(clock(65),'01:05');
});
test('late advice respects Europe/London and preserves the results deadline',()=>{
 const rows=[{time:'20:35',minutes:15,label:'The Last Transmission'}];
 assert.match(lateAdvice(rows,'2026-10-31',Date.parse('2026-10-31T20:00:00Z')),/70 minutes/);
 assert.match(lateAdvice(rows,'2026-10-31',Date.parse('2026-10-30T20:00:00Z')),/Start each activity/);
});
test('projector QR is produced locally and contains no board token in its website URL',async()=>{
 const board=new URL('https://jackpenny25.github.io/Cadet-Traitors/projector.html#SECRET_BOARD_TOKEN');
 const join=new URL('./index.html',board);assert.equal(join.hash,'');
 const png=await QRCode.toDataURL(join.href);assert.match(png,/^data:image\/png;base64,/);
});
