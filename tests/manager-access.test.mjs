import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('manager administers documents and clients but cannot read balances or acquire administrator privileges',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role authenticated;create role anon;create role service_role bypassrls;grant usage on schema public,auth to service_role;grant usage on schema public,auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));await db.exec(fs.readFileSync('supabase/upgrade-v2.sql','utf8'));
 for(const path of fs.readdirSync('supabase/migrations').filter(p=>p.startsWith('2026')&&p.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+path,'utf8'));
 const [admin,manager,client,other]=[1,2,3,4].map(n=>'00000000-0000-0000-0000-00000000000'+n);
 for(const id of [admin,manager,client,other])await db.query(`insert into auth.users values($1,$2,'{}')`,[id,id+'@test.invalid']);
 await db.query(`update profiles set role=case when id=$1 then 'admin' when id=$2 then 'manager' else 'client' end,status='approved'`,[admin,manager]);
 const a=(await db.query(`insert into investments(name,client_id) values('A',$1) returning id`,[client])).rows[0].id,b=(await db.query(`insert into investments(name,client_id) values('B',$1) returning id`,[other])).rows[0].id;
 await db.query(`insert into ledger_entries(investment_id,type,amount) values($1,'deposit',1000),($2,'deposit',500)`,[a,b]);
 await db.exec('grant select,insert,update,delete on all tables in schema public to service_role;grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
 async function asUser(id,fn){await db.exec('set role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);try{return await fn()}finally{await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub','',false)`)}}
 let invoice;
 await asUser(manager,async()=>{
  assert.equal((await db.query('select * from investments')).rows.length,2);assert.equal((await db.query('select * from profiles')).rows.length,4);
  assert.equal((await db.query('select * from ledger_entries')).rows.length,0);
  assert.equal((await db.query(`update profiles set role='electrician' where id=$1 returning id`,[other])).rows.length,1);
  await assert.rejects(()=>db.query(`update profiles set role='admin' where id=$1`,[manager]));
  await assert.rejects(()=>db.query(`update profiles set role='admin' where id=$1`,[client]));
  await assert.rejects(()=>db.query(`update profiles set role='manager' where id=$1`,[client]));
  await assert.rejects(()=>db.query(`update profiles set email='changed@test.invalid' where id=$1`,[admin]));
  await assert.rejects(()=>db.query(`insert into ledger_entries(investment_id,type,amount) values($1,'deposit',999)`,[a]));
  const path=a+'/'+crypto.randomUUID()+'.pdf';
  await db.query(`insert into storage.objects values('portal-documents',$1,$2,'{"mimetype":"application/pdf"}')`,[path,manager]);
  await db.query(`insert into documents(investment_id,title,category,storage_path,mime_type) values($1,'Project','projekty',$2,'application/pdf')`,[a,path]);
  assert.equal((await db.query('select * from storage.objects')).rows.length,1);
  invoice=(await db.query(`insert into documents(investment_id,title,category,drive_file_id,invoice_number,invoice_date,gross_amount,auto_book) values($1,'Invoice','faktury','invoice','FV/MANAGER','2026-11-06',100,true) returning id`,[a])).rows[0].id;
  assert.equal((await db.query('select accounting_status from documents where id=$1',[invoice])).rows[0].accounting_status,'booked');
  await assert.rejects(()=>db.query('update documents set gross_amount=200 where id=$1',[invoice]));
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[invoice]);
  await db.query('update documents set deleted_at=null where id=$1',[invoice]);
  assert.equal((await db.query('select * from ledger_entries')).rows.length,0,'bookkeeping does not grant ledger visibility');
  await assert.rejects(()=>db.query('select private.book_document_expense()'));
  await assert.rejects(()=>db.query('select private.adjust_deleted_invoice()'));
 });
 await asUser(admin,async()=>{
  assert.equal(Number((await db.query(`select sum(case when type in ('deposit','expense_reversal') then amount else -amount end) as balance from ledger_entries where investment_id=$1`,[a])).rows[0].balance),900);
  assert.equal((await db.query(`select * from ledger_entries where event_document_id=$1`,[invoice])).rows.length,2);
 });
 await asUser(client,async()=>assert.equal((await db.query('select * from ledger_entries where investment_id=$1',[a])).rows.length,4));
 // Investment trash must hide all related customer and installer data without changing finances.
 await asUser(manager,async()=>{
  await db.query('update investments set deleted_at=now() where id=$1',[a]);
  await assert.rejects(()=>db.query(`insert into documents(investment_id,title,category,drive_file_id) values($1,'Archived upload','projekty','archived-upload')`,[a]));
 });
 await asUser(client,async()=>{
  for(const table of ['investments','documents','ledger_entries'])assert.equal((await db.query('select * from '+table+(table==='investments'?' where id=$1':' where investment_id=$1'),[a])).rows.length,0,table);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  assert.equal((await db.query('update investments set deleted_at=null where id=$1 returning id',[a])).rows.length,0);
 });
 await asUser(other,async()=>{
  assert.equal((await db.query('select * from investments where id=$1',[a])).rows.length,0);
  assert.equal((await db.query('select * from documents where investment_id=$1',[a])).rows.length,0);
  await assert.rejects(()=>db.query(`insert into storage.objects values('portal-documents',$1,$2,'{"mimetype":"image/jpeg"}')`,[a+'/'+crypto.randomUUID()+'.jpg',other]));
 });
 await asUser(admin,async()=>assert.equal(Number((await db.query(`select sum(case when type in ('deposit','expense_reversal') then amount else -amount end) as balance from ledger_entries where investment_id=$1`,[a])).rows[0].balance),900));
 await asUser(manager,async()=>{await db.query('update investments set deleted_at=null where id=$1',[a])});
 await asUser(client,async()=>{
  assert.equal((await db.query('select * from investments where id=$1',[a])).rows.length,1);
  assert.equal((await db.query('select * from ledger_entries where investment_id=$1',[a])).rows.length,4);
  assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 });
 await db.query('update investments set client_id=$1 where id=$2',[manager,a]);
 await asUser(manager,async()=>assert.equal((await db.query('select * from ledger_entries')).rows.length,0));
 await db.exec('set role service_role');await db.query('update profiles set full_name=$1 where id=$2',['System update',manager]);await db.exec('reset role');
 }finally{await db.close()}
});
