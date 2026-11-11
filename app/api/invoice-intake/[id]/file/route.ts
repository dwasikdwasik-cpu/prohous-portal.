import {NextRequest} from 'next/server';
import {authorize} from '../../../../../lib/server';
import {item,stageScan,intakeError} from '../../../../../lib/invoice-intake-server';
export const runtime='nodejs';export const maxDuration=60;
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const {db}=await authorize(req,'invoice-intake');const q=await item(db,(await params).id);const staged=await stageScan(db,q);let offset=0;const stream=new ReadableStream({pull(controller){if(offset>=staged.bytes.length){controller.close();return}controller.enqueue(staged.bytes.slice(offset,offset+65536));offset+=65536}});return new Response(stream,{headers:{'Content-Type':q.mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})}catch(e){return intakeError(e)}}
