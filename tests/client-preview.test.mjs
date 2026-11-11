import test from 'node:test';import assert from 'node:assert/strict';
import {clientDocumentVisible,loadClientPreview} from '../lib/client-preview.mjs';
import {portalAccessAllowed} from '../lib/portal-access.mjs';
import {managementFixture} from './management-fixture.mjs';
// A small read-only Supabase adapter executes the preview's actual queries against
// the same Postgres fixture used by client RLS tests. There are no write methods.
function adapter(db){return {
 from(table){const filters=[],params=[],orders=[];let columns='*',limit=1000,single=false;
  const query={select(value){columns=value;return query},eq(column,value){params.push(value);filters.push(`${column}=$${params.length}`);return query},is(column,value){assert.equal(value,null);filters.push(`${column} is null`);return query},in(column,values){const names=values.map(value=>{params.push(value);return '$'+params.length});filters.push(`${column} in (${names})`);return query},order(column,options={}){orders.push(column+(options.ascending===false?' desc':' asc'));return query},limit(value){limit=value;return query},maybeSingle(){single=true;return query},then(resolve,reject){const sql=`select ${columns} from ${table}${filters.length?' where '+filters.join(' and '):''}${orders.length?' order by '+orders.join(','):''} limit ${limit}`;return db.query(sql,params).then(result=>resolve({data:single?result.rows[0]||null:result.rows,error:null}),reject)}};return query;
 },
 rpc(name,values){assert.equal(name,'get_portal_balance');return db.query('select get_portal_balance($1) as value',[values.p_investment_id]).then(result=>({data:result.rows[0].value,error:null}))}
};}
test('preview documents, cameras and finances match actual client RLS for every visibility setting',async()=>{
 const {db,ids,asUser}=await managementFixture();try{
 const inv=(await db.query("insert into investments(name,client_id) values('Own',$1) returning id",[ids[2]])).rows[0].id;
 const other=(await db.query("insert into investments(name,client_id) values('Other',$1) returning id",[ids[3]])).rows[0].id;
 const gone=(await db.query("insert into investments(name,client_id,deleted_at) values('Trash',$1,now()) returning id",[ids[2]])).rows[0].id;
 const documents=[['photo','zdjecia',true,null,null],['invoice','faktury',true,100,null],['sensitive-photo','zdjecia',true,100,null],['draft','projekty',false,null,null],['gone','zdjecia',false,null,'2026-11-11'],['project','projekty',true,null,null],['generic','inne',true,null,null]];
 for(const [title,category,published,gross,deleted] of documents)await db.query('insert into documents(investment_id,title,category,drive_file_id,published,gross_amount,deleted_at) values($1,$2,$3,$2,$4,$5,$6)',[inv,title,category,published,gross,deleted]);
 for(const visible of [true,false])await db.query("insert into investment_cameras(investment_id,name,playback_type,playback_url,client_visible) values($1,$2,'hls','https://example.invalid/live.m3u8',$3)",[inv,String(visible),visible]);
 await asUser(0,()=>db.query("insert into ledger_entries(investment_id,type,amount) values($1,'deposit',1000)",[inv]));
 for(const invoices of [false,true])for(const balances of [false,true]){
  await db.query('update investments set client_invoices_visible=$2,client_balance_visible=$3 where id=$1',[inv,invoices,balances]);
  const preview=await asUser(0,()=>loadClientPreview(adapter(db),ids[2],inv));
  assert.deepEqual(preview.investments.map(i=>i.id),[inv]);
  await asUser(2,async()=>{
   const actual=(await db.query('select id from documents where investment_id=$1',[inv])).rows.map(d=>d.id).sort();
   assert.deepEqual(preview.documents.map(d=>d.id).sort(),actual);
   const cameras=(await db.query('select id from investment_cameras where investment_id=$1',[inv])).rows.map(c=>c.id).sort();
   assert.deepEqual(preview.cameras.map(c=>c.id).sort(),cameras);
   const entries=(await db.query('select id from ledger_entries where investment_id=$1',[inv])).rows.map(e=>e.id).sort();
   assert.deepEqual(preview.entries.map(e=>e.id).sort(),entries);
   if(balances)assert.equal(preview.availableBalance,(await db.query('select get_portal_balance($1) as value',[inv])).rows[0].value);
   else assert.equal(preview.availableBalance,null);
  });
 }
 await asUser(0,async()=>{
  await assert.rejects(()=>loadClientPreview(adapter(db),ids[2],other),/404/);
  await assert.rejects(()=>loadClientPreview(adapter(db),ids[2],gone),/404/);
  await assert.rejects(()=>loadClientPreview(adapter(db),ids[3]),/404/); // Installer is not a client.
 });
 await db.query("update profiles set status='rejected' where id=$1",[ids[2]]);
 const blocked=await asUser(0,()=>loadClientPreview(adapter(db),ids[2],inv));
 assert.equal(blocked.profile.status,'rejected');assert.deepEqual(blocked.investments,[]);assert.deepEqual(blocked.documents,[]);assert.equal(blocked.availableBalance,null);
 }finally{await db.close()}
});
test('preview access is administrator-only and download eligibility rejects unpublished, foreign and hidden documents',()=>{
 for(const role of ['manager','client','invoice_clerk','electrician','plumber','employee'])assert.equal(portalAccessAllowed({role,status:'approved'},true),false);
 const profile={id:'client',role:'client',status:'approved'},investment={id:'own',client_id:'client',client_invoices_visible:false},document={investment_id:'own',category:'projekty',published:true};
 assert.equal(clientDocumentVisible(profile,investment,document),true);
 for(const change of [{published:false},{deleted_at:'date'},{investment_id:'foreign'},{gross_amount:10},{category:'faktury'},{invoice_number:'FV/1'}])assert.equal(clientDocumentVisible(profile,investment,{...document,...change}),false);
 assert.equal(clientDocumentVisible(profile,{...investment,deleted_at:'date'},document),false);
 assert.equal(clientDocumentVisible({...profile,status:'pending'},investment,document),false);
});
