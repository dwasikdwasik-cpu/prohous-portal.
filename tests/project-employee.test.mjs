import test from 'node:test';import assert from 'node:assert/strict';
import {managementFixture} from './management-fixture.mjs';import {portalAccessAllowed} from '../lib/portal-access.mjs';

test('project employees can read published nonfinancial projects for all active investments and cannot administer or access finances/photos',async()=>{
 const {db,ids,asUser,asService}=await managementFixture();try{
 const a=(await db.query("insert into investments(name,client_id) values('A',$1) returning id",[ids[2]])).rows[0].id;
 const b=(await db.query("insert into investments(name) values('B') returning id")).rows[0].id;
 const deleted=(await db.query("insert into investments(name,deleted_at) values('Deleted',now()) returning id")).rows[0].id;
 const path=a+'/20000000-0000-0000-0000-000000000001.pdf';
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('portal-documents',$1,$2,'{}')",[path,ids[0]]);
 await db.query("insert into documents(investment_id,title,category,storage_path,published) values($1,'Plan','projekty',$2,true)",[a,path]);
 await db.query("insert into documents(investment_id,title,category,drive_file_id,published) values($1,'B Plan','projekty','b',true),($2,'Draft','projekty','draft',false),($2,'Photo','zdjecia','photo',true),($2,'Invoice','faktury','invoice',true),($3,'Archived','projekty','archived',true)",[b,a,deleted]);
 await db.query("insert into documents(investment_id,title,category,drive_file_id,published,invoice_number) values($1,'Financial project','projekty','financial-project',true,'FV/1')",[a]);
 await asUser(0,()=>db.query("insert into ledger_entries(investment_id,type,amount) values($1,'deposit',100)",[a]));
 await asUser(5,async()=>{
  assert.equal((await db.query('select * from investments')).rows.length,2);
  assert.deepEqual((await db.query('select title from documents order by title')).rows.map(x=>x.title),['B Plan','Plan']);
  assert.equal((await db.query('select * from storage.objects')).rows.length,1);
  assert.equal((await db.query('select * from ledger_entries')).rows.length,0);
  assert.equal((await db.query('select * from purchases')).rows.length,0);
  assert.equal((await db.query('select * from profiles')).rows.length,1);
  for(const query of [()=>db.query('select public.get_portal_balance($1)',[a]),()=>db.query('select public.set_portal_balance($1,5,100)',[a]),()=>db.query('select * from public.portal_balance_history($1)',[a]),()=>db.query('select * from public.portal_login_history()')])await assert.rejects(query,/uprawnień|administrator/);
  assert.equal((await db.query("update profiles set role='admin' where id=$1 returning id",[ids[5]])).rows.length,0);
  assert.equal((await db.query('update investments set client_balance_visible=true returning id')).rows.length,0);
  await assert.rejects(()=>db.query("insert into documents(investment_id,title,category,drive_file_id,published) values($1,'Own','projekty','own',true)",[a]),/row-level security/);
  await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name,owner_id) values('portal-documents',$1,$2)",[a+'/20000000-0000-0000-0000-000000000002.jpg',ids[5]]),/row-level security/);
  await assert.rejects(()=>db.query("select * from public.check_project_employee_pin('1234')"),/permission denied/);
 });
 await asUser(6,async()=>assert.equal((await db.query('select * from documents')).rows.length,0));
 assert.equal(portalAccessAllowed({role:'employee',status:'approved'}),true);
 assert.equal(portalAccessAllowed({role:'employee',status:'approved'},true),false);
 assert.equal(portalAccessAllowed({role:'employee',status:'approved'},'document-management'),false);
 assert.equal(portalAccessAllowed({role:'employee',status:'pending'}),false);
 // The real bcrypt algorithm is supplied by pgcrypto; this tests serialization,
 // persisted failure limits, private access and the distinction between auth users.
 await db.query("update private.project_employee_login set pin_hash='1234'");
 const check=pin=>asService(async()=>(await db.query('select * from public.check_project_employee_pin($1)',[pin])).rows[0]);
 assert.equal((await check('1234')).valid,true);
 for(let i=0;i<10;i++)assert.equal((await check('9999')).valid,false);
 assert.ok((await check('1234')).retry_after>0);
 await db.query("update private.project_employee_login set window_started_at=now()-interval '16 minutes'");
 assert.equal((await check('1234')).valid,true);
 await asService(()=>db.query('select public.bind_project_employee($1)',[ids[5]]));
 assert.equal((await check('1234')).user_id,ids[5]);
 }finally{await db.close()}
});
