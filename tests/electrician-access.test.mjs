import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('electrician reads global published projects, uploads own photos, never reads finance or other clients',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role authenticated;create role anon;grant usage on schema public,auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(fs.readFileSync('supabase/upgrade-v2.sql','utf8'));
 for(const path of ['20261106070406_portal_private_uploads.sql','20261106071638_document_trash.sql','20261106073023_automatic_invoice_ledger.sql','20261106080421_automatic_document_publication.sql','20261106080958_investment_project_files.sql','20261106092814_electrician_projects_and_photos.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+path,'utf8'));
 const [admin,clientA,clientB,electrician,otherElectrician]=[1,2,3,4,5].map(n=>'00000000-0000-0000-0000-00000000000'+n);
 for(const id of [admin,clientA,clientB,electrician,otherElectrician])await db.query(`insert into auth.users values($1,$2,'{}')`,[id,id+'@test.invalid']);
 await db.query(`update profiles set role=case when id=$1 then 'admin' when id in ($2,$3) then 'electrician' else 'client' end,status='approved'`,[admin,electrician,otherElectrician]);
 const a=(await db.query(`insert into investments(name,client_id) values('A',$1) returning id`,[clientA])).rows[0].id;
 const b=(await db.query(`insert into investments(name,client_id) values('B',$1) returning id`,[clientB])).rows[0].id;
 const documents=[];
 for(const [inv,category,published,deleted] of [[a,'projekty',true,false],[b,'projekty',true,false],[b,'projekty',false,false],[a,'faktury',true,false],[b,'zdjecia',true,false],[a,'projekty',false,true]]){
  const path=inv+'/'+crypto.randomUUID()+'.jpg';await db.query(`insert into storage.objects values('portal-documents',$1,$2,'{"mimetype":"image/jpeg"}')`,[path,admin]);
  documents.push((await db.query(`insert into documents(investment_id,title,category,storage_path,published,deleted_at) values($1,'fixture',$2,$3,$4,$5) returning id`,[inv,category,path,published,deleted?new Date():null])).rows[0].id);
 }
 await db.query(`insert into ledger_entries(investment_id,type,amount) values($1,'deposit',1000),($2,'expense',100)`,[a,b]);
 await db.query(`insert into purchases(investment_id,name,quantity,unit_price) values($1,'private purchase',1,10)`,[a]);
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;');
 async function asUser(id,fn){await db.exec('begin;set local role authenticated');await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[id]);try{return await fn()}finally{await db.exec('rollback')}}
 await asUser(electrician,async()=>{
  assert.equal((await db.query('select * from investments')).rows.length,2);
  assert.equal((await db.query('select * from documents')).rows.length,2);
  assert.equal((await db.query('select * from storage.objects')).rows.length,2);
  for(const table of ['ledger_entries','purchases','audit_log','document_downloads'])assert.equal((await db.query('select * from '+table)).rows.length,0,table);
  assert.deepEqual((await db.query('select id from profiles')).rows.map(r=>r.id),[electrician]);
  assert.equal((await db.query(`update profiles set role='admin' returning id`)).rows.length,0);
  assert.equal((await db.query(`update documents set published=false returning id`)).rows.length,0);
  for(const inv of [a,b]){
   const path=inv+'/'+crypto.randomUUID()+'.jpg';await db.query(`insert into storage.objects values('portal-documents',$1,$2,'{"mimetype":"image/jpeg"}')`,[path,electrician]);
   const photo=(await db.query(`insert into documents(investment_id,title,category,storage_path,mime_type) values($1,'Instalacja elektryczna','zdjecia',$2,'image/jpeg') returning id,uploaded_by`,[inv,path])).rows[0];
   assert.equal(photo.uploaded_by,electrician);
   assert.equal((await db.query('select * from documents where id=$1',[photo.id])).rows.length,1);
   assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path])).rows.length,0,'attached photos cannot be removed');
   await db.query(`insert into document_downloads(user_id,document_id) values($1,$2)`,[electrician,documents[0]]);
  }
 });
 await assert.rejects(()=>asUser(electrician,()=>db.query(`insert into storage.objects values('portal-documents',$1,$2,'{"mimetype":"application/pdf"}')`,[a+'/'+crypto.randomUUID()+'.pdf',electrician])));
 await assert.rejects(()=>asUser(electrician,()=>db.query(`insert into documents(investment_id,title,category,drive_file_id) values($1,'forged','projekty','forged')`,[a])));
 await assert.rejects(()=>asUser(electrician,()=>db.query(`insert into ledger_entries(investment_id,type,amount) values($1,'expense',10)`,[a])));
 const ownPath=b+'/'+crypto.randomUUID()+'.jpg';await db.query(`insert into storage.objects values('portal-documents',$1,$2,'{"mimetype":"image/jpeg"}')`,[ownPath,electrician]);
 const ownPhoto=(await db.query(`insert into documents(investment_id,title,category,storage_path,mime_type,uploaded_by) values($1,'own','zdjecia',$2,'image/jpeg',$3) returning id`,[b,ownPath,electrician])).rows[0].id;
 await assert.rejects(()=>asUser(otherElectrician,()=>db.query(`insert into documents(investment_id,title,category,storage_path,mime_type,uploaded_by) values($1,'forged','zdjecia',$2,'image/jpeg',$3)`,[a,ownPath,otherElectrician])));
 await asUser(clientA,async()=>{assert.equal((await db.query('select * from investments')).rows.length,1);assert.equal((await db.query('select * from documents where id=$1',[ownPhoto])).rows.length,0)});
 await asUser(clientB,async()=>assert.equal((await db.query('select * from documents where id=$1',[ownPhoto])).rows.length,1));
 await asUser(otherElectrician,async()=>assert.equal((await db.query('select * from documents where id=$1',[ownPhoto])).rows.length,0));
 await db.query(`update documents set deleted_at=now(),published=false where id=$1`,[ownPhoto]);
 await asUser(electrician,async()=>{assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[ownPath])).rows.length,0,'trashed originals stay recoverable');assert.equal((await db.query('select * from storage.objects where name=$1',[ownPath])).rows.length,0,'trashed photos are hidden in direct storage access')});
 await db.query(`update profiles set status='rejected' where id=$1`,[electrician]);
 await asUser(electrician,async()=>{assert.equal((await db.query('select * from investments')).rows.length,0);assert.equal((await db.query('select * from documents')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0)});
 await db.query(`update profiles set status='approved' where id=$1`,[electrician]);await db.query(`update investments set client_id=$1 where id=$2`,[electrician,a]);
 await asUser(electrician,async()=>assert.equal((await db.query('select * from ledger_entries')).rows.length,0,'accidental client assignment cannot grant financial access'));
 }finally{await db.close()}
});
