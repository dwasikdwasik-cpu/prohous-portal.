import test from 'node:test';import assert from 'node:assert/strict';
import {managementFixture} from './management-fixture.mjs';
test('withdrawn CRM directory preserves records and limits invoice choices to approved portal clients with investments',async()=>{
 const {db,ids,asUser}=await managementFixture();try{
 await db.query("update profiles set role='invoice_clerk' where id=$1",[ids[4]]);
 for(let n=1;n<=119;n++)await db.query("insert into ph_records(id,kind,data,archived) values($1,'clients',$2,0)",['crm-'+n,JSON.stringify({name:'Klient '+n})]);
 const inv=(await db.query("insert into investments(name,client_id) values('Portal',$1) returning id",[ids[2]])).rows[0].id;
 const crm=(await db.query("insert into investments(name,crm_client_id) values('Existing CRM investment','crm-1') returning id")).rows[0].id;
 await db.query("update profiles set role='client',status='pending' where id=$1",[ids[6]]);
 await db.query("insert into investments(name,client_id) values('Pending',$1)",[ids[6]]);
 const targets=()=>db.query('select * from invoice_intake_targets()').then(r=>r.rows);
 for(const role of [2,3,5,6])await asUser(role,async()=>assert.rejects(targets,/Brak uprawnień/));
 await asUser(4,async()=>{
  const rows=await targets();assert.equal(rows.length,1);assert.equal(rows[0].investment_id,inv);
  await assert.rejects(()=>db.query('select invoice_intake_directory()'),/does not exist/);
  await assert.rejects(()=>db.query("select resolve_invoice_client('crm:crm-1')"),/does not exist/);
 });
 assert.equal((await db.query("select count(*)::int as n from ph_records where kind='clients'")).rows[0].n,119);
 assert.equal((await db.query('select id from investments where id=$1',[crm])).rows.length,1);
 assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,8);
 }finally{await db.close()}
});
