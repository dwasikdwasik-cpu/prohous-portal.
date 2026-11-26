import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {File} from 'node:buffer';
import {inspectUpload} from '../../../lib/uploads.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const limit=25*1024*1024;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
class Problem extends Error {
  constructor(status,message){super(message);this.status=status;}
}
async function readFile(req) {
  if(Number(req.headers.get('content-length'))>limit)throw new Problem(413,'Maksymalny rozmiar pliku to 25 MB.');
  const reader=req.body?.getReader(),parts=[];
  if(!reader)throw new Problem(400,'Wybierz plik.');
  let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>limit)throw new Problem(413,'Maksymalny rozmiar pliku to 25 MB.');parts.push(value);}
  } finally {await reader.cancel().catch(()=>{});}
  if(!size)throw new Problem(400,'Wybierz plik.');
  return Buffer.concat(parts);
}
export async function POST(req) {
  try {
    const token=(req.headers.get('authorization')||'').match(/^Bearer ([^\s]+)$/i)?.[1];
    if(!token)return reply(401,{error:'Zaloguj się jako projektant.'});
    const db=createClient(process.env.SUPABASE_INTERNAL_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
      auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}});
    const auth=await db.auth.getUser(token);
    if(auth.error||!auth.data.user)throw new Problem(401,'Zaloguj się ponownie.');
    const profile=await db.from('profiles').select('role,status').eq('id',auth.data.user.id).single();
    if(profile.data?.role!=='designer'||profile.data?.status!=='approved')throw new Problem(403,'Wymagane jest zatwierdzone konto projektanta.');
    const q=new URL(req.url).searchParams,investment=q.get('investment'),request_id=q.get('request'),title=(q.get('title')||'').trim();
    const folder=q.get('folder')||null;
    if(folder&&!uuid.test(folder))throw new Problem(400,'Wybierz folder inwestycji.');
    const ext=(q.get('extension')||'').toLowerCase(),types={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
    if(!uuid.test(investment)||!uuid.test(request_id)||!title||title.length>160)throw new Problem(400,'Wybierz inwestycję i podaj nazwę projektu.');
    if(!Object.hasOwn(types,ext))throw new Problem(400,'Wybierz PDF, JPG lub PNG.');
    const raw=await readFile(req),file=new File([raw],'projekt.'+ext,{type:types[ext]});
    let checked;
    try{checked=await inspectUpload(file,'projekty');}catch{throw new Problem(400,'Nie można odczytać pliku. Wybierz poprawny PDF, JPG lub PNG.');}
    const args={investment,request_id,title,extension:checked.extension,mime:checked.mime,bytes:raw.length,checksum:createHash('sha256').update(raw).digest('hex')};
    async function record(finish){
      const {data,error}=await db.rpc('designer_file_in_folder',{...args,finish,folder});
      if(error?.code==='42501')throw new Problem(403,'Administrator nie przypisał Ci tej inwestycji.');
      if(error?.code==='22023')throw new Problem(409,'Dane pliku zmieniły się. Wybierz go ponownie.');
      if(error)throw Error('Receipt');return data;
    }
    const receipt=await record(false);
    if(!receipt.complete){
      const {error}=await db.storage.from('portal-documents').upload(receipt.path,raw,{contentType:checked.mime,cacheControl:'0',upsert:false});
      if(error && !['409','Duplicate','ResourceAlreadyExists'].includes(String(error.statusCode||error.error)) && !/already exists/i.test(error.message))throw Error('Storage');
      await record(true);
    }
    return reply(201,{id:receipt.id});
  }catch(e){return reply(e.status||503,{error:e.status?e.message:'Nie udało się zapisać projektu. Spróbuj ponownie.'});}
}
