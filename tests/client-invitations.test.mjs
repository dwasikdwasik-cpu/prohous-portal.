import test from 'node:test';
import assert from 'node:assert/strict';
import {managementFixture} from './management-fixture.mjs';

test('two invited identities share one panel, hidden finances and unrelated projects stay private',async()=>{
 const {db,ids,asUser,asService}=await managementFixture();
 try{
  await db.exec('alter table auth.users add column email_confirmed_at timestamptz default now()');
  await db.query("update public.profiles set role='client',status='pending' where id in ($1,$2)",[ids[3],ids[4]]);
  const inv='30000000-0000-4000-8000-000000000001';
  const other='30000000-0000-4000-8000-000000000002';
  const manage=(op,email='',digest='')=>db.query("select manage_panel_invites($1,$2,'Dom',$3,$4) as x",[op,inv,email,digest]);
  const accept=digest=>db.query('select accept_panel_invite($1)',[digest]);
  await db.query("insert into public.investments(id,name,client_id) values($1,'Inna',$2)",[other,ids[2]]);
  await asUser(0,()=>manage('create'));await asUser(0,()=>manage('create'));
  assert.equal((await db.query('select count(*)::int n from investments where id=$1',[inv])).rows[0].n,1);
  const a='a'.repeat(64),b='b'.repeat(64),old='c'.repeat(64);
  await assert.rejects(()=>asUser(1,()=>manage('stage','person3@test.invalid',a)));
  await asUser(0,()=>manage('stage','person3@test.invalid',old));
  await asUser(0,()=>manage('stage','person3@test.invalid',a));
  await asUser(0,()=>manage('stage','person4@test.invalid',b));
  assert.equal((await asService(()=>db.query('select panel_invite_info($1) value',[a]))).rows[0].value.registered,true);
  await assert.rejects(()=>asUser(3,()=>accept(old)));
  await assert.rejects(()=>asUser(2,()=>accept(a)));
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids[4]]);
  await assert.rejects(()=>asUser(4,()=>accept(b)));
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids[4]]);
  await asUser(3,()=>accept(a));await asUser(4,()=>accept(b));
  await assert.rejects(()=>asUser(3,()=>accept(a)));
  for(const user of [3,4])await asUser(user,async()=>{
   assert.deepEqual((await db.query('select id from investments')).rows.map(x=>x.id),[inv]);
   await assert.rejects(()=>db.query('select get_portal_balance($1)',[inv]));
  });
  await db.query('update investments set client_balance_visible=true where id=$1',[inv]);
  await asUser(4,()=>db.query('select get_portal_balance($1)',[inv]));
  await asUser(0,()=>manage('remove','person4@test.invalid'));
  assert.deepEqual((await asUser(4,()=>db.query('select id from investments'))).rows,[]);
  await db.query('update investments set client_id=$2 where id=$1',[inv,ids[2]]);
  assert.deepEqual((await asUser(3,()=>db.query('select id from investments'))).rows,[]);
 }finally{await db.close()}
});
test('bulk purge pins the investment and observed deletion time and preserves restored files',async()=>{
 const {db,ids,asUser}=await managementFixture();
 try{
  const inv=(await db.query("insert into investments(name,client_id) values('Dom',$1) returning id",[ids[2]])).rows[0].id;
  const doc=(await db.query("insert into documents(investment_id,title,category,drive_file_id,deleted_at,published) values($1,'Rzut','projekty','sample',now(),false) returning id,deleted_at::text as stamp",[inv])).rows[0];
  const lock=(project,stamp)=>db.query('select lock_panel_trash_item($1,$2,$3) as title',[project,doc.id,stamp]);
  await assert.rejects(()=>asUser(1,()=>lock(inv,doc.stamp)));
  await assert.rejects(()=>asUser(0,()=>lock(ids[0],doc.stamp)));
  await db.query('update documents set deleted_at=null where id=$1',[doc.id]);
  await assert.rejects(()=>asUser(0,()=>lock(inv,doc.stamp)));
  const next=(await db.query("update documents set deleted_at=now()+interval '1 second' where id=$1 returning deleted_at::text as stamp",[doc.id])).rows[0].stamp;
  await assert.rejects(()=>asUser(0,()=>lock(inv,doc.stamp)));
  assert.equal((await asUser(0,()=>lock(inv,next))).rows[0].title,'Rzut');
 }finally{await db.close()}
});
