import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureFormDrafts,restoreFormDrafts} from '../src/form-drafts.js';

test('failed saves preserve event fields and choices while PINs, files and stale records remain untouched',()=>{
 const field=(name,value,type='text')=>({name,value,type,tagName:'INPUT'});
 const create={dataset:{form:'create',args:'{"practice":true}'},elements:[field('title','QA rehearsal'),field('date','2026-10-29','date'),field('size','2','number'),field('pin','PRIVATE','password'),field('pack','private.json','file'),{...field('shields','on','checkbox'),checked:true}]};
 const root={querySelectorAll:()=>[create]};const drafts=captureFormDrafts(root);
 assert.doesNotMatch(JSON.stringify([...drafts]),/PRIVATE|private\.json/);
 for(const control of create.elements){control.value='';control.checked=false;}
 restoreFormDrafts(root,drafts);
 assert.equal(create.elements[0].value,'QA rehearsal');assert.equal(create.elements[1].value,'2026-10-29');assert.equal(create.elements[2].value,'2');assert.equal(create.elements[3].value,'');assert.equal(create.elements[4].value,'');assert.equal(create.elements[5].checked,true);
 create.dataset.args='{"practice":false}';create.elements[0].value='Different event';restoreFormDrafts(root,drafts);assert.equal(create.elements[0].value,'Different event');
});
