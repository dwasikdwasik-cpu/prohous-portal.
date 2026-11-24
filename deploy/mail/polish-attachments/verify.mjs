import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import express from 'express';
import nodemailer from 'nodemailer';
import {attachPolishMail,polishWords} from './polish-mail.mjs';

const checked=await polishWords(['faktura','wiadommość','załącznik']);
assert(checked[0].ok);assert(!checked[1].ok);assert(checked[1].suggestions.includes('wiadomość'));assert(checked[2].ok);
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'test-polish-mail-')),db=new DatabaseSync(':memory:');
const run=promisify(execFile);
db.exec('create table mail_selections(id text, actor integer, account integer, folder text, validity text, expires integer, uids text)');
db.prepare('insert into mail_selections values (?,?,?,?,?,?,?)').run('fixture',1,1,'INBOX','42',Date.now()+60000,'[11,12,13]');
const envelope=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
const files=new Map();
async function fixture(uid,data){
 const m=await envelope.sendMail({from:'one@example.test',to:'two@example.test',subject:'TEST',text:'Wiadomość',...data});
 files.set(uid,m.message);
}
const scan=Buffer.from([0,1,2,3,0xff]);
await fixture(11,{html:'<img src="cid:logo">',attachments:[{filename:'logo.png',cid:'logo',contentType:'image/png',content:Buffer.from([137,80,78,71,13,10,26,10])},{filename:'faktura.pdf',content:scan},{filename:'faktura.pdf',content:Buffer.from('second')}]});
await fixture(12,{attachments:[{filename:'faktura.pdf',content:Buffer.from('third')}]});await fixture(13,{});
const app=express();app.use(express.json());
const session=(req,res,next)=>{req.user={id:Number(req.get('actor')||1)};next();};
const account=req=>{const id=Number(req.query.account||req.body?.account||1);if(id!==req.user.id)throw Object.assign(Error('Brak dostępu'),{status:403});return {id};};
attachPolishMail({app,session,account,db,data:dir,folder:async()=> 'INBOX',
 imap:async(u,fn)=>fn({mailbox:{path:'INBOX',uidValidity:'42'},getMailboxLock:async(p,options)=>{assert.equal(options.readOnly,true);return {release(){}};},
  download:async id=>files.has(id)?{content:Readable.from([files.get(id)])}:null})});
app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
const http=app.listen(0,'127.0.0.1');await once(http,'listening');const base='http://127.0.0.1:'+http.address().port;
async function job(inputs){
 const headers={'Content-Type':'application/json'};
 const resp=await fetch(base+'/api/attachment-exports',{method:'POST',headers,body:JSON.stringify({account:1,folder:'inbox',validity:'42',...inputs})});
 assert.equal(resp.status,202);const {id}=await resp.json(),url=base+'/api/attachment-exports/'+id;
 for(let i=0;i<200;i++){
  const result=await (await fetch(url+'?account=1&folder=inbox')).json();
  if(result.state!=='working')return {result,url};
  await new Promise(r=>setTimeout(r,25));
 }
 throw Error('Test job timeout');
}
try{
 const j=await job({selection:'fixture'});assert.equal(j.result.state,'ready',j.result.error);assert.equal(j.result.count,3);
 const resp=await fetch(j.url+'/download?account=1&folder=inbox');assert.equal(resp.status,200);
 assert.match(resp.headers.get('content-disposition'),/zip/i);
 const archive=path.join(dir,'verify.zip');await fs.writeFile(archive,Buffer.from(await resp.arrayBuffer()));
 // zip -T verifies the data CRC. Select by message folder and independent member indices.
 await run('unzip',['-t',archive]);
 const entries=(await run('unzip',['-Z1',archive],{encoding:'buffer'})).stdout.toString('utf8').trim().split('\n');
 assert.equal(entries.length,3);assert(entries.every(n=>n.endsWith('faktura.pdf')));assert.equal(new Set(entries).size,3);
 const contents=[];
 for(const name of entries){
  const {stdout}=await run('unzip',['-p',archive,name],{encoding:'buffer'});
  contents.push(stdout.toString('hex'));
 }
 assert.deepEqual(contents.sort(),[scan,Buffer.from('second'),Buffer.from('third')].map(b=>b.toString('hex')).sort());
 assert.equal((await fetch(j.url+'/download?account=2&folder=inbox',{headers:{actor:'2'}})).status,404);
 assert.equal((await fetch(j.url+'/download?account=1&folder=sent')).status,404);
 assert.equal((await job({uids:[13]})).result.state,'empty');
 assert.equal((await job({uids:[11,99]})).result.state,'error');
 assert.equal((await job({uids:[11],validity:'wrong'})).result.state,'error');
 assert.equal((await job({uids:[11,11]})).result.count,2);
 assert.equal((await job({selection:'expired'})).result.state,'error');
 console.log('MAIL_CHECKS_PASSED: Polish dictionary, suggestions, ZIP with 3 exact files, duplicate filenames, inline image, selection, UIDVALIDITY, empty mailbox selection and access isolation.');
}finally{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));db.close();await fs.rm(dir,{recursive:true,force:true});}
