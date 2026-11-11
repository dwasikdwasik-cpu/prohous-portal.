import {NextRequest} from 'next/server';
import {authorize,apiError} from '../../../../../lib/server';
import {loadClientPreview} from '../../../../../lib/client-preview.mjs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{const {db}=await authorize(req,true);return Response.json(await loadClientPreview(db,(await params).id,req.nextUrl.searchParams.get('investment_id')),{headers:{'Cache-Control':'private, no-store'}})}catch(error){return apiError(error)}
}
