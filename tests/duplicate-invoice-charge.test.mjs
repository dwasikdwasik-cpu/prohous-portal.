import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {managementFixture} from './management-fixture.mjs';
test('explicit duplicate charges are administrator-only, exact, idempotent, reversible and compatible with manual balances and permanent removal',async()=>{
 const {db,ids,sessions,asUser,asService}=await managementFixture();try{
 await db.exec(fs.readFileSync('supabase/duplicate-invoice-charge.sql','utf8'));
 const a=(await db.query("insert into investments(name,client_id,client_balance_visible) values('A',$1,true) returning id",[ids[2]])).rows[0].id;
 const b=(await db.query("insert into investments(name) values('B') returning id")).rows[0].id;
 const add=async(number,hash,inv=a,amount=100,currency='PLN',auto=true,category='faktury')=>(await db.query("insert into documents(investment_id,title,category,drive_file_id,invoice_number,invoice_date,gross_amount,currency,supplier,auto_book,content_sha256) values($1,'Invoice',$2,$3,$4,'2026-11-09',$5,$6,'Supplier',$7,$8) returning id",[inv,category,crypto.randomUUID(),number,amount,currency,auto,hash])).rows[0].id;
 const charge=async(doc,amount=100,inv=a)=>(await db.query('select public.charge_duplicate_invoice($1,$2,$3) result',[doc,inv,amount])).rows[0].result;
 const balance=async()=>Number((await db.query('select public.get_portal_balance($1) balance',[a])).rows[0].balance);
 const status=async id=>(await db.query('select accounting_status from documents where id=$1',[id])).rows[0]?.accounting_status;
 let original,copy,hashCopy,third;
 await asUser(0,async()=>{
  await db.query("insert into ledger_entries(investment_id,type,amount) values($1,'deposit',1000)",[a]);
  original=await add('FV/1','a'.repeat(64));copy=await add('FV/1','b'.repeat(64));hashCopy=await add('Other number','a'.repeat(64));
  await add('FV/1','a'.repeat(64),b);
  assert.equal(await status(copy),'duplicate');assert.equal(await status(hashCopy),'duplicate');assert.equal(await balance(),900);
  await assert.rejects(()=>charge(copy,100,b),/wybranej inwestycji/);
  await assert.rejects(()=>charge(copy,1),/Kwota faktury zmieniła/);
  await assert.rejects(()=>charge(original),/tylko dla niezaksięgowanego duplikatu/);
 });
 for(const i of [1,2,3,4,5,6])await asUser(i,async()=>{
  await assert.rejects(()=>charge(copy),/Tylko zatwierdzony administrator/);
  await assert.rejects(()=>db.query('select * from private.duplicate_invoice_charges'),/permission denied/);
 });
 await db.query("update profiles set status='rejected' where id=$1",[ids[7]]);
 await asUser(7,()=>assert.rejects(()=>charge(copy),/Tylko zatwierdzony administrator/));
 await asUser(0,async()=>{
  assert.equal((await charge(copy)).charged,true);assert.equal(await balance(),800);assert.equal(await status(copy),'booked');
  assert.equal((await charge(copy)).charged,false);assert.equal(await balance(),800);
  assert.equal((await db.query('select * from ledger_entries where document_id=$1',[copy])).rows.length,1);
  await assert.rejects(()=>db.query('update documents set gross_amount=200 where id=$1',[copy]),/zaksięgowany/);
  await assert.rejects(()=>db.query('select * from private.duplicate_invoice_charges'),/permission denied/);
  await db.query('update documents set auto_book=true where id=$1',[copy]);assert.equal(await balance(),800);
  third=await add('FV/1','c'.repeat(64));assert.equal(await status(third),'duplicate');assert.equal(await balance(),800);
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[copy]);assert.equal(await balance(),900);
  await db.query('update documents set deleted_at=null where id=$1',[copy]);assert.equal(await balance(),800);
  assert.equal((await charge(copy)).charged,false);assert.equal(await balance(),800);
  await db.query('select public.set_portal_balance($1,500,800)',[a]);
  assert.equal((await charge(hashCopy)).charged,true);assert.equal(await balance(),400);
  // The exact reported case: original removed, re-upload still detected as a
  // duplicate; only explicit confirmation charges the new copy again.
  await db.query('update documents set deleted_at=now(),published=false where id=$1',[original]);assert.equal(await balance(),500);
  const reupload=await add('FV/1','d'.repeat(64));assert.equal(await status(reupload),'duplicate');assert.equal(await balance(),500);
  assert.equal((await charge(reupload)).charged,true);assert.equal(await balance(),400);
  await db.query('update documents set gross_amount=150 where id=$1',[third]);
  await assert.rejects(()=>charge(third,100),/Kwota faktury zmieniła/);assert.equal(await balance(),400);
  const removed=await add('FV/1','e'.repeat(64));await db.query('update documents set deleted_at=now(),published=false where id=$1',[removed]);await assert.rejects(()=>charge(removed),/aktywnej faktury/);
  for(const [amount,currency,auto,category] of [[0,'PLN',true,'faktury'],[100,'OTHER',true,'faktury'],[100,'PLN',false,'faktury'],[100,'PLN',true,'platnosci']]){
   const id=await add('FV/1',crypto.randomUUID().replaceAll('-','').repeat(2),a,amount,currency,auto,category);await assert.rejects(()=>charge(id,amount),/Sprawdź|tylko dla niezaksięgowanego duplikatu/);
  }
  assert.equal(await balance(),400);
 });
 assert.equal((await db.query('select * from private.duplicate_invoice_charges')).rows.length,3);
 await asUser(2,async()=>{assert.equal(await balance(),400);assert.equal((await db.query("select * from ledger_entries where investment_id=$1 and note like 'Duplikat%/1'",[a])).rows.length,2)});
 await db.query("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[sessions[0]]);
 await asUser(0,()=>assert.rejects(()=>charge(third,150),/Tylko zatwierdzony administrator/));
 await db.query('update auth.sessions set not_after=null where id=$1',[sessions[0]]);
 await db.exec('set role anon');await assert.rejects(()=>charge(third,150),/permission denied/);await db.exec('reset role');
 await asUser(0,async()=>{
  await db.query('update investments set deleted_at=now() where id=$1',[a]);await assert.rejects(()=>charge(third,150),/Inwestycja jest usunięta/);
  await db.query("select public.start_portal_investment_removal($1,'A')",[a]);
 });
 await asService(()=>db.query('select public.finish_portal_investment_removal($1,$2,$3)',[a,ids[0],sessions[0]]));
 assert.equal((await db.query('select * from private.duplicate_invoice_charges')).rows.length,0);
 assert.equal((await db.query('select * from investments where id=$1',[b])).rows.length,1);
 }finally{await db.close()}
});
