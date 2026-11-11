import {PGlite} from '@electric-sql/pglite';import fs from 'node:fs';
export async function managementFixture(){
 const db=new PGlite();
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz default now(),not_after timestamptz,ip inet,user_agent text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create role authenticated;create role anon;create role service_role bypassrls;
 grant usage on schema public,auth to authenticated,service_role;grant all on auth.users,auth.sessions to service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb,owner uuid);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated,service_role;
 create schema extensions;
 -- Only the crypt primitive is stubbed in PGlite; production uses pgcrypto bcrypt.
 create function extensions.crypt(value text,salt text) returns text language sql immutable as $$select value$$;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(fs.readFileSync('supabase/upgrade-v2.sql','utf8'));
 for(const p of fs.readdirSync('supabase/migrations').filter(p=>p.startsWith('2026')&&p.endsWith('.sql')&&!p.includes('invoice_intake')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+p,'utf8'));
 await db.exec(fs.readFileSync('supabase/manual-balance.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/login-monitoring.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/project-employee-access.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/portal-permanent-removal.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261111171546_invoice_intake.sql','utf8'));
 const ids=Array.from({length:8},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`),sessions=ids.map((_,i)=>`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
 const roles=['admin','manager','client','electrician','plumber','employee','employee','admin'];
 for(let i=0;i<ids.length;i++){
  await db.query(`insert into auth.users values($1,$2,'{}')`,[ids[i],i===5?'pracownik@prohous.pl':`person${i}@test.invalid`]);
  await db.query('update profiles set role=$2,status=$3 where id=$1',[ids[i],roles[i],i===6?'pending':'approved']);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sessions[i],ids[i]]);
 }
 await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated,service_role;grant usage,select on all sequences in schema public to authenticated,service_role;');
 async function asUser(i,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids[i],JSON.stringify({session_id:sessions[i]})]);await db.exec('set role authenticated');try{return await fn()}finally{await db.exec('reset role')}}
 async function asService(fn){await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");await db.exec('set role service_role');try{return await fn()}finally{await db.exec('reset role')}}
 return {db,ids,sessions,asUser,asService};
}
