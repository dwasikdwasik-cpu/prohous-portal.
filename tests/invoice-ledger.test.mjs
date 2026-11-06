import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('invoices debit only their investment once and preserve audit history',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role authenticated;create role anon;grant usage on schema public,auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));await db.exec(fs.readFileSync('supabase/upgrade-v2.sql','utf8'));
 for(const path of ['20261106070406_portal_private_uploads.sql','20261106071638_document_trash.sql','20261106073023_automatic_invoice_ledger.sql','20261106080958_investment_project_files.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+path,'utf8'));
 const ids=[1,2,3].map(n=>'00000000-0000-0000-0000-00000000000'+n);for(const id of ids)await db.query(`insert into auth.users values($1,$2,'{}')`,[id,id+'@test.invalid']);
 await db.query(`update profiles set status='approved',role=case when id=$1 then 'admin' else 'client' end`,[ids[0]]);
 const a=(await db.query(`insert into investments(name,client_id) values('A',$1) returning id`,[ids[1]])).rows[0].id,b=(await db.query(`insert into investments(name,client_id) values('B',$1) returning id`,[ids[2]])).rows[0].id;
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
 async function asUser(id,fn){await db.exec('set role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);try{return await fn()}finally{await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub','',false)`)}}
 async function add(number,hash,inv=a,amount=100,currency='PLN'){return (await db.query(`insert into documents(investment_id,title,category,drive_file_id,invoice_number,invoice_date,gross_amount,currency,supplier,auto_book,content_sha256) values($1,'Invoice','faktury',$2,$3,'2026-11-06',$4,$5,'Supplier',true,$6) returning id`,[inv,crypto.randomUUID(),number,amount,currency,hash])).rows[0].id}
 let original;
 await asUser(ids[0],async()=>{
  await db.query(`insert into ledger_entries(investment_id,type,amount,created_by) values($1,'deposit',1000,$2)`,[a,ids[0]]);
  const project=(await db.query(`insert into documents(investment_id,title,category,drive_file_id,published,auto_book,gross_amount) values($1,'Rzut projektu.pdf','projekty','project-fixture',true,true,999) returning id`,[a])).rows[0].id;
  assert.equal((await db.query('select accounting_status from documents where id=$1',[project])).rows[0].accounting_status,'not_applicable');
  assert.equal((await db.query('select id from ledger_entries where document_id=$1',[project])).rows.length,0);
  original=await add('FV/1','a'.repeat(64));
  assert.equal((await db.query(`select accounting_status from documents where id=$1`,[original])).rows[0].accounting_status,'booked');
  await db.query(`update documents set auto_book=true where id=$1`,[original]);
  const dupeKey=await add('FV/1','b'.repeat(64)),dupeHash=await add('FV/2','a'.repeat(64));
  for(const id of [dupeKey,dupeHash])assert.equal((await db.query(`select accounting_status from documents where id=$1`,[id])).rows[0].accounting_status,'duplicate');
  const payment=(await db.query(`insert into documents(investment_id,title,category,drive_file_id,invoice_number,invoice_date,gross_amount,currency,auto_book,content_sha256) values($1,'Payment','platnosci','payment','FV/1','2026-11-07',100,'PLN',true,$2) returning id`,[a,'f'.repeat(64)])).rows[0].id;
  assert.equal((await db.query('select accounting_status from documents where id=$1',[payment])).rows[0].accounting_status,'duplicate');
  await add('FV/1','a'.repeat(64),b);
  const foreign=await add('FOREIGN','c'.repeat(64),a,200,'OTHER'),missing=await add(null,'d'.repeat(64));
  for(const id of [foreign,missing])assert.equal((await db.query(`select accounting_status from documents where id=$1`,[id])).rows[0].accounting_status,'needs_review');
  assert.equal(Number((await db.query(`select sum(case when type='deposit' then amount else -amount end) as balance from ledger_entries where investment_id=$1`,[a])).rows[0].balance),900);
  assert.equal((await db.query(`select * from ledger_entries where document_id=$1`,[original])).rows.length,1);
  await assert.rejects(()=>db.query(`update documents set gross_amount=150 where id=$1`,[original]));
  await db.query(`update documents set deleted_at=now(),published=false where id=$1`,[original]);await db.query(`update documents set deleted_at=null where id=$1`,[original]);
  assert.equal((await db.query(`select * from ledger_entries where document_id=$1`,[original])).rows.length,1);
 });
 await asUser(ids[1],async()=>{
  assert.equal((await db.query(`select id from documents where category='projekty' and investment_id=$1`,[a])).rows.length,1);
  assert.equal((await db.query(`select * from ledger_entries where investment_id=$1`,[b])).rows.length,0);
  await assert.rejects(()=>add('ILLEGAL','e'.repeat(64)));
  await assert.rejects(()=>db.query('select public.book_document_expense()'));
 });
 await asUser(ids[2],async()=>assert.equal((await db.query(`select id from documents where category='projekty' and investment_id=$1`,[a])).rows.length,0));
 assert.equal((await db.query(`select * from audit_log where table_name='ledger_entries'`)).rows.length,3);
 }finally{await db.close()}
});
