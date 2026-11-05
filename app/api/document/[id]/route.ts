import {NextRequest} from 'next/server';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {drive_v3} from 'googleapis/build/src/apis/drive/v3';
import {JWT} from 'googleapis-common';
import {serveDocument} from '../../../../lib/document-access.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 let client:SupabaseClient;
 const auth=new JWT({email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n'),scopes:['https://www.googleapis.com/auth/drive.readonly']});
 const drive=new drive_v3.Drive({auth});
 return serveDocument(req,id,{
  async authorize(token:string,documentId:string){
   client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   const {data:{user},error}=await client.auth.getUser(token);
   if(error||!user)return {user:null};
   const {data:document,error:docError}=await client.from('documents').select('id,investment_id,title,drive_file_id').eq('id',documentId).maybeSingle();
   if(docError)throw docError;
   if(!document)return {user};
   const {data:investment,error:invError}=await client.from('investments').select('drive_folder_id').eq('id',document.investment_id).maybeSingle();
   if(invError)throw invError;
   return {user,document,folderId:investment?.drive_folder_id};
  },
  async metadata(fileId:string){
   if(!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL||!process.env.GOOGLE_PRIVATE_KEY)throw Error('Drive not configured');
   const {data}=await drive.files.get({fileId,fields:'id,name,mimeType,parents,size,trashed',supportsAllDrives:true});return data;
  },
  async content(fileId:string,mimeType:string){
   const exported=['application/vnd.google-apps.document','application/vnd.google-apps.spreadsheet','application/vnd.google-apps.presentation','application/vnd.google-apps.drawing'].includes(mimeType);
   const response=exported?await drive.files.export({fileId,mimeType:'application/pdf'},{responseType:'arraybuffer',timeout:20000}):await drive.files.get({fileId,alt:'media',supportsAllDrives:true},{responseType:'arraybuffer',timeout:20000});
   return {bytes:new Uint8Array(response.data as ArrayBuffer),exported};
  },
  async audit(userId:string,documentId:string){
   const {error}=await client.from('document_downloads').insert({user_id:userId,document_id:documentId});if(error)throw error;
  }
 });
}
