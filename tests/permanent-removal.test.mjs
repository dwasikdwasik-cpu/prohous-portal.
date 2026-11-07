import test from 'node:test';import assert from 'node:assert/strict';import {managementFixture} from './management-fixture.mjs';

test('permanent account deletion is admin-only, race guarded, revokes sessions and preserves investment files and finances',async()=>{
 const {db,ids,sessions,asUser,asService}=await managementFixture();try{
 const inv=(await db.query("insert into investments(name,client_id) values('Keep',$1) returning id",[ids[2]])).rows[0].id;
 const path=inv+'/20000000-0000-0000-0000-000000000001.pdf';
 await db.query("insert into storage.objects(bucket_id,name,owner_id,owner,metadata) values('portal-documents',$1,$2::text,$2::uuid,'{}')",[path,ids[2]]);
 const doc=(await db.query("insert into documents(investment_id,title,category,storage_path,published,uploaded_by) values($1,'Keep','projekty',$2,true,$3) returning id",[inv,path,ids[2]])).rows[0].id;
 await db.query("insert into ledger_entries(investment_id,type,amount,created_by) values($1,'deposit',100,$2)",[inv,ids[2]]);
 await db.query('insert into document_downloads(user_id,document_id) values($1,$2)',[ids[2],doc]);
 const request=(id,email)=>db.query('select public.request_portal_account_removal($1,$2)',[id,email]);
 for(const i of [1,2,3,4,5,6])await asUser(i,()=>assert.rejects(()=>request(ids[2],'person2@test.invalid'),/administrator/));
 await asUser(0,async()=>{
  await assert.rejects(()=>request(ids[0],'person0@test.invalid'),/nie można/);
  await assert.rejects(()=>request(ids[7],'person7@test.invalid'),/nie można/);
  await assert.rejects(()=>request(ids[1],'person1@test.invalid'),/nie można/);
  await assert.rejects(()=>request(ids[2],'wrong@test.invalid'),/dokładny/);
  await request(ids[2],'person2@test.invalid');
 });
 assert.equal((await db.query('select owner_id from storage.objects where name=$1',[path])).rows[0].owner_id,null);
 await db.query("update profiles set role='admin' where id=$1",[ids[2]]);
 await asService(()=>assert.rejects(()=>db.query('delete from auth.users where id=$1',[ids[2]]),/zmieniły/));
 await db.query("update profiles set role='client' where id=$1",[ids[2]]);
 await db.query('delete from auth.sessions where id=$1',[sessions[0]]);
 await asService(()=>assert.rejects(()=>db.query('delete from auth.users where id=$1',[ids[2]]),/uprawnień/));
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sessions[0],ids[0]]);
 await asUser(0,()=>request(ids[2],'person2@test.invalid'));
 await asService(()=>db.query('delete from auth.users where id=$1',[ids[2]]));
 assert.equal((await db.query('select * from auth.sessions where user_id=$1',[ids[2]])).rows.length,0);
 assert.equal((await db.query('select * from profiles where id=$1',[ids[2]])).rows.length,0);
 assert.equal((await db.query('select client_id from investments where id=$1',[inv])).rows[0].client_id,null);
 assert.equal((await db.query('select uploaded_by from documents where id=$1',[doc])).rows[0].uploaded_by,null);
 const ledger=(await db.query('select amount,created_by from ledger_entries where investment_id=$1',[inv])).rows[0];assert.equal(Number(ledger.amount),100);assert.equal(ledger.created_by,null);
 assert.equal((await db.query('select * from storage.objects where name=$1',[path])).rows.length,1);
 assert.equal((await db.query('select user_id from document_downloads where document_id=$1',[doc])).rows[0].user_id,null);
 assert.ok((await db.query('select completed_at from private.account_removal_requests where user_id=$1',[ids[2]])).rows[0].completed_at);
 await asService(()=>db.query('select public.bind_project_employee($1)',[ids[5]]));
 await db.query("update private.project_employee_login set pin_hash='1234'");
 await asUser(0,()=>request(ids[5],'pracownik@prohous.pl'));
 await asService(()=>db.query('delete from auth.users where id=$1',[ids[5]]));
 const config=(await db.query('select pin_hash,user_id from private.project_employee_login')).rows[0];assert.equal(config.pin_hash,null);assert.equal(config.user_id,null);
 }finally{await db.close()}
});

test('investment purge requires trash, exact name, admin and server cleanup; protects concurrent edits and cascades only its own data',async()=>{
 const {db,ids,sessions,asUser,asService}=await managementFixture();try{
 const inv=(await db.query("insert into investments(name) values('Purge') returning id")).rows[0].id;
 const other=(await db.query("insert into investments(name) values('Keep') returning id")).rows[0].id;
 const path=inv+'/20000000-0000-0000-0000-000000000001.pdf';
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('portal-documents',$1,$2,'{}')",[path,ids[0]]);
 const doc=(await db.query("insert into documents(investment_id,title,category,storage_path,published) values($1,'Project','projekty',$2,true) returning id",[inv,path])).rows[0].id;
 await db.query('insert into document_downloads(user_id,document_id) values($1,$2)',[ids[0],doc]);
 const invoice=(await db.query("insert into documents(investment_id,title,category,drive_file_id,published) values($1,'Invoice','faktury','invoice',true) returning id",[inv])).rows[0].id;
 await db.query("insert into purchases(investment_id,name,quantity,unit_price,invoice_document_id) values($1,'Item',1,10,$2)",[inv,invoice]);
 await asUser(0,async()=>{
  await db.query("insert into ledger_entries(investment_id,type,amount) values($1,'deposit',50)",[inv]);
  await db.query("update documents set invoice_number='FV/PURGE',invoice_date='2026-11-07',gross_amount=10,currency='PLN',auto_book=true where id=$1",[invoice]);
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[invoice]);
  await db.query('update documents set deleted_at=null where id=$1',[invoice]);
  await db.query('select public.set_portal_balance($1,22,40)',[inv]);
 });
 const start=name=>db.query('select public.start_portal_investment_removal($1,$2) paths',[inv,name]);
 await asUser(0,()=>assert.rejects(()=>start('Purge'),/Najpierw/));
 await asUser(0,()=>db.query('update investments set deleted_at=now() where id=$1',[inv]));
 for(const i of [1,2,3,4,5])await asUser(i,()=>assert.rejects(()=>start('Purge'),/administrator/));
 await asUser(0,async()=>{
  await assert.rejects(()=>start('wrong'),/dokładną/);
  assert.deepEqual((await start('Purge')).rows[0].paths,[path]);
  assert.deepEqual((await start('Purge')).rows[0].paths,[path]);
  await assert.rejects(()=>db.query('update investments set deleted_at=null where id=$1',[inv]),/usuwanie/);
  await assert.rejects(()=>db.query("update documents set title='Changed' where id=$1",[doc]),/usuwanie/);
  await assert.rejects(()=>db.query("insert into ledger_entries(investment_id,type,amount) values($1,'deposit',10)",[inv]),/usuwanie/);
  await assert.rejects(()=>db.query('select public.finish_portal_investment_removal($1,$2,$3)',[inv,ids[0],sessions[0]]),/permission denied/);
 });
 const finish=(actor,session)=>db.query('select public.finish_portal_investment_removal($1,$2,$3)',[inv,actor,session]);
 await asService(()=>assert.rejects(()=>finish(ids[1],sessions[1]),/uprawnień/));
 await asService(()=>assert.rejects(()=>finish(ids[0],sessions[0]),/Pliki oczekują/));
 await asService(()=>db.query('delete from storage.objects where name=$1',[path]));
 await asService(()=>finish(ids[0],sessions[0]));
 assert.equal((await db.query('select * from investments where id=$1',[inv])).rows.length,0);
 for(const table of ['documents','ledger_entries','purchases','private.balance_adjustments'])assert.equal((await db.query('select * from '+table+' where investment_id=$1',[inv])).rows.length,0,table);
 assert.equal((await db.query('select * from document_downloads where document_id=$1',[doc])).rows.length,0);
 assert.equal((await db.query('select * from investments where id=$1',[other])).rows.length,1);
 assert.ok((await db.query('select completed_at from private.investment_removal_audit where investment_id=$1',[inv])).rows[0].completed_at);
 }finally{await db.close()}
});
