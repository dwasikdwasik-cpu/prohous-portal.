import {createHash} from 'node:crypto';
import {driveGet,driveToken} from './drive';
import {inspectUpload,UPLOAD_BUCKET} from './uploads.mjs';
import {INVOICE_INBOX_FOLDER,INTAKE_BUCKET,SCAN_TYPES,MAX_SCAN_BYTES,validateScan,cleanupImportedScan,confirmInboxMetadata} from './invoice-intake.mjs';
import type {SupabaseClient} from '@supabase/supabase-js';
export const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function action(db:SupabaseClient,id:string|null,op:string,data:Record<string,unknown>={}){const r=await db.rpc('invoice_intake_action',{p_id:id,p_action:op,p_data:data});if(r.error)throw Error(r.error.message);return r.data;}
export async function item(db:SupabaseClient,id:string){if(!/^[0-9a-f-]{36}$/.test(id))throw Error('404');const {data,error}=await db.from('invoice_intake').select('*').eq('id',id).single();if(error||!data||data.deleted_at)throw Error('404');return data;}
export async function metadata(fileId:string){const r=await driveGet(`files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,version,trashed,capabilities(canTrash,canRemoveMyDriveParent)&supportsAllDrives=true`);return {...await r.json(),etag:r.headers.get('etag')};}
export async function inboxMetadata(fileId:string){
 const meta=await metadata(fileId);
 return confirmInboxMetadata(fileId,meta,async(pageToken:string|null)=>{
  const params=new URLSearchParams({q:`'${INVOICE_INBOX_FOLDER}' in parents and trashed = false`,fields:'nextPageToken,files(id,version,mimeType,size)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
  if(pageToken)params.set('pageToken',pageToken);
  return (await driveGet('files?'+params)).json();
 });
}
async function limitedBytes(r:Response){if(!r.body)throw Error('Brak pliku');const reader=r.body.getReader();let size=0;const chunks:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_SCAN_BYTES)throw Error('Plik przekracza 25 MB');chunks.push(value)}}finally{await reader.cancel()}return new Uint8Array(Buffer.concat(chunks));}
async function intakeStep<T>(phase:string,work:()=>Promise<T>):Promise<T>{
 try{return await work()}catch(error){
  const reason=error instanceof Error?error.message:(typeof error==='object'&&error&&'message' in error?String(error.message):'Błąd usługi');
  console.error('[invoice-intake]',phase,reason);
  throw Error(phase+': '+reason);
 }
}
export async function stageScan(db:SupabaseClient,q:any){return intakeStep('Pobieranie kopii skanu',()=>stageScanInternal(db,q));}
async function stageScanInternal(db:SupabaseClient,q:any){
 if(q.staged_path){const {data,error}=await db.storage.from(INTAKE_BUCKET).download(q.staged_path);if(error)throw error;const bytes=new Uint8Array(await data.arrayBuffer());if(sha256(bytes)!==q.content_sha256)throw Error('Nieprawidłowa kopia skanu');return {bytes,item:q};}
 const before=await intakeStep('Metadane Google Drive',()=>inboxMetadata(q.drive_file_id));const extension=validateScan(before);if(String(before.version)!==q.source_version)throw Error('Skan zmienił się. Ponownie sprawdź folder.');
 const bytes=await intakeStep('Pobranie pliku Google Drive',async()=>limitedBytes(await driveGet(`files/${encodeURIComponent(q.drive_file_id)}?alt=media&supportsAllDrives=true`)));
 const after=await inboxMetadata(q.drive_file_id);validateScan(after);if(String(after.version)!==q.source_version)throw Error('Skan zmienił się podczas pobierania.');
 await inspectUpload(new File([bytes],`scan.${extension}`,{type:q.mime_type}),'faktury');
 const path=q.id+'/scan.'+extension,hash=sha256(bytes);
 await intakeStep('Zapis kopii skanu',async()=>{const {error}=await db.storage.from(INTAKE_BUCKET).upload(path,bytes,{contentType:q.mime_type,upsert:false,cacheControl:'0'});if(error&&String(error.statusCode)!=='409')throw error;});
 const {data:copy,error}=await db.storage.from(INTAKE_BUCKET).download(path);if(error||!copy)throw Error('Nie potwierdzono zapisu skanu');if(sha256(new Uint8Array(await copy.arrayBuffer()))!==hash)throw Error('Zapisana kopia różni się od skanu');
 return {bytes,item:await action(db,q.id,'stage',{sha256:hash})};
}
export async function importScan(db:SupabaseClient,q:any,investmentId:string){
 if(q.document_id){if(q.assigned_investment_id!==investmentId)throw Error('Ta faktura została już przypisana do innego klienta.');return q;}
 const staged=await stageScan(db,q);q=await action(db,q.id,'reserve',{investment_id:investmentId});
 const {error}=await db.storage.from(UPLOAD_BUCKET).upload(q.target_storage_path,staged.bytes,{contentType:q.mime_type,upsert:false,cacheControl:'0'});if(error&&String(error.statusCode)!=='409')throw error;
 const {data:check,error:checkError}=await db.storage.from(UPLOAD_BUCKET).download(q.target_storage_path);if(checkError||!check||sha256(new Uint8Array(await check.arrayBuffer()))!==q.content_sha256)throw Error('Nie potwierdzono poprawnej kopii w portalu.');
 return action(db,q.id,'finalize',{storage_path:q.target_storage_path});
}
export async function cleanupScan(db:SupabaseClient,q:any){
 try{
 await cleanupImportedScan(q,{
 async document(id:string){const {data,error}=await db.from('documents').select('*').eq('id',id).single();if(error)throw error;return data},
 async destinationHash(path:string){const {data,error}=await db.storage.from(UPLOAD_BUCKET).download(path);if(error||!data)throw Error('Nie można odczytać kopii w portalu.');return sha256(new Uint8Array(await data.arrayBuffer()))},
 metadata:inboxMetadata,
 async sourceHash(fileId:string){return sha256(await limitedBytes(await driveGet(`files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)))},
 async remove(fileId:string,etag:string,capabilities:any){
 const trash=capabilities?.canTrash===true;
 if(!trash&&capabilities?.canRemoveMyDriveParent===false)throw Error('Faktura jest w portalu. Nadaj kontu Google portalu uprawnienia Edytora folderu skanera.');
 const token=await driveToken(true),params=new URLSearchParams({supportsAllDrives:'true',fields:'id,trashed,parents'});if(!trash)params.set('removeParents',INVOICE_INBOX_FOLDER);
 const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,{method:'PATCH',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(trash?{trashed:true}:{})});
 if(!r.ok)throw Error(r.status===403?'Faktura jest w portalu. Konto Google portalu potrzebuje uprawnień Edytora folderu skanera.':r.status===412?'Plik zmienił się. Pozostawiono go w folderze.':'Nie udało się usunąć skanu z folderu Google Drive.');
 const result=await r.json();return {removed:result.id===fileId&&(result.trashed===true||!result.parents?.includes(INVOICE_INBOX_FOLDER))};
 }
 });
 return {item:await action(db,q.id,'cleanup'),cleaned:true};
 }catch(e){const message=e instanceof Error?e.message:'Nie udało się opróżnić folderu';return {item:await action(db,q.id,'cleanup',{error:message}),cleaned:false,error:message};}
}
export function intakeError(error:unknown){const message=error instanceof Error?error.message:'Błąd przetwarzania faktury';const code=['401','403','404','502','503'].includes(message)?Number(message):400;const text=code===401?'Zaloguj się ponownie.':code===403?'Brak dostępu do obsługi faktur.':code===404?'Nie znaleziono skanu.':[502,503].includes(code)?'Sprawdź konfigurację Google Drive.':message;return Response.json({error:text},{status:code,headers:{'Cache-Control':'no-store'}})}
