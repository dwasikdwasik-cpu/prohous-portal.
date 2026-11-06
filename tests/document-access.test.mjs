import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serveDocument} from '../lib/document-access.mjs';
const id='ad366aba-0f82-435b-9db5-f9652b654d03';
function fixture(){
 const calls=[];
 return {calls,
  authorize:async()=>({user:{id:'user'},document:{drive_file_id:'file',title:'Faktura'},folderId:'folder'}),
  metadata:async()=>{calls.push('metadata');return {parents:['folder'],name:'Faktura.pdf',mimeType:'application/pdf',size:'3'}},
  content:async()=>{calls.push('content');return {bytes:new Uint8Array([1,2,3]),exported:false}},
  audit:async()=>{calls.push('audit')}
 };
}
const request=(token=true)=>new Request('https://portal.example/api/document/'+id,{headers:token?{Authorization:'Bearer valid'}:{}});
test('anonymous requests never contact Drive',async()=>{const s=fixture();assert.equal((await serveDocument(request(false),id,s)).status,401);assert.deepEqual(s.calls,[])});
test('invalid document IDs are rejected before access',async()=>{const s=fixture();assert.equal((await serveDocument(request(),'../secret',s)).status,404);assert.deepEqual(s.calls,[])});
test('expired session never contacts Drive',async()=>{const s=fixture();s.authorize=async()=>({user:null});assert.equal((await serveDocument(request(),id,s)).status,401);assert.deepEqual(s.calls,[])});
for(const scenario of ['foreign client','pending account','unpublished client document'])test(scenario+' denied by RLS result',async()=>{const s=fixture();s.authorize=async()=>({user:{id:'user'},document:null});assert.equal((await serveDocument(request(),id,s)).status,404);assert.deepEqual(s.calls,[])});
test('a file moved to another investment cannot be downloaded',async()=>{const s=fixture();s.metadata=async()=>({parents:['other'],size:'3'});assert.equal((await serveDocument(request(),id,s)).status,404);assert.deepEqual(s.calls,[])});
test('large files are rejected before content retrieval',async()=>{const s=fixture();s.metadata=async()=>({parents:['folder'],size:26*1024*1024});assert.equal((await serveDocument(request(),id,s)).status,413);assert.deepEqual(s.calls,[])});
test('successful downloads are private attachments and audited',async()=>{const s=fixture();const r=await serveDocument(request(),id,s);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('content-disposition'),/^attachment/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal((await r.arrayBuffer()).byteLength,3);assert.deepEqual(s.calls,['metadata','content','audit'])});
test('audit failure does not release content',async()=>{const s=fixture();s.audit=async()=>{throw Error('DB down')};assert.equal((await serveDocument(request(),id,s)).status,503)});
test('Drive errors do not reveal server secrets',async()=>{const s=fixture();s.metadata=async()=>{throw Error('secret-private-key')};const r=await serveDocument(request(),id,s);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('secret-private-key'))});


test('photo responses retain safe image MIME for the private gallery',async()=>{const s=fixture();s.metadata=async()=>({parents:['folder'],name:'Zdjecie.jpg',mimeType:'image/jpeg',size:'3'});const r=await serveDocument(request(),id,s);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg')});
test('native Google documents are returned as PDF',async()=>{const s=fixture();s.content=async()=>({bytes:new Uint8Array([1]),exported:true});const r=await serveDocument(request(),id,s);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');assert.match(decodeURIComponent(r.headers.get('x-download-name')),/\.pdf$/)});

test("trashed Drive documents never contact Google",async()=>{const s=fixture();s.authorize=async()=>({user:{id:"user"},document:{drive_file_id:"file",deleted_at:new Date().toISOString()},folderId:"folder"});assert.equal((await serveDocument(request(),id,s)).status,404);assert.deepEqual(s.calls,[])});
