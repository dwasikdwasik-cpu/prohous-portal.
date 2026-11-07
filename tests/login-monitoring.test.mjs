import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('login monitoring records trusted sessions once and protects history across roles and revoked sessions',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role auth_service;
   create table auth.users(id uuid primary key,email text);
   create table public.profiles(id uuid primary key,email text,full_name text,role text,status text);
   create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz,ip inet,user_agent text);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema auth to authenticated,auth_service;
   grant insert,update,delete on auth.sessions to auth_service;`);
  const ids=Array.from({length:7},(_,n)=>`00000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`);
  const session=n=>`10000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`;
  const roles=['admin','manager','client','electrician','plumber','admin','manager'];
  for(let i=0;i<ids.length;i++){
   await db.query('insert into auth.users values($1,$2)',[ids[i],`person${i}@test.invalid`]);
   await db.query('insert into profiles values($1,$2,$3,$4,$5)',[ids[i],`person${i}@test.invalid`,`Osoba ${i}`,roles[i],i===5?'pending':i===6?'rejected':'approved']);
  }
  // Pre-existing sessions are deliberately not fabricated as historical logins.
  await db.query('insert into auth.sessions values($1,$2,now(),null,null,null)',[session(99),ids[0]]);
  await db.exec(fs.readFileSync('supabase/login-monitoring.sql','utf8'));
  assert.equal((await db.query('select * from private.portal_login_events')).rows.length,0);
  for(let i=0;i<ids.length;i++){
   await db.exec('set role auth_service');
   await db.query("insert into auth.sessions values($1,$2,'2026-11-07T12:00:00Z',null,'192.0.2.1','Test browser')",[session(i),ids[i]]);
   await db.exec('reset role');
  }
  assert.equal((await db.query('select * from private.portal_login_events')).rows.length,7);
  assert.equal((await db.query('select email,role,ip_address,user_agent from private.portal_login_events where user_id=$1',[ids[2]])).rows[0].email,'person2@test.invalid');
  await db.query('update auth.sessions set user_agent=$2 where id=$1',[session(2),'Refreshed browser']);
  assert.equal((await db.query('select * from private.portal_login_events')).rows.length,7,'refresh does not create a new login');
  assert.equal((await db.query('select user_agent from private.portal_login_events where user_id=$1',[ids[2]])).rows[0].user_agent,'Test browser','snapshots are immutable');
  async function asUser(index,fn,sessionId=session(index)){
   await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids[index],JSON.stringify({session_id:sessionId})]);
   await db.exec('set role authenticated');try{return await fn()}finally{await db.exec('reset role')}
  }
  for(const i of [0,1])await asUser(i,async()=>{
   const first=(await db.query("select * from public.portal_login_history('',null,3,0)")).rows;
   const second=(await db.query("select * from public.portal_login_history('',null,3,3)")).rows;
   assert.equal(first.length,3);assert.equal(second.length,3);assert.equal(new Set([...first,...second].map(x=>x.session_id)).size,6,'stable pagination with equal timestamps');
   assert.equal((await db.query("select * from public.portal_login_history('PERSON2',null,51,0)")).rows.length,1);
   assert.equal((await db.query("select * from public.portal_login_history('%',null,51,0)")).rows.length,0,'search metacharacters are literal');
   assert.equal((await db.query("select * from public.portal_login_history('', '2026-11-08',51,0)")).rows.length,0);
   await assert.rejects(()=>db.query('select * from private.portal_login_events'),/permission denied/);
   await assert.rejects(()=>db.query('delete from private.portal_login_events'),/permission denied/);
   await assert.rejects(()=>db.query('select private.capture_portal_login()'),/permission denied/);
  });
  for(const i of [2,3,4,5,6])await asUser(i,async()=>{
   await assert.rejects(()=>db.query('select * from public.portal_login_history()'),/Brak uprawnień/);
   await assert.rejects(()=>db.query('select * from private.portal_login_history()'),/Brak uprawnień/);
   await assert.rejects(()=>db.query('insert into private.portal_login_events(session_id,user_id,signed_in_at) values(gen_random_uuid(),gen_random_uuid(),now())'),/permission denied/);
   await assert.rejects(()=>db.query('insert into auth.sessions(id,user_id) values(gen_random_uuid(),gen_random_uuid())'),/permission denied/);
  });
  await asUser(0,()=>assert.rejects(()=>db.query('select * from public.portal_login_history()'),/Brak uprawnień/),session(1));
  await db.query('delete from auth.sessions where id=$1',[session(0)]);
  await asUser(0,()=>assert.rejects(()=>db.query('select * from public.portal_login_history()'),/Brak uprawnień/));
  assert.equal((await db.query('select * from private.portal_login_events')).rows.length,7,'logout preserves history');
  await db.query('update auth.sessions set not_after=now()-interval \'1 minute\' where id=$1',[session(1)]);
  await asUser(1,()=>assert.rejects(()=>db.query('select * from public.portal_login_history()'),/Brak uprawnień/));
  await db.exec('set role anon');
  await assert.rejects(()=>db.query('select * from public.portal_login_history()'),/permission denied/);
  await db.exec('reset role');
  // Monitoring failures do not prevent authentication from creating a session.
  await db.exec('alter table private.portal_login_events rename to temporarily_unavailable');
  await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,now())',[session(50),ids[2]]);
  assert.equal((await db.query('select * from auth.sessions where id=$1',[session(50)])).rows.length,1);
 }finally{await db.close()}
});
