import test from 'node:test';import assert from 'node:assert/strict';
import {matchInvoiceClient,cleanupImportedScan,validateScan,INVOICE_INBOX_FOLDER,confirmInboxMetadata} from '../lib/invoice-intake.mjs';
import {managementFixture} from './management-fixture.mjs';
const targets=[{investment_id:'a',client_name:'Anna Kowalska',investment_name:'Swojczycka 12'},{investment_id:'b',client_name:'Piotr Nowak',investment_name:'Opatowicka 45'}];
test('only a unique full client/investment name in filename or delivery section assigns automatically',()=>{
 assert.equal(matchInvoiceClient({filename:'FV_Anna_Kowalska.pdf'},targets).investment_id,'a');
 assert.equal(matchInvoiceClient({text:'Sprzedawca\nAnna Kowalska\nPodsumowanie'},targets).automatic,false);
 assert.equal(matchInvoiceClient({text:'Miejsce dostawy: Opatowicka 45\nWroclaw\nPodsumowanie'},targets).investment_id,'b');
 assert.equal(matchInvoiceClient({filename:'Anna Kowalska i Piotr Nowak.pdf'},targets).automatic,false);
 assert.equal(matchInvoiceClient({filename:'FV_2026.pdf'},targets).automatic,false);
 assert.equal(matchInvoiceClient({filename:'Anna Kowalska.pdf'},[...targets,{investment_id:'c',client_name:'Anna Kowalska',investment_name:'Inny adres'}]).automatic,false);
});
const scan={id:'scan',document_id:'doc',assigned_investment_id:'investment',target_storage_path:'investment/copy.pdf',content_sha256:'abc',drive_file_id:'drive123456',source_version:'1'};
function fixture(){const calls=[];let trashed=false;return {calls,
 document:async()=>({id:'doc',source_intake_id:'scan',investment_id:'investment',storage_path:'investment/copy.pdf',content_sha256:'abc',published:true}),
 sourceHash:async()=>'abc',destinationHash:async()=>{calls.push('verify');return 'abc'},metadata:async()=>({parents:[INVOICE_INBOX_FOLDER],mimeType:'application/pdf',size:20,version:'1',trashed,etag:'etag-1'}),
 remove:async(id,etag)=>{assert.equal(etag,'etag-1');calls.push('trash');trashed=true;return {removed:true}}
};}
for(const condition of ['missing doc','wrong client','copy mismatch','source mismatch','changed source','missing ETag'])test(condition+' prevents source removal',async()=>{const f=fixture();if(condition==='missing doc')f.document=async()=>null;if(condition==='wrong client')f.document=async()=>({investment_id:'other'});if(condition==='copy mismatch')f.destinationHash=async()=>'wrong';if(condition==='source mismatch')f.sourceHash=async()=>'original-differs';if(condition==='changed source')f.metadata=async()=>({parents:[INVOICE_INBOX_FOLDER],mimeType:'application/pdf',size:20,version:'2'});if(condition==='wrong folder')f.metadata=async()=>({parents:['other']});if(condition==='missing ETag')f.metadata=async()=>({parents:[INVOICE_INBOX_FOLDER],mimeType:'application/pdf',size:20,version:'1'});await assert.rejects(()=>cleanupImportedScan(scan,f));assert.ok(!f.calls.includes('trash'));});
test('a file already moved out of the scanner folder is not modified',async()=>{const f=fixture();f.metadata=async()=>({parents:['other']});const r=await cleanupImportedScan(scan,f);assert.equal(r.alreadyRemoved,true);assert.deepEqual(f.calls,['verify'])});
test('source removal occurs only after reading back assigned copy and is idempotent',async()=>{const f=fixture();await cleanupImportedScan(scan,f);assert.deepEqual(f.calls,['verify','trash']);await cleanupImportedScan(scan,f);assert.deepEqual(f.calls,['verify','trash','verify']);});
test('permission failure keeps the original and can be retried',async()=>{const f=fixture();f.remove=async()=>{throw Error('permission denied')};await assert.rejects(()=>cleanupImportedScan(scan,f),/permission denied/);assert.deepEqual(f.calls,['verify']);});
test('intake permissions, private objects and transactional/idempotent assignment',async()=>{
 const {db,ids,asUser}=await managementFixture();try{
 await db.query("update profiles set role='invoice_clerk' where id=$1",[ids[4]]);
 const inv=(await db.query("insert into investments(name,client_id) values('Swojczycka 12',$1) returning id",[ids[2]])).rows[0].id;
 const call=(id,action,data={})=>db.query('select invoice_intake_action($1,$2,$3) as item',[id,action,JSON.stringify(data)]).then(r=>r.rows[0].item);
 for(const i of [2,3,5,6])await asUser(i,async()=>{assert.equal((await db.query('select * from invoice_intake')).rows.length,0);await assert.rejects(()=>call(null,'register',{}),/Brak uprawnień/);await assert.rejects(()=>db.query('select * from invoice_intake_targets()'),/Brak uprawnień/)});
 await asUser(4,async()=>{
 assert.equal((await db.query('select * from invoice_intake_targets()')).rows.length,1);
 assert.equal((await db.query('select * from ledger_entries')).rows.length,0);
 await assert.rejects(()=>db.query('select get_portal_balance($1)',[inv]),/uprawnień/);
 const data={drive_file_id:'drive123456',source_version:'1',original_name:'Invoice.pdf',mime_type:'application/pdf',source_size:20};
 let q=await call(null,'register',data);assert.equal((await call(null,'register',data)).id,q.id);
 await assert.rejects(()=>call(q.id,'finalize'),/Przypisanie|Niekompletny/);
 await db.query("insert into storage.objects(bucket_id,name) values('invoice-intake',$1)",[q.id+'/scan.pdf']);
 q=await call(q.id,'stage',{sha256:'a'.repeat(64)});
 q=await call(q.id,'review',{investment_id:inv,invoice_number:'FV/1',invoice_date:'2026-11-11',gross_amount:100,currency:'PLN',auto_book:true});
 q=await call(q.id,'reserve',{investment_id:inv});
 await assert.rejects(()=>call(q.id,'finalize',{storage_path:q.target_storage_path}),/Brak pliku/);
 await db.query("insert into storage.objects(bucket_id,name) values('portal-documents',$1)",[q.target_storage_path]);
 await assert.rejects(()=>call(q.id,'finalize',{storage_path:'stale'}),/Przypisanie/);
 q=await call(q.id,'finalize',{storage_path:q.target_storage_path});
 const repeat=await call(q.id,'finalize',{storage_path:q.target_storage_path});assert.equal(repeat.document_id,q.document_id);
 const doc=(await db.query('select * from documents where id=$1',[q.document_id])).rows[0];assert.equal(doc.investment_id,inv);assert.equal(doc.auto_book,false);assert.equal(doc.published,true);
 assert.equal((await db.query('select * from ledger_entries')).rows.length,0);
 assert.equal((await db.query('select * from documents')).rows.length,1);
 assert.equal((await db.query("update invoice_intake set document_id=null where id=$1 returning id",[q.id])).rows.length,0);
 await call(q.id,'cleanup',{error:'No write access'});assert.equal((await db.query('select status from invoice_intake where id=$1',[q.id])).rows[0].status,'imported');
 });
 await asUser(2,async()=>assert.equal((await db.query('select * from invoice_intake')).rows.length,0));
 }finally{await db.close()}
});

// Real shared-file regression: metadata can omit parent links even though the folder lists the file.
test('shared-file membership and version are proven from all inbox pages before staging',async()=>{
 const calls=[];const meta={id:'file',mimeType:'application/pdf',size:20};
 const confirmed=await confirmInboxMetadata('file',meta,async token=>{calls.push(token);return token?{files:[{id:'file',version:'3'}]}:{files:[],nextPageToken:'page2'}});
 assert.equal(validateScan(confirmed),'pdf');assert.equal(confirmed.version,'3');assert.deepEqual(calls,[null,'page2']);
});
test('folder confirmation never accepts an absent, moved or changed source',async()=>{
 const meta={id:'file',mimeType:'application/pdf',size:20,version:'3'};
 const missing=await confirmInboxMetadata('file',meta,async()=>({files:[{id:'other'}]}));assert.throws(()=>validateScan(missing),/nie należy/);
 await assert.rejects(()=>confirmInboxMetadata('file',meta,async()=>({files:[{id:'file',version:'4'}]})),/zmienił/);
 await assert.rejects(()=>confirmInboxMetadata('file',meta,async()=>{throw Error('denied')}),/denied/);
});
