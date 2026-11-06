import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function worker(fetch){const listeners={};vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self:{addEventListener:(event,listener)=>listeners[event]=listener,skipWaiting(){},clients:{claim(){}},location:{origin:'https://portal.test'}},URL,Response,fetch});return listeners}
test('service worker leaves private API and document responses to the network',()=>{
 const listeners=worker(()=>{throw Error('unexpected fetch')});
 for(const url of ['https://portal.test/api/document/private-id','https://database.test/auth/v1/token'])listeners.fetch({request:{mode:'cors',url},respondWith(){throw Error('private data intercepted')}});
});
test('offline navigation returns only a generic no-store page',async()=>{
 const listeners=worker(async()=>{throw Error('offline')});let result;
 listeners.fetch({request:{mode:'navigate',url:'https://portal.test/'},respondWith:promise=>result=promise});
 const response=await result;assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(await response.text(),/Brak połączenia z internetem/);
});
test('online navigation returns the current network response',async()=>{
 const current=new Response('current page'),listeners=worker(async()=>current);let result;
 listeners.fetch({request:{mode:'navigate',url:'https://portal.test/'},respondWith:promise=>result=promise});assert.equal(await result,current);
});
