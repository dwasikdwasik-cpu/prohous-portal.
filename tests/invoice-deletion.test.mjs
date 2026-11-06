import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {ledgerTotals} from '../lib/ledger.mjs';
test('deleting booked invoices restores available funds once, preserves deposits and supports restoration',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role authenticated;create role anon;grant usage on schema public,auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));await db.exec(fs.readFileSync('supabase/upgrade-v2.sql','utf8'));
 for(const path of ['20261106070406_portal_private_uploads.sql','20261106071638_document_trash.sql','20261106073023_automatic_invoice_ledger.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+path,'utf8'));
 const admin='00000000-0000-0000-0000-000000000001',client='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
 for(const id of [admin,client,other])await db.query(`insert into auth.users values($1,$2,'{}')`,[id,id+'@test.invalid']);
 await db.query(`update profiles set role=case when id=$1 then 'admin' else 'client' end,status='approved'`,[admin]);
 const a=(await db.query(`insert into investments(name,client_id) values('A',$1) returning id`,[client])).rows[0].id;
 const b=(await db.query(`insert into investments(name,client_id) values('B',$1) returning id`,[other])).rows[0].id;
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
 async function asUser(id,fn){await db.exec('set role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);try{return await fn()}finally{await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub','',false)`)}}
 const totals=async()=>ledgerTotals((await db.query('select * from ledger_entries where investment_id=$1',[a])).rows);
 let invoice,unbooked;
 await asUser(admin,async()=>{
  await db.query(`insert into ledger_entries(investment_id,type,amount) values($1,'deposit',1000)`,[a]);
  invoice=(await db.query(`insert into documents(investment_id,title,category,drive_file_id,invoice_number,invoice_date,gross_amount,currency,auto_book) values($1,'Invoice','faktury','invoice','FV/1','2026-11-06',123.45,'PLN',true) returning id`,[a])).rows[0].id;
  unbooked=(await db.query(`insert into documents(investment_id,title,category,drive_file_id,gross_amount) values($1,'Incomplete','faktury','incomplete',999) returning id`,[a])).rows[0].id;
  assert.deepEqual(await totals(),{deposits:1000,expenses:123.45,balance:876.55});
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[invoice]);
 });
 // Migration repairs invoices which were already deleted before the feature existed.
 await db.exec(fs.readFileSync('supabase/migrations/20261106101010_deleted_invoice_expense_reversals.sql','utf8'));
 assert.deepEqual(await totals(),{deposits:1000,expenses:0,balance:1000});
 await asUser(admin,async()=>{
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[invoice]);
  assert.equal((await db.query(`select * from ledger_entries where type='expense_reversal'`)).rows.length,1);
  await db.query('update documents set deleted_at=null where id=$1',[invoice]);
  assert.deepEqual(await totals(),{deposits:1000,expenses:123.45,balance:876.55});
  await db.query('update documents set deleted_at=null where id=$1',[invoice]);
  assert.equal((await db.query(`select * from ledger_entries where event_document_id=$1 and type='expense'`,[invoice])).rows.length,1);
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[invoice]);
  assert.deepEqual(await totals(),{deposits:1000,expenses:0,balance:1000});
  assert.equal((await db.query(`select * from ledger_entries where type='expense_reversal'`)).rows.length,2);
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[unbooked]);
  assert.deepEqual(await totals(),{deposits:1000,expenses:0,balance:1000});
  const original=(await db.query('select id from ledger_entries where document_id=$1',[invoice])).rows[0].id;
  await assert.rejects(()=>db.query(`insert into ledger_entries(investment_id,type,amount,reversal_of) values($1,'expense_reversal',1,$2)`,[b,original]));
  await assert.rejects(()=>db.query('update documents set gross_amount=200 where id=$1',[invoice]));
 });
 await asUser(client,async()=>{assert.deepEqual(await totals(),{deposits:1000,expenses:0,balance:1000});assert.equal((await db.query('update documents set deleted_at=null returning id')).rows.length,0);await assert.rejects(()=>db.query('select public.adjust_deleted_invoice()'))});
 await asUser(other,async()=>assert.equal((await db.query('select * from ledger_entries where investment_id=$1',[a])).rows.length,0));
 assert.equal((await db.query(`select * from ledger_entries where document_id=$1`,[invoice])).rows.length,1,'original booking is preserved');
 assert.equal((await db.query(`select * from audit_log where table_name='ledger_entries'`)).rows.length,5);
 }finally{await db.close()}
});
