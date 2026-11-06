import {NextRequest} from 'next/server';
import {authorize,apiError} from '../../../../lib/server';
import {driveGet,fileInFolder} from '../../../../lib/drive';
import {UPLOAD_BUCKET,serveUploadedDocument} from '../../../../lib/uploads.mjs';
import {serveDocument} from '../../../../lib/document-access.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
 const {db,user}=await authorize(req);const {id}=await params;let folder:string;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('404');
 const {data:uploaded,error:lookupError}=await db.from('documents').select('id,investment_id,storage_path,title').eq('id',id).maybeSingle();
 if(lookupError)throw lookupError;if(!uploaded)throw Error('404');
 if(uploaded.storage_path)return serveUploadedDocument(uploaded,{
  async info(path:string){const {data,error}=await db.storage.from(UPLOAD_BUCKET).info(path);if(error)throw error;return data},
  async sign(path:string,name:string){const {data,error}=await db.storage.from(UPLOAD_BUCKET).createSignedUrl(path,60,{download:name});if(error)throw error;return data.signedUrl},
  async audit(documentId:string){const {error}=await db.from('document_downloads').insert({user_id:user.id,document_id:documentId});if(error)throw error}
 });
 return serveDocument(req,id,{
 async authorize(_token:string,documentId:string){
 const {data:doc,error}=await db.from('documents').select('*,investments(drive_folder_id)').eq('id',documentId).maybeSingle();if(error)throw error;
 folder=(doc?.investments as any)?.drive_folder_id;return {user,document:doc,folderId:folder};
 },
 async metadata(fileId:string){
 const meta=await (await driveGet(`files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,size,trashed&supportsAllDrives=true`)).json();
 if(await fileInFolder(fileId,folder))meta.parents=[folder];else meta.parents=[];return meta;
 },
 async content(fileId:string,mimeType:string){
 const exported=['application/vnd.google-apps.document','application/vnd.google-apps.spreadsheet','application/vnd.google-apps.presentation','application/vnd.google-apps.drawing'].includes(mimeType);
 const r=await driveGet(exported?`files/${encodeURIComponent(fileId)}/export?mimeType=application%2Fpdf`:`files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
 return {bytes:new Uint8Array(await r.arrayBuffer()),exported};
 },
 async audit(userId:string,documentId:string){const {error}=await db.from('document_downloads').insert({user_id:userId,document_id:documentId});if(error)throw error;}
 });
 }catch(e){return apiError(e)}
}
