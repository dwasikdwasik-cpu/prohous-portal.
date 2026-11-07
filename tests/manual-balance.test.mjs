import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';

test('only an active approved administrator sets balances; clients see the amount without adjustment history and invoices continue booking',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create role authenticated;create role anon;create role service_role bypassrls;grant usage on schema public,auth to authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(fs.readFileSync('supabase/upgrade-v2.sql','utf8'));
 for(const path of fs.readdirSync('supabase/migrations').filter(p=>p.startsWith('2026')&&p.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+path,'utf8'));
 const ids=Array.from({length:7},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
 const session=i=>`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`;
 const roles=['admin','manager','client','client','electrician','admin','admin'];
 for(let i=0;i<ids.length;i++){
  await db.query(`insert into auth.users values($1,$2,'{}')`,[ids[i],`person${i}@test.invalid`]);
  await db.query('update profiles set role=$2,status=$3 where id=$1',[ids[i],roles[i],i===5?'pending':i===6?'rejected':'approved']);
  await db.query('insert into auth.sessions values($1,$2,null)',[session(i),ids[i]]);
 }
 const investment=(await db.query("insert into investments(name,client_id,client_balance_visible) values('Test',$1,true) returning id",[ids[2]])).rows[0].id;
 const other=(await db.query("insert into investments(name,client_id,client_balance_visible) values('Other',$1,true) returning id",[ids[3]])).rows[0].id;
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
 await db.exec(fs.readFileSync('supabase/manual-balance.sql','utf8'));
 async function asUser(i,fn,sessionId=session(i)){
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids[i],JSON.stringify({session_id:sessionId})]);
  await db.exec('set role authenticated');try{return await fn()}finally{await db.exec('reset role')}
 }
 const balance=async()=>Number((await db.query('select public.get_portal_balance($1) value',[investment])).rows[0].value);
 const set=async(target,expected)=>Number((await db.query('select public.set_portal_balance($1,$2,$3) value',[investment,target,expected])).rows[0].value);
 let invoice;
 await asUser(0,async()=>{
  await db.query("insert into ledger_entries(investment_id,type,amount) values($1,'deposit',1000)",[investment]);
  await db.query("insert into documents(investment_id,title,category,drive_file_id,invoice_number,invoice_date,gross_amount,currency,auto_book) values($1,'First','faktury','one','FV/1','2026-11-07',123.45,'PLN',true)",[investment]);
  assert.equal(await balance(),876.55);
  assert.equal(await set(500,876.55),500);assert.equal(await balance(),500);
  assert.equal((await db.query('select * from ledger_entries where investment_id=$1',[investment])).rows.length,2,'manual changes do not appear in ledger history');
  await set(500,500);assert.equal((await db.query('select * from public.portal_balance_history($1)',[investment])).rows.length,1,'saving same value is idempotent');
  invoice=(await db.query("insert into documents(investment_id,title,category,drive_file_id,invoice_number,invoice_date,gross_amount,currency,auto_book) values($1,'Second','faktury','two','FV/2','2026-11-07',100,'PLN',true) returning id",[investment])).rows[0].id;
  assert.equal(await balance(),400);
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[invoice]);assert.equal(await balance(),500);
  await db.query('update documents set deleted_at=null where id=$1',[invoice]);assert.equal(await balance(),400);
  await db.query("insert into ledger_entries(investment_id,type,amount) values($1,'deposit',50)",[investment]);assert.equal(await balance(),450);
  await assert.rejects(()=>set(777,400),/Saldo zmieniło się/);assert.equal(await balance(),450);
 });
 await asUser(2,async()=>{
  assert.equal(await balance(),450);
  assert.equal((await db.query('select * from ledger_entries where investment_id=$1',[investment])).rows.length,6);
  await assert.rejects(()=>db.query('select public.get_portal_balance($1)',[other]),/Brak uprawnień/);
  await assert.rejects(()=>set(999,450),/Tylko zatwierdzony administrator/);
  await assert.rejects(()=>db.query('select * from public.portal_balance_history($1)',[investment]),/Brak uprawnień/);
  await assert.rejects(()=>db.query('select * from private.balance_adjustments'),/permission denied/);
 });
 for(const i of [1,3,4,5,6])await asUser(i,async()=>{
  await assert.rejects(()=>balance(),/Brak uprawnień/);
  await assert.rejects(()=>set(999,450),/Tylko zatwierdzony administrator/);
  await assert.rejects(()=>db.query('select * from private.portal_balance_history($1)',[investment]),/Brak uprawnień/);
 });
 await asUser(0,async()=>{
  await assert.rejects(()=>db.query('update private.balance_adjustments set delta=100'),/permission denied/);
  await assert.rejects(()=>db.query('select private.calculate_portal_balance($1)',[investment]),/permission denied/);
  await set(-12.34,450);assert.equal(await balance(),-12.34);await set(0,-12.34);assert.equal(await balance(),0);
  for(const target of [null,'NaN','Infinity','-Infinity','1000000000000','1.001'])await assert.rejects(()=>set(target,0),/Podaj poprawną kwotę/);
  assert.equal((await db.query('select * from public.portal_balance_history($1)',[investment])).rows.length,3);
  await db.query('update investments set deleted_at=now() where id=$1',[investment]);
  await assert.rejects(()=>set(5,0),/Nie znaleziono aktywnej inwestycji/);
  await db.query('update investments set deleted_at=null,client_balance_visible=false where id=$1',[investment]);
 });
 await asUser(2,()=>assert.rejects(()=>balance(),/Brak uprawnień/));
 await asUser(0,()=>assert.rejects(()=>set(99,0),/Tylko zatwierdzony administrator/),session(1));
 await db.query('delete from auth.sessions where id=$1',[session(0)]);
 await asUser(0,()=>assert.rejects(()=>set(99,0),/Tylko zatwierdzony administrator/));
 await db.exec('set role anon');await assert.rejects(()=>db.query('select public.set_portal_balance($1,1,0)',[investment]),/permission denied/);await db.exec('reset role');
 }finally{await db.close()}
});
