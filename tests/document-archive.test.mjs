import test from 'node:test';import assert from 'node:assert/strict';
import {createDocumentArchive,archiveEntryName} from '../lib/document-archive.mjs';
const ids=[1,2,3].map(n=>'00000000-0000-0000-0000-00000000000'+n);
function centralEntries(buffer){const names=[];for(let i=0;i<buffer.length-46;i++){if(buffer.readUInt32LE(i)===0x02014b50){const length=buffer.readUInt16LE(i+28);names.push(buffer.subarray(i+46,i+46+length).toString('utf8'))}}return names}
test('archive includes every original document with unique Unicode-safe names and completes progress',async()=>{
 const calls=[],progress=[];
 const archive=createDocumentArchive(ids.map((id,i)=>({id,title:'Faktura Łódź.pdf',created_at:'2026-11-06'})),{download:async id=>{calls.push(id);return new Response('%PDF-'+id,{headers:{'Content-Type':'application/pdf'}})},onProgress:(done,total)=>progress.push([done,total])});
 const result=Buffer.from(await archive.arrayBuffer());assert.deepEqual(calls,ids);
 assert.deepEqual(centralEntries(result),['0001_Faktura Łódź.pdf','0002_Faktura Łódź.pdf','0003_Faktura Łódź.pdf']);
 for(const id of ids)assert.ok(result.includes(Buffer.from('%PDF-'+id)),'original bytes are preserved');
 assert.deepEqual(progress.at(-1),[3,3]);assert.equal(result.readUInt32LE(result.length-22),0x06054b50);
});
test('archive stops on a failed or revoked download and never resolves as a completed ZIP',async()=>{
 const calls=[];const archive=createDocumentArchive(ids.map(id=>({id,title:'photo.jpg'})),{download:async id=>{calls.push(id);return new Response('file',{status:id===ids[1]?403:200})}});
 await assert.rejects(()=>archive.blob(),/Archiwum nie zostało ukończone/);assert.deepEqual(calls,ids.slice(0,2));
});
test('unsafe file paths are flattened and missing image extensions are restored',()=>{
 const safe=archiveEntryName(0,'../../zdjęcie','image/jpeg');assert.ok(safe.startsWith('0001_'));assert.ok(safe.endsWith('zdjęcie.jpg'));assert.doesNotMatch(safe,/[\\/]|\.\./);
 assert.equal(archiveEntryName(1,'instalacja.JPEG','image/jpeg'),'0002_instalacja.JPEG');
 assert.equal(archiveEntryName(2,'foto.png','image/png'),'0003_foto.png');
});
test('server download filename is preferred over the edited display title',async()=>{
 const result=Buffer.from(await createDocumentArchive([{id:ids[0],title:'Zmiana tytułu'}],{download:async()=>new Response('original',{headers:{'x-download-name':encodeURIComponent('Oryginał.pdf'),'content-type':'application/pdf'}})}).arrayBuffer());
 assert.deepEqual(centralEntries(result),['0001_Oryginał.pdf']);
});
test('an empty selection and invalid document identifiers cannot trigger requests',async()=>{
 assert.throws(()=>createDocumentArchive([],{download:async()=>{throw Error('unexpected')}}),/Brak plików/);
 const archive=createDocumentArchive([{id:'../../outside',title:'bad'}],{download:async()=>{throw Error('request must not occur')}});
 await assert.rejects(()=>archive.blob(),/Nieprawidłowy identyfikator/);
});
