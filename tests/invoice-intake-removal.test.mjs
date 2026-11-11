import test from 'node:test';
import assert from 'node:assert/strict';
import {managementFixture} from './management-fixture.mjs';
test('intake removal enforces roles, preserves tombstones, stops stale imports and reverses booked cost only once',async()=>{
 const {db,ids,asUser}=await managementFixture();try{
 await db.query("update profiles set role='invoice_clerk' where id=$1",[ids[4]]);
 const inv=(await db.query("insert into investments(name,client_id) values('Test',$1) returning id",[ids[2]])).rows[0].id;
 const action=(id,op,data={})=>db.query('select invoice_intake_action($1,$2,$3) as item',[id,op,JSON.stringify(data)]).then(r=>r.rows[0].item);
 const remove=id=>db.query('select remove_intake_invoice($1) as result',[id]).then(r=>r.rows[0].result);
 const source={drive_file_id:'source123456',source_version:'1',original_name:'Test.pdf',mime_type:'application/pdf',source_size:20};
 let dismissed,booked;
 await asUser(4,async()=>{dismissed=await action(null,'register',source)});
 for(const role of [2,3,5,6])await asUser(role,async()=>assert.rejects(()=>remove(dismissed.id),/Brak uprawnień/));
 await asUser(4,async()=>{
  assert.deepEqual(await remove(dismissed.id),{removed:true,document_removed:false});
  assert.deepEqual(await remove(dismissed.id),{removed:true,document_removed:false});
  const again=await action(null,'register',source);assert.equal(again.id,dismissed.id);assert.ok(again.deleted_at);assert.equal(again.deleted_by,ids[4]);
  for(const op of ['stage','review','reserve','finalize','cleanup'])await assert.rejects(()=>action(dismissed.id,op),/Skan został usunięty/);
 });
 await asUser(0,async()=>{
  await db.query("insert into ledger_entries(investment_id,type,amount,note) values($1,'deposit',1000,'Test')",[inv]);
  booked=await action(null,'register',{...source,drive_file_id:'booked123456'});
  await db.query("insert into storage.objects(bucket_id,name) values('invoice-intake',$1)",[booked.id+'/scan.pdf']);
  await action(booked.id,'stage',{sha256:'b'.repeat(64)});
  await action(booked.id,'review',{invoice_number:'FV/TEST/1',invoice_date:'2026-11-11',gross_amount:123.45,currency:'PLN',auto_book:true});
  booked=await action(booked.id,'reserve',{investment_id:inv});
  await db.query("insert into storage.objects(bucket_id,name) values('portal-documents',$1)",[booked.target_storage_path]);
  booked=await action(booked.id,'finalize',{storage_path:booked.target_storage_path});
 });
 await asUser(4,async()=>assert.rejects(()=>remove(booked.id),/administrator/));
 const expenses=()=>db.query("select coalesce(sum(case when type='expense' then amount else -amount end),0)::float8 as n from ledger_entries where investment_id=$1",[inv]).then(r=>r.rows[0].n);
 assert.equal(await expenses(),-876.55);
 await asUser(0,async()=>{assert.equal((await remove(booked.id)).document_removed,true);await remove(booked.id);await assert.rejects(()=>action(booked.id,'finalize',{storage_path:booked.target_storage_path}),/Skan został usunięty/)});
 assert.equal(await expenses(),-1000);
 const doc=(await db.query('select deleted_at,published from documents where id=$1',[booked.document_id])).rows[0];assert.ok(doc.deleted_at);assert.equal(doc.published,false);
 // Nothing removes the saved file or the Google source; only portal records change.
 assert.equal((await db.query("select * from storage.objects where bucket_id='portal-documents' and name=$1",[booked.target_storage_path])).rows.length,1);
 }finally{await db.close()}
});
