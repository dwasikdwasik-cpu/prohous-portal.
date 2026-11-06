import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
test('private uploads preserve client isolation, drafts, immutable sources and scoped publication',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role authenticated;create role anon;grant usage on schema public,auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(fs.readFileSync('supabase/upgrade-v2.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261106070406_portal_private_uploads.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261106071638_document_trash.sql','utf8'));
 const ids=[1,2,3,4].map(n=>'00000000-0000-0000-0000-00000000000'+n);
 for(const id of ids)await db.query(`insert into auth.users values($1,$2,'{}')`,[id,id+'@test.invalid']);
 await db.query(`update profiles set role='admin',status='approved' where id=$1`,[ids[0]]);
 await db.query(`update profiles set status='approved' where id=any($1)`,[[ids[1],ids[2]]]);
 const a=(await db.query(`insert into investments(name,client_id) values('A',$1) returning id`,[ids[1]])).rows[0].id,b=(await db.query(`insert into investments(name,client_id) values('B',$1) returning id`,[ids[2]])).rows[0].id;
 const paths=[a+'/'+ids[0]+'.pdf',a+'/'+ids[1]+'.jpg',b+'/'+ids[2]+'.pdf'];
 for(let i=0;i<3;i++){
  await db.query(`insert into storage.objects values('portal-documents',$1)`,[paths[i]]);
  await db.query(`insert into documents(investment_id,title,category,storage_path,published) values($1,'Upload','inne',$2,$3)`,[i===2?b:a,paths[i],i===0]);
 }
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
 async function asUser(id,fn){await db.exec('begin;set local role authenticated;');await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[id]);try{return await fn()}finally{await db.exec('rollback')}}
 await asUser(ids[1],async()=>{assert.equal((await db.query('select * from storage.objects')).rows.length,1);assert.equal((await db.query('select * from documents')).rows.length,1)});
 await asUser(ids[2],async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));
 await asUser(ids[3],async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));
 await assert.rejects(()=>asUser(ids[1],()=>db.query(`insert into storage.objects values('portal-documents',$1)`,[a+'/'+ids[3]+'.pdf'])));
 await asUser(ids[0],async()=>{
  assert.equal((await db.query('select * from storage.objects')).rows.length,3);
  assert.equal((await db.query(`update documents set published=true where investment_id=$1 and published=false returning id`,[a])).rows.length,1);
  assert.equal((await db.query(`select * from documents where investment_id=$1 and published=false`,[b])).rows.length,1);
  assert.equal((await db.query(`delete from storage.objects returning name`)).rows.length,0);
  await db.query(`insert into storage.objects values('portal-documents',$1)`,[a+'/'+ids[3]+'.pdf']);
  assert.equal((await db.query(`delete from storage.objects returning name`)).rows.length,1);
 });
 await assert.rejects(()=>db.query(`insert into documents(investment_id,title,category,storage_path) values($1,'Wrong','inne',$2)`,[b,paths[0]]));
 await assert.rejects(()=>db.query(`insert into documents(investment_id,title,category,storage_path,drive_file_id) values($1,'Two','inne',$2,'drivefile')`,[a,a+'/'+ids[3]+'.pdf']));
 await db.query(`update documents set deleted_at=now(),published=false where storage_path=$1`,[paths[0]]);
 await asUser(ids[1],async()=>{
  assert.equal((await db.query('select * from documents')).rows.length,0);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  assert.equal((await db.query('update documents set deleted_at=null returning id')).rows.length,0);
 });
 await asUser(ids[0],async()=>{
  assert.equal((await db.query('select * from documents where deleted_at is not null')).rows.length,1);
  assert.equal((await db.query(`update documents set published=true where investment_id=$1 and published=false and deleted_at is null returning id`,[a])).rows.length,1);
  assert.equal((await db.query('select * from documents where deleted_at is not null and published=false')).rows.length,1);
 });
 await assert.rejects(()=>db.query(`update documents set published=true where storage_path=$1`,[paths[0]]));
 await db.query(`update documents set deleted_at=null,published=false where storage_path=$1`,[paths[0]]);
 await asUser(ids[1],async()=>assert.equal((await db.query('select * from documents')).rows.length,0));
 await db.query(`update documents set published=true where storage_path=$1`,[paths[0]]);
 await asUser(ids[1],async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,1));
 assert.equal((await db.query(`select public from storage.buckets where id='portal-documents'`)).rows[0].public,false);
 }finally{await db.close()}
});
