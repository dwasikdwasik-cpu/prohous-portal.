import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupScanBatch} from '../lib/invoice-intake-batch.mjs';
test('bulk cleanup only processes imported active scans, one at a time, and continues after individual failures',async()=>{
 const items=[{id:'queued',status:'queued'},{id:'no-copy',status:'imported'},{id:'deleted',status:'imported',document_id:'doc',deleted_at:'date'},...['ok','changed','denied','ok2'].map(id=>({id,status:'imported',document_id:'doc'})),{id:'done',status:'complete',document_id:'doc'}];
 const calls=[],results=[];let active=false;
 const result=await cleanupScanBatch(items,async item=>{
  assert.equal(active,false);active=true;calls.push(item.id);await Promise.resolve();active=false;
  if(item.id==='denied')throw Error('Brak uprawnień');
  return {cleaned:item.id!=='changed',error:item.id==='changed'?'Skan zmienił się':undefined};
 },(item,result)=>results.push({id:item.id,...result}));
 assert.deepEqual(calls,['ok','changed','denied','ok2']);assert.deepEqual(result,{cleaned:2,failed:2,total:4});
 assert.equal(results[1].error,'Skan zmienił się');assert.equal(results[2].error,'Brak uprawnień');
});
test('empty cleanup does not call the removal service',async()=>{
 assert.deepEqual(await cleanupScanBatch([],()=>assert.fail('unexpected deletion')),{cleaned:0,failed:0,total:0});
});
