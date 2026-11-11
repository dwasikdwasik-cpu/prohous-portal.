import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {managementFixture} from './management-fixture.mjs';
test('learning stores explicit saved corrections, restricts operators and cannot be overwritten by automatic rereads',async()=>{
 const {db,ids,asUser}=await managementFixture();
 try{
  await db.exec(fs.readFileSync('supabase/migrations/20261111201134_invoice_intake_learning.sql','utf8'));
  await db.query("update profiles set role='invoice_clerk' where id=$1",[ids[4]]);
  const inv=(await db.query("insert into investments(name,client_id) values('Test',$1) returning id",[ids[2]])).rows[0].id;
  const action=(id,op,data={})=>db.query('select invoice_intake_action($1,$2,$3) as item',[id,op,JSON.stringify(data)]).then(r=>r.rows[0].item);
  const learn=(id,op,data={})=>db.query('select invoice_learning_action($1,$2,$3) as result',[id,op,JSON.stringify(data)]).then(r=>r.rows[0].result);
  let q;
  await asUser(4,async()=>{
   q=await action(null,'register',{drive_file_id:'learning123456',source_version:'1',original_name:'Test.pdf',mime_type:'application/pdf',source_size:20});
   await assert.rejects(()=>learn(q.id,'observe',{text:'Test',values:{}}),/Najpierw pobierz/);
   await db.query("insert into storage.objects(bucket_id,name) values('invoice-intake',$1)",[q.id+'/scan.pdf']);
   q=await action(q.id,'stage',{sha256:'c'.repeat(64)});
   await assert.rejects(()=>learn(q.id,'confirm'),/Najpierw zapisz/);
   await learn(q.id,'observe',{text:'Sprzedawca\nNIP 1234567890\nŁącznie: 123,45',values:{gross_amount:null},supplier_key:'1234567890'});
   await assert.rejects(()=>db.query("update invoice_reading_feedback set corrected_values='{}'"),/permission denied/);
   await assert.rejects(()=>learn(q.id,'observe',{text:'x'.repeat(60001),values:{}}),/Nieprawidłowy/);
   await action(q.id,'review',{investment_id:inv,invoice_number:'FV/1',invoice_date:'2026-11-11',gross_amount:123.45,currency:'PLN',auto_book:false});
   q=await action(q.id,'reserve',{investment_id:inv});
   await db.query("insert into storage.objects(bucket_id,name) values('portal-documents',$1)",[q.target_storage_path]);
   q=await action(q.id,'finalize',{storage_path:q.target_storage_path});
   // Request values cannot replace the actual saved document values.
   await learn(q.id,'confirm',{gross_amount:99999});await learn(q.id,'confirm');
   const feedback=(await db.query('select * from invoice_reading_feedback')).rows;
   assert.equal(feedback.length,1);assert.equal(feedback[0].corrected_values.gross_amount,123.45);
   assert.equal(feedback[0].original_values.gross_amount,null);assert.equal(feedback[0].confirmed_by,ids[4]);
   await assert.rejects(()=>learn(q.id,'observe',{text:'overwrite',values:{}}),/już zapisana/);
  });
  for(const i of [2,3,5,6])await asUser(i,async()=>{
   assert.equal((await db.query('select * from invoice_reading_feedback')).rows.length,0);
   await assert.rejects(()=>learn(q.id,'confirm'),/Brak uprawnień/);
  });
  await asUser(0,async()=>{await db.query('select remove_intake_invoice($1)',[q.id]);assert.equal((await db.query('select * from invoice_reading_feedback')).rows.length,0);await assert.rejects(()=>learn(q.id,'confirm'),/aktywnego skanu/)});
 }finally{await db.close()}
});
