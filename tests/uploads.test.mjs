import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectUpload,serveUploadedDocument,MAX_UPLOAD_BYTES} from '../lib/uploads.mjs';
const investment='00000000-0000-0000-0000-000000000001';
const doc={id:'document',investment_id:investment,storage_path:investment+'/00000000-0000-0000-0000-000000000002.pdf',title:'Faktura.pdf'};
test('uploads identify real PDF and JPEG bytes independently of browser MIME',async()=>{
 assert.deepEqual(await inspectUpload(new File(['%PDF-1.7 data'],'faktura.PDF'), 'faktury'),{mime:'application/pdf',extension:'pdf'});
 assert.deepEqual(await inspectUpload(new File([new Uint8Array([255,216,255,224])],'zdjecie.jpeg'),'zdjecia'),{mime:'image/jpeg',extension:'jpg'});
});
test('uploads reject empty, oversized, unsupported, disguised and non-image photo files',async()=>{
 for(const [file,category] of [[new File([],'x.pdf'),'faktury'],[{size:MAX_UPLOAD_BYTES+1,name:'x.pdf'},'faktury'],[new File(['<html>'],'x.pdf'),'faktury'],[new File(['text'],'x.svg'),'zdjecia'],[new File(['%PDF-1.7'],'x.pdf'),'zdjecia']])await assert.rejects(()=>inspectUpload(file,category));
});
test('a stored download validates the investment path and does not sign foreign objects',async()=>{
 let calls=0;const r=await serveUploadedDocument({...doc,storage_path:'00000000-0000-0000-0000-000000000099/file.pdf'},{info(){calls++}});
 assert.equal(r.status,404);assert.equal(calls,0);
});
test('storage downloads audit before returning a short-lived redirect',async()=>{
 const calls=[];
 const r=await serveUploadedDocument(doc,{async info(){calls.push('info');return {size:100,contentType:'application/pdf'}},async sign(path,name){calls.push('sign');assert.equal(path,doc.storage_path);assert.equal(name,'Faktura.pdf');return 'https://storage.example/download'},async audit(id){calls.push('audit');assert.equal(id,doc.id)}});
 assert.equal(r.status,307);assert.equal(r.headers.get('location'),'https://storage.example/download');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(calls,['info','sign','audit']);
});
test('audit failure never releases the storage URL',async()=>{
 const r=await serveUploadedDocument(doc,{async info(){return {size:100,contentType:'application/pdf'}},async sign(){return 'https://storage.example/secret'},async audit(){throw Error('failure')}});
 assert.equal(r.status,503);assert.equal(r.headers.get('location'),null);assert.ok(!(await r.text()).includes('secret'));
});
test('oversized storage downloads are rejected before signing',async()=>{
 const r=await serveUploadedDocument(doc,{async info(){return {size:MAX_UPLOAD_BYTES+1,contentType:'application/pdf'}},async sign(){assert.fail('must not sign')}});assert.equal(r.status,413);
});

test("trashed portal uploads do not release a download URL",async()=>{const r=await serveUploadedDocument({...doc,deleted_at:new Date().toISOString()},{info(){assert.fail("must not read trashed object")}});assert.equal(r.status,404)});

test("project files can be uploaded without an invoice category",async()=>{const result=await inspectUpload(new File(["%PDF-1.7 plan"],"rzut.pdf"),"projekty");assert.equal(result.mime,"application/pdf")});
