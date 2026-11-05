import {NextRequest} from 'next/server';
import {authorize,apiError} from '../../../../lib/server';
import {driveGet,validDriveId} from '../../../../lib/drive';
export const runtime='nodejs';
export async function POST(req:NextRequest){try{
 const {db}=await authorize(req,true);const body=await req.json();
 const {data:inv}=await db.from('investments').select('id,drive_folder_id').eq('id',body.investment_id).single();
 if(!inv)throw new Error('404');if(!inv.drive_folder_id||!validDriveId(inv.drive_folder_id))return Response.json({error:'Wpisz poprawne ID folderu Google Drive.'},{status:400});
 let page:string|undefined,scanned=0,added=0;
 const folders=[inv.drive_folder_id];const visited=new Set<string>();
 while(folders.length){const folder=folders.shift()!;if(visited.has(folder))continue;visited.add(folder);if(visited.size>500)throw new Error('502');page=undefined;
 do{
 const params=new URLSearchParams({q:`'${folder}' in parents and trashed = false`,fields:'nextPageToken,files(id,name,mimeType)',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(page)params.set('pageToken',page);
 const data=await (await driveGet('files?'+params)).json();
 folders.push(...(data.files||[]).filter((f:any)=>f.mimeType==='application/vnd.google-apps.folder').map((f:any)=>f.id));
 const rows=(data.files||[]).filter((f:any)=>!['application/vnd.google-apps.folder','application/vnd.google-apps.shortcut'].includes(f.mimeType)).map((f:any)=>({investment_id:inv.id,drive_file_id:f.id,title:f.name,category:f.mimeType.startsWith('image/')?'zdjecia':/faktur|invoice/i.test(f.name)?'faktury':'inne',mime_type:f.mimeType,published:false}));
 if(rows.length){const {data:saved,error}=await db.from('documents').upsert(rows,{onConflict:'investment_id,drive_file_id',ignoreDuplicates:true}).select('id');if(error)throw error;added+=saved?.length||0;}scanned+=rows.length;page=data.nextPageToken;
 }while(page);
 }
 return Response.json({scanned,added,message:`Dodano ${added} nowych plików do zatwierdzenia. Sprawdzono także podfoldery.`},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return apiError(e)}}
