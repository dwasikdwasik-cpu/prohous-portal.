import {NextRequest} from 'next/server';
import {authorize} from '../../../../../lib/server';
import {item,intakeError} from '../../../../../lib/invoice-intake-server';
import {learnedSuggestions,readingValues,supplierKey,MAX_LEARNING_TEXT} from '../../../../../lib/invoice-learning.mjs';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{
  const {db}=await authorize(req,'invoice-intake'),q=await item(db,(await params).id);
  if(Number(req.headers.get('content-length')||0)>400000)throw Error('Zbyt duży odczyt do zapamiętania.');
  const body=await req.json();
  if(body.operation==='confirm'){
   const {data,error}=await db.rpc('invoice_learning_action',{p_id:q.id,p_action:'confirm'});if(error)throw error;
   return Response.json(data,{headers:{'Cache-Control':'no-store'}});
  }
  if(body.operation!=='observe'||typeof body.text!=='string'||body.text.length>MAX_LEARNING_TEXT||!body.parsed||typeof body.parsed!=='object')throw Error('Nieprawidłowy odczyt faktury.');
  const key=supplierKey(body.text);
  const {error}=await db.rpc('invoice_learning_action',{p_id:q.id,p_action:'observe',p_data:{text:body.text,values:readingValues(body.parsed),supplier_key:key}});if(error)throw error;
  let examples:any[]=[];
  if(key){const previous=await db.from('invoice_reading_feedback').select('supplier_key,original_text,original_values,corrected_values,content_sha256,confirmed_at').eq('supplier_key',key).not('confirmed_at','is',null).order('confirmed_at',{ascending:false}).limit(30);if(previous.error)throw previous.error;examples=previous.data||[];}
  return Response.json({parsed:learnedSuggestions(body.text,body.parsed,examples)},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return intakeError(error)}
}
