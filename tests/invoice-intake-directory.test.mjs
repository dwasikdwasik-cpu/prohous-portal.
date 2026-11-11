import test from 'node:test';import assert from 'node:assert/strict';
import {managementFixture} from './management-fixture.mjs';
test('invoice directory includes the entire CRM, clients without projects and pending accounts without granting login access',async()=>{
 const {db,ids,asUser}=await managementFixture();try{
 await db.query("update profiles set role='invoice_clerk' where id=$1",[ids[4]]);
 const directory=()=>db.query('select * from invoice_intake_directory()').then(r=>r.rows);
 const resolve=ref=>db.query('select resolve_invoice_client($1) as id',[ref]).then(r=>r.rows[0].id);
 for(let n=1;n<=119;n++)await db.query("insert into ph_records(id,kind,data,archived) values($1,'clients',$2,0)",['crm-'+n,JSON.stringify({name:'Klient '+n})]);
 await db.query("insert into ph_records(id,kind,data,archived) values('archived','clients','{\"name\":\"Archived\"}',1),('offer','offers','{}',0)");
 await db.query("update profiles set role='client',status='pending' where id=$1",[ids[6]]);
 for(const role of [2,3,5,6])await asUser(role,async()=>{await assert.rejects(directory,/Brak uprawnień/);await assert.rejects(()=>resolve('crm:crm-1'),/Brak uprawnień/)});
 await asUser(4,async()=>{
  let list=await directory();assert.equal(list.length,121);assert.equal(list.filter(t=>t.client_source==='Kartoteka klientów').length,119);
  assert.equal(list.find(t=>t.client_ref==='profile:'+ids[6]).assignable,false);
  await assert.rejects(()=>resolve('profile:'+ids[6]),/zatwierdzenia/);
  await assert.rejects(()=>resolve('crm:archived'),/aktywny/);await assert.rejects(()=>resolve('crm:offer'),/aktywny/);
  const target=await resolve('crm:crm-1');assert.equal(await resolve('crm:crm-1'),target);
  list=await directory();assert.equal(list.find(t=>t.client_ref==='crm:crm-1').investment_id,target);
  const invoice=(await db.query("select invoice_intake_action(null,'register',$1) as q",[JSON.stringify({drive_file_id:'source123456',source_version:'1',original_name:'Test.pdf',mime_type:'application/pdf',source_size:20})])).rows[0].q;
  await db.query("insert into storage.objects(bucket_id,name) values('invoice-intake',$1)",[invoice.id+'/scan.pdf']);
  const call=(op,data)=>db.query('select invoice_intake_action($1,$2,$3) as q',[invoice.id,op,JSON.stringify(data)]).then(r=>r.rows[0].q);
  await call('stage',{sha256:'a'.repeat(64)});await call('review',{investment_id:target,invoice_number:'FV/1',invoice_date:'2026-11-11',gross_amount:100,currency:'PLN',auto_book:true});
  const reserved=await call('reserve',{investment_id:target});await db.query("insert into storage.objects(bucket_id,name) values('portal-documents',$1)",[reserved.target_storage_path]);
  const saved=await call('finalize',{storage_path:reserved.target_storage_path});assert.ok(saved.document_id);
  assert.equal((await db.query('select auto_book from documents where id=$1',[saved.document_id])).rows[0].auto_book,false);
  assert.equal((await db.query('select * from ledger_entries')).rows.length,0);
  assert.equal(await resolve('profile:'+ids[2]),await resolve('profile:'+ids[2]));
 });
 assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,8);
 assert.equal((await db.query("select count(*)::int as n from investments where crm_client_id='crm-1'")).rows[0].n,1);
 }finally{await db.close()}
});
