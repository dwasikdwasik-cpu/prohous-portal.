import {NextRequest} from 'next/server';
import {authorize} from '../../../../../lib/server';
import {item,cleanupScan,intakeError} from '../../../../../lib/invoice-intake-server';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{const {db}=await authorize(req,'invoice-intake');const q=await item(db,(await params).id);if(!q.document_id)throw Error('Najpierw przypisz fakturę do klienta.');return Response.json(await cleanupScan(db,q),{headers:{'Cache-Control':'no-store'}})}catch(e){return intakeError(e)}}
