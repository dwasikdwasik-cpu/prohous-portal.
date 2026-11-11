import {NextRequest} from 'next/server';
import {authorize} from '../../../../lib/server';
import {driveGet} from '../../../../lib/drive';
import {INVOICE_INBOX_FOLDER,SCAN_TYPES,MAX_SCAN_BYTES} from '../../../../lib/invoice-intake.mjs';
import {action,intakeError} from '../../../../lib/invoice-intake-server';
export const maxDuration=60;
export async function POST(req:NextRequest){try{const {db}=await authorize(req,'invoice-intake');const body=await req.json();let count=0;const skipped:string[]=[];
 const params=new URLSearchParams({q:`'${INVOICE_INBOX_FOLDER}' in parents and trashed = false`,fields:'nextPageToken,files(id,name,mimeType,size,version)',pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(typeof body.page_token==='string'&&body.page_token.length<2000)params.set('pageToken',body.page_token);
 const data=await (await driveGet('files?'+params)).json();for(const file of data.files||[]){if(!Object.hasOwn(SCAN_TYPES,file.mimeType)||!(Number(file.size)>0)||Number(file.size)>MAX_SCAN_BYTES){skipped.push(file.name);continue;}await action(db,null,'register',{drive_file_id:file.id,source_version:String(file.version),original_name:file.name,mime_type:file.mimeType,source_size:Number(file.size)});count++;}
 return Response.json({count,skipped,next_page_token:data.nextPageToken||null},{headers:{'Cache-Control':'no-store'}})}catch(e){return intakeError(e)}}
