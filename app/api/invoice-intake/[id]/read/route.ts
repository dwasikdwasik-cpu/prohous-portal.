import {NextRequest} from 'next/server';
import {authorize} from '../../../../../lib/server';
import {item,stageScan,intakeError} from '../../../../../lib/invoice-intake-server';
import {readDigitalInvoice} from '../../../../../lib/server-invoice-reader.mjs';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const {db}=await authorize(req,'invoice-intake'),q=await item(db,(await params).id);
  const staged=await stageScan(db,q);
  if(q.mime_type!=='application/pdf')return Response.json({needs_ocr:true},{headers:{'Cache-Control':'no-store'}});
  const result=await readDigitalInvoice(staged.bytes);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return intakeError(e)}
}
