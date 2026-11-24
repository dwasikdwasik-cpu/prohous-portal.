import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,mkdtemp,readdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {parseMessageStream,renderEmail} from './mail-render.mjs';

const run=promisify(execFile);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const ttl=30*60*1000;

export async function polishWords(words){
  if(!Array.isArray(words)||words.length>160||words.some(w=>typeof w!=='string'||!/^\p{L}[\p{L}\p{M}]{0,99}$/u.test(w)))throw fail('Nieprawidłowa lista słów.');
  if(!words.length)return [];
  const input=[...new Set(words)];
  const child=spawn('hunspell',['-d','pl_PL','-i','UTF-8','-a'],{stdio:['pipe','pipe','ignore'],env:{...process.env,LC_ALL:'C.UTF-8'}});
  let output='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;});
  // Wait for the process and stdout to close before interpreting the dictionary response.
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Hunspell unavailable')));});
  child.stdin.on('error',()=>{});
  child.stdin.end(input.map(w=>'^'+w).join('\n')+'\n');
  const timer=setTimeout(()=>child.kill(),15000);
  try{await done;}catch{throw fail('Słownik polski jest chwilowo niedostępny.',503);}finally{clearTimeout(timer);}
  const lines=output.split(/\r?\n/).filter(l=>l&&!l.startsWith('@'));
  if(lines.length!==input.length)throw fail('Słownik nie potwierdził wszystkich słów.',503);
  return input.map((word,i)=>{
    const line=lines[i];if(/^[*+\-]/.test(line))return {word,ok:true};
    if(!/^[&#?]/.test(line))throw fail('Nieoczekiwana odpowiedź słownika.',503);
    return {word,ok:false,suggestions:(line.split(': ')[1]||'').split(', ').filter(Boolean).slice(0,4)};
  });
}

function safeName(name){
  let s=String(name||'załącznik').normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|\u202a-\u202e\u2066-\u2069]/gu,'_').replace(/^[. ]+|[. ]+$/g,'');
  while(Buffer.byteLength(s)>180)s=Array.from(s).slice(0,-1).join('');
  return s||'załącznik';
}

export async function extractFiles(messageStream,dir){
  await mkdir(dir,{mode:0o700});
  const saved=new Map(),writes=[],streams=new Set();
  try{
    const parsed=await parseMessageStream(messageStream,{onEachAttachment(part,record,id){
      const file=path.join(dir,String(id+1).padStart(3,'0')+' - '+safeName(record.filename));
      saved.set(record,file);
      streams.add(part.content);
      const write=pipeline(part.content,createWriteStream(file,{flags:'wx',mode:0o600}));
      write.then(()=>streams.delete(part.content),e=>{streams.delete(part.content);messageStream.destroy(e);});writes.push(write);
    }});
    await Promise.all(writes);
    const embedded=new Set();renderEmail(parsed,{remoteImages:false,embeddedAttachments:embedded});
    for(const record of embedded){await rm(saved.get(record),{force:true});saved.delete(record);}
    if(!saved.size)await rm(dir,{recursive:true,force:true});
    return saved.size;
  }catch(e){
    messageStream.destroy();
    for(const stream of streams)stream.destroy(e);
    throw e;
  }finally{await Promise.allSettled(writes);}
}

export function attachPolishMail({app,session,account,db,imap,folder,data}){
  app.post('/api/spelling/pl',session,async(req,res)=>res.set('Cache-Control','no-store').json({words:await polishWords(req.body.words)}));
  const root=path.join(data,'attachment-exports'), jobs=new Map();
  const ready=mkdir(root,{recursive:true,mode:0o700}).then(async()=>{
    // Each panel instance has its own files. A restart may leave an unfinished download.
    for(const entry of await readdir(root,{withFileTypes:true})){
      if(!entry.isDirectory()||!/^export-[A-Za-z0-9]{6}$/.test(entry.name))continue;
      const p=path.join(root,entry.name);const s=await stat(p);
      if(Date.now()-s.mtimeMs>24*60*60*1000)await rm(p,{recursive:true,force:true});
    }
  });
  ready.catch(()=>{});
  const clean=setInterval(()=>{for(const [id,j] of jobs){
    if(j.state!=='working'&&!j.readers&&Date.now()-j.used>ttl){
      jobs.delete(id);if(j.dir)rm(j.dir,{recursive:true,force:true}).catch(()=>{});
    }
  }},60000);clean.unref();

  async function build(job,actor,u,input){
    await ready;job.dir=await mkdtemp(path.join(root,'export-'));
    const files=path.join(job.dir,'files');await mkdir(files,{mode:0o700});
    await imap(u,async c=>{
      const lock=await c.getMailboxLock(await folder(c,input.folder||'inbox'),{readOnly:true});
      try{
        if(String(c.mailbox.uidValidity)!==input.validity)throw fail('Folder się zmienił. Zaznacz wiadomości ponownie.',409);
        let ids=input.uids;
        if(input.selection){
          const selected=db.prepare('SELECT uids FROM mail_selections WHERE id=? AND actor=? AND account=? AND folder=? AND validity=? AND expires>?')
            .get(input.selection,actor,u.id,c.mailbox.path,input.validity,Date.now());
          if(!selected)throw fail('Zaznaczenie wygasło. Wybierz wiadomości ponownie.',409);
          ids=JSON.parse(selected.uids);
        }
        if(!Array.isArray(ids)||!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw fail('Zaznacz wiadomości do pobrania.');
        ids=[...new Set(ids)];job.total=ids.length;
        for(const uid of ids){
          const item=await c.download(uid,undefined,{uid:true});
          if(!item?.content)throw fail('Jedna z wiadomości jest niedostępna. Odśwież zaznaczenie.',409);
          job.count+=await extractFiles(item.content,path.join(files,'Wiadomość-'+uid));
          job.done++;
        }
      }finally{lock.release();}
    });
    if(job.count){
      await run('zip',['-q','-0','-D','-r',path.join(job.dir,'attachments.zip'),'.'],{cwd:files,env:{...process.env,LC_ALL:'C.UTF-8'}});
      await rm(files,{recursive:true,force:true});job.state='ready';
    }else{await rm(job.dir,{recursive:true,force:true});job.dir=null;job.state='empty';}
  }
  app.post('/api/attachment-exports',session,(req,res)=>{
    const u=account(req),actor=req.user.id;
    const {folder:box,validity,uids,selection}=req.body;
    if(typeof validity!=='string'||(!selection&&!Array.isArray(uids)))throw fail('Odśwież listę i zaznacz wiadomości.');
    if([...jobs.values()].some(j=>j.actor===actor&&j.account===u.id&&j.state==='working'))throw fail('Trwa już przygotowywanie załączników dla tej skrzynki.',409);
    const id=randomUUID(),job={actor,account:u.id,folder:box||'inbox',state:'working',count:0,done:0,total:0,used:Date.now(),readers:0};
    jobs.set(id,job);
    build(job,actor,u,{folder:box,validity,uids,selection}).catch(async e=>{
      if(job.dir)await rm(job.dir,{recursive:true,force:true}).catch(()=>{});
      job.dir=null;job.state='error';job.error=e.status?e.message:'Nie udało się przygotować wszystkich załączników. Spróbuj ponownie.';
    }).finally(()=>{job.used=Date.now();});
    res.status(202).set('Cache-Control','no-store').json({id});
  });
  function owned(req){
    const j=jobs.get(req.params.id),u=account(req);
    if(!j||j.actor!==req.user.id||j.account!==u.id||j.folder!==(req.query.folder||'inbox'))throw fail('Pobranie jest niedostępne lub wygasło.',404);
    j.used=Date.now();return j;
  }
  app.get('/api/attachment-exports/:id',session,(req,res)=>{
    const j=owned(req);
    res.set('Cache-Control','private, no-store').json({state:j.state,count:j.count,done:j.done,total:j.total,error:j.error});
  });
  app.get('/api/attachment-exports/:id/download',session,(req,res,next)=>{
    const j=owned(req);if(j.state!=='ready')throw fail('Archiwum nie jest gotowe.',409);
    j.readers++;res.set('Cache-Control','private, no-store');
    res.download(path.join(j.dir,'attachments.zip'),'Zalaczniki-ProHouse.zip',err=>{
      j.readers--;j.used=Date.now();if(err)next(err);
    });
  });
}
