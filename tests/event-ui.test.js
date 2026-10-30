import {test} from 'node:test';
import assert from 'node:assert/strict';
import {esc} from '../src/event-ui.js';
import QRCode from 'qrcode';
test('HTML rendering escapes messages, names and attribute quotes',()=>{
 assert.equal(esc('<img src=x onerror="attack()">'), '&lt;img src=x onerror=&quot;attack()&quot;&gt;');
 assert.equal(esc("A&B's"),'A&amp;B&#39;s');
});
test('projector QR is produced locally and contains no board token in its website URL',async()=>{
 const board=new URL('https://jackpenny25.github.io/Cadet-Traitors/projector.html#SECRET_BOARD_TOKEN');
 const join=new URL('./index.html',board);assert.equal(join.hash,'');
 const png=await QRCode.toDataURL(join.href);assert.match(png,/^data:image\/png;base64,/);
});
