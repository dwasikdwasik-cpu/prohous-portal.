import test from 'node:test';
import assert from 'node:assert/strict';
import {managementFixture} from './management-fixture.mjs';
import {randomUUID} from 'node:crypto';

test('issued invoices keep their own schedule and file, restrict reads and never change the material ledger',async()=>{
 const {db,ids,asUser}=await managementFixture();
 try {
  const [inv,other,id,second,firstTerm,lastTerm]=Array.from({length:6},()=>randomUUID());
  await db.query("insert into investments(id,name,client_id) values($1,'Dom',$2),($3,'Inna',null)",[inv,ids[2],other]);
  await db.query("update profiles set role='client' where id=$1",[ids[4]]);
  await db.query("insert into private.portal_invitations(investment_id,email,member_id) values($1,'shared@test.invalid',$2)",[inv,ids[4]]);
  const pdf=Buffer.from('%PDF-1.7\nTest').toString('base64');
  const terms=[{id:firstTerm,cents:10001,due_on:'2026-12-01'},{id:lastTerm,cents:4999,due_on:'2026-12-10'}];
  const data={number:'FV/11/test',issued_on:'2026-11-24',total_cents:15000,terms,pdf};
  const change=(version,action,details,project=inv,key=id)=>db.query('select manage_prohouse_invoice($1,$2,$3,$4,$5::jsonb)',[project,key,version,action,JSON.stringify(details)]);
  const read=async(project=inv,preview=null)=>(await db.query('select prohouse_invoice_history($1,$2) as items',[project,preview])).rows[0].items;
  const file=async(project=inv,preview=null)=>(await db.query('select prohouse_invoice_pdf($1,$2,$3) as file',[project,id,preview])).rows[0].file;
  const counts=async()=>(await db.query('select (select count(*) from ledger_entries) as entries,(select count(*) from documents) as docs')).rows[0];
  const before=await counts();
  await asUser(0,()=>change(0,'save',data));
  await assert.rejects(()=>asUser(0,()=>change(0,'save',data,inv,second)));
  await assert.rejects(()=>asUser(0,()=>change(1,'save',{...data,total_cents:15001})));
  await assert.rejects(()=>asUser(0,()=>change(1,'save',{...data,pdf:'aGVsbG8='})));
  for(const user of [2,4]){
   const [i]=await asUser(user,()=>read());assert.equal(i.total_cents,15000);assert.equal(i.has_pdf,true);
   assert.equal(i.terms[0].id,firstTerm);assert.equal(await asUser(user,()=>file()),pdf);
   await assert.rejects(()=>asUser(user,()=>read(other)));
   await assert.rejects(()=>asUser(user,()=>file(other)));
   await assert.rejects(()=>asUser(user,()=>read(inv,ids[2])));
   await assert.rejects(()=>asUser(user,()=>change(1,'paid',{term:firstTerm})));
  }
  for(const user of [1,3,5,6])await assert.rejects(()=>asUser(user,()=>read()));
  assert.equal((await asUser(0,()=>read(inv,ids[4]))).length,1);
  await assert.rejects(()=>asUser(0,()=>file(other,ids[2])));
  await asUser(0,()=>change(1,'paid',{term:firstTerm}));
  await assert.rejects(()=>asUser(0,()=>change(1,'save',data)));
  await assert.rejects(()=>asUser(0,()=>change(2,'save',{...data,terms:[{id:lastTerm,cents:15000,due_on:'2026-12-01'}]})));
  await asUser(0,()=>change(2,'save',{...data,number:'FV/11/K',pdf:null}));
  assert.equal(await asUser(2,()=>file()),pdf);
  let [i]=await asUser(2,()=>read());assert.ok(i.terms[0].paid_at);assert.equal(i.terms[1].paid_at,null);
  await asUser(0,()=>change(3,'paid',{term:lastTerm}));
  [i]=await asUser(2,()=>read());assert.ok(i.terms.every(t=>t.paid_at));
  await asUser(0,()=>change(4,'unpaid',{term:firstTerm}));
  assert.equal((await asUser(2,()=>read()))[0].terms[0].paid_at,null);
  await db.query('update investments set deleted_at=now() where id=$1',[inv]);
  await assert.rejects(()=>asUser(2,()=>read()));await assert.rejects(()=>asUser(0,()=>change(5,'save',data)));
  assert.deepEqual(await counts(),before);
 } finally {await db.close()}
});
