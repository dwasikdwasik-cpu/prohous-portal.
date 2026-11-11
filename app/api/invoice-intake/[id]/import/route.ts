import {NextRequest} from 'next/server';
import {authorize} from '../../../../../lib/server';
import {item,importScan,cleanupScan,intakeError} from '../../../../../lib/invoice-intake-server';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const {db}=await authorize(req,'invoice-intake');const body=await req.json();if(!/^[0-9a-f-]{36}$/.test(body.investment_id||''))throw Error('Wybierz klienta i inwestycję.');let q=await importScan(db,await item(db,(await params).id),body.investment_id);const cleanup=await cleanupScan(db,q);return Response.json(cleanup,{headers:{'Cache-Control':'no-store'}})}catch(e){return intakeError(e)}}
