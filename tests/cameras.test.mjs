import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCamera} from '../lib/cameras.mjs';
import {managementFixture} from './management-fixture.mjs';

test('camera configuration accepts drafts and HTTPS playback, rejects credentials and unsupported sources',()=>{
 assert.deepEqual(validateCamera({name:' Salon '}),{name:'Salon',playback_type:'hls',playback_url:null,client_visible:false});
 assert.equal(validateCamera({name:'Salon',playback_type:'hls',playback_url:'https://video.example/live.m3u8?token=short',client_visible:true}).client_visible,true);
 assert.equal(validateCamera({name:'Salon',playback_type:'embed',playback_url:'https://video.example/player'}).playback_type,'embed');
 for(const playback_url of ['rtsp://192.168.1.2/stream1','http://video.example/live.m3u8','https://login:secret@video.example/live.m3u8','javascript:alert(1)','https://video.example/live.m3u8#secret','https://video.example/not-a-playlist']) {
  assert.throws(()=>validateCamera({name:'Salon',playback_url}));
 }
 assert.throws(()=>validateCamera({name:'Salon',client_visible:true}));
 assert.throws(()=>validateCamera({name:'Salon',playback_type:'embed',playback_url:'https://klient.prohous.pl/'},'https://klient.prohous.pl'));
});

test('camera RLS isolates clients, hides drafts, excludes workers and follows revocation, reassignment and investment deletion',async()=>{
 const {db,ids,asUser}=await managementFixture();
 try {
  // Create another approved client; fixture index 2 is the first client.
  await db.query("update profiles set role='client',status='approved' where id=$1",[ids[6]]);
  const a=(await db.query("insert into investments(name,client_id) values('A',$1) returning id",[ids[2]])).rows[0].id;
  const b=(await db.query("insert into investments(name,client_id) values('B',$1) returning id",[ids[6]])).rows[0].id;
  let shared;
  await asUser(0,async()=>{
   shared=(await db.query("insert into investment_cameras(investment_id,name,playback_url,client_visible) values($1,'Shared','https://video.example/a.m3u8',true) returning id",[a])).rows[0].id;
   await db.query("insert into investment_cameras(investment_id,name) values($1,'Draft')",[a]);
   await db.query("insert into investment_cameras(investment_id,name,playback_url,client_visible) values($1,'Other','https://video.example/b.m3u8',true)",[b]);
  });
  await asUser(2,async()=>{
   assert.deepEqual((await db.query('select name from investment_cameras')).rows,[{name:'Shared'}]);
   assert.equal((await db.query('update investment_cameras set client_visible=false where id=$1 returning id',[shared])).rows.length,0);
   assert.equal((await db.query('delete from investment_cameras where id=$1 returning id',[shared])).rows.length,0);
   await assert.rejects(()=>db.query("insert into investment_cameras(investment_id,name) values($1,'Injected')",[a]));
  });
  await asUser(6,async()=>assert.deepEqual((await db.query('select name from investment_cameras')).rows,[{name:'Other'}]));
  for(const i of [3,4,5])await asUser(i,async()=>{
   assert.equal((await db.query('select * from investment_cameras')).rows.length,0);
   await assert.rejects(()=>db.query("insert into investment_cameras(investment_id,name) values($1,'Injected')",[a]));
  });
  await asUser(1,async()=>{
   assert.equal((await db.query('select * from investment_cameras')).rows.length,3);
   await db.query('update investment_cameras set client_visible=false where id=$1',[shared]);
  });
  await asUser(2,async()=>assert.equal((await db.query('select * from investment_cameras')).rows.length,0));
  await asUser(1,()=>db.query('update investment_cameras set client_visible=true where id=$1',[shared]));
  await db.query('update investments set client_id=$1 where id=$2',[ids[6],a]);
  await asUser(2,async()=>assert.equal((await db.query('select * from investment_cameras')).rows.length,0));
  await asUser(6,async()=>assert.equal((await db.query('select * from investment_cameras')).rows.length,2));
  await db.query('update investments set deleted_at=now() where id=$1',[a]);
  await asUser(6,async()=>assert.equal((await db.query('select * from investment_cameras where investment_id=$1',[a])).rows.length,0));
  await db.query('update investments set deleted_at=null where id=$1',[a]);
  await db.query("update profiles set status='rejected' where id=$1",[ids[6]]);
  await asUser(6,async()=>assert.equal((await db.query('select * from investment_cameras')).rows.length,0));
  await db.exec('set role anon');
  try { await assert.rejects(()=>db.query('select * from investment_cameras')); } finally {await db.exec('reset role');}
  await db.query('delete from investments where id=$1',[a]);
  assert.equal((await db.query('select * from investment_cameras where investment_id=$1',[a])).rows.length,0);
 } finally {await db.close();}
});

test('camera database rejects publication without a playable endpoint and rejects raw RTSP or credentials',async()=>{
 const {db,ids,asUser}=await managementFixture();
 try {
  const inv=(await db.query("insert into investments(name,client_id) values('A',$1) returning id",[ids[2]])).rows[0].id;
  await asUser(0,async()=>{
   for(const url of [null,'rtsp://camera/stream1','http://camera/live.m3u8','https://user:secret@video.example/live.m3u8','https://video.example/player'])
    await assert.rejects(()=>db.query("insert into investment_cameras(investment_id,name,playback_url,client_visible) values($1,'Bad',$2,true)",[inv,url]));
  });
 } finally {await db.close();}
});
