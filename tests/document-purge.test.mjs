import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {managementFixture} from './management-fixture.mjs';
import {createRemovalHandler} from '../supabase/functions/portal-permanent-removal/handler.mjs';
test('document purge requires admin, trash and exact confirmation; preserves accounting and blocks restore until storage cleanup',async()=>{
 const {db,ids,sessions,asUser,asService}=await managementFixture();try{
 await db.exec(fs.readFileSync('supabase/migrations/20261111201134_invoice_intake_learning.sql','utf8'));
 const inv=(await db.query("insert into investments(name) values('Keep') returning id")).rows[0].id;
 const doc=(await db.query("insert into documents(investment_id,title,category,storage_path,published) values($1::uuid,'Invoice','faktury',$1::uuid::text||'/20000000-0000-0000-0000-000000000001.pdf',true) returning *",[inv])).rows[0];
 const other=(await db.query("insert into documents(investment_id,title,category,drive_file_id) values($1,'Other','projekty','other') returning id",[inv])).rows[0].id;
 await db.query("insert into storage.objects(bucket_id,name) values('portal-documents',$1)",[doc.storage_path]);
 const scan=(await db.query("insert into invoice_intake(drive_file_id,source_version,original_name,mime_type,source_size,document_id,content_sha256,status) values('purgescan1234','1','Scan.pdf','application/pdf',20,$1,$2,'complete') returning id",[doc.id,'c'.repeat(64)])).rows[0].id;
 const scanPath=scan+'/scan.pdf';
 await db.query('update invoice_intake set staged_path=$2 where id=$1',[scan,scanPath]);
 await db.query('update documents set source_intake_id=$2 where id=$1',[doc.id,scan]);
 await db.query("insert into storage.objects(bucket_id,name) values('invoice-intake',$1)",[scanPath]);
 await db.query('insert into invoice_reading_feedback(intake_id,content_sha256) values($1,$2)',[scan,'c'.repeat(64)]);

 await db.query("insert into purchases(investment_id,name,quantity,unit_price,invoice_document_id) values($1,'Item',1,100,$2)",[inv,doc.id]);
 const start=(name='Invoice')=>db.query('select start_portal_document_removal($1,$2) as paths',[doc.id,name]).then(r=>r.rows[0].paths);
 const finish=(actor=ids[0],session=sessions[0])=>db.query('select finish_portal_document_removal($1,$2,$3)',[doc.id,actor,session]);
 await asUser(0,async()=>{
  await db.query("update documents set invoice_number='FV/PURGE',invoice_date='2026-11-11',gross_amount=100,currency='PLN',auto_book=true where id=$1",[doc.id]);
  await assert.rejects(()=>start(),/kosza/);
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[doc.id]);
  await assert.rejects(()=>start('wrong'),/dokładną/);
 });
 const balance=async()=>Number((await db.query("select coalesce(sum(case when type='expense' then -amount else amount end),0) as amount from ledger_entries where investment_id=$1",[inv])).rows[0].amount);
 assert.equal(await balance(),0);
 for(const i of [1,2,3,4,5,6])await asUser(i,()=>assert.rejects(()=>start(),/administrator/));
 await asUser(0,async()=>{
  assert.deepEqual(await start(),{document_paths:[doc.storage_path],scan_paths:[scanPath]});
  await assert.rejects(()=>db.query('update documents set deleted_at=null where id=$1',[doc.id]),/usuwanie/);
  await assert.rejects(()=>db.query("update documents set title='Changed' where id=$1",[doc.id]),/usuwanie/);
  await assert.rejects(()=>finish(),/permission denied/);
 });
 await asService(()=>assert.rejects(()=>finish(ids[1],sessions[1]),/uprawnień/));
 await asService(()=>assert.rejects(()=>finish(),/Pliki/));
 await asService(()=>db.query('delete from storage.objects where bucket_id=$1 and name=$2',['portal-documents',doc.storage_path]));
 await asService(()=>assert.rejects(()=>finish(),/Pliki/));
 await asService(()=>db.query('delete from storage.objects where bucket_id=$1 and name=$2',['invoice-intake',scanPath]));
 await asService(()=>finish());await asService(()=>finish());
 const tombstone=(await db.query('select * from invoice_intake where id=$1',[scan])).rows[0];
 assert.ok(tombstone.deleted_at);assert.equal(tombstone.document_id,null);assert.equal(tombstone.staged_path,null);
 assert.equal((await db.query('select * from invoice_reading_feedback where intake_id=$1',[scan])).rows.length,0);
 assert.equal((await db.query('select * from documents where id=$1',[doc.id])).rows.length,0);
 assert.equal((await db.query('select * from documents where id=$1',[other])).rows.length,1);
 assert.equal((await db.query('select invoice_document_id from purchases where investment_id=$1',[inv])).rows[0].invoice_document_id,null);
 assert.equal((await db.query('select * from ledger_entries where investment_id=$1',[inv])).rows.length,2);
 assert.equal(await balance(),0);
 assert.ok((await db.query('select completed_at from private.document_removal_audit where document_id=$1',[doc.id])).rows[0].completed_at);
 await asUser(0,async()=>assert.deepEqual(await start(),{document_paths:[],scan_paths:[]}));
 // Drive originals remain external; the portal tombstone prevents silent reimport.
 await asUser(0,async()=>{
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[other]);
  const result=await db.query('select start_portal_document_removal($1,$2)',[other,'Other']);assert.ok(result.rows.length);
 });
 await asService(()=>db.query('select finish_portal_document_removal($1,$2,$3)',[other,ids[0],sessions[0]]));
 const resurrect=await db.query("insert into documents(investment_id,title,category,drive_file_id) values($1,'Other renamed','projekty','other') returning id",[inv]);
 assert.equal(resurrect.rows.length,0);

 }finally{await db.close()}
});
test('handler cleans only server-selected portal and staged paths before finalizing, and never finalizes a failed storage removal',async()=>{
 const id='00000000-0000-0000-0000-000000000001',calls=[];
 const services={authorize:async()=>({id:'admin'}),startDocument:async()=>({document_paths:['document.pdf'],scan_paths:['scan.pdf']}),removeFiles:async paths=>calls.push(['documents',paths]),removeScans:async paths=>calls.push(['scans',paths]),finishDocument:async()=>calls.push(['finish'])};
 const request=()=>new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer valid'},body:JSON.stringify({action:'document',id,confirmation:'Invoice',paths:['untrusted.pdf']})});
 assert.equal((await createRemovalHandler(services)(request())).status,200);
 assert.deepEqual(calls,[['documents',['document.pdf']],['scans',['scan.pdf']],['finish']]);
 calls.length=0;
 assert.equal((await createRemovalHandler({...services,removeScans:async()=>{throw Error('storage failure')}})(request())).status,409);
 assert.deepEqual(calls,[['documents',['document.pdf']]]);
});
