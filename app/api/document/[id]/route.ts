import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {google} from 'googleapis';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');
 // Browser links cannot carry Authorization; require authenticated access via a server-issued cookie/session instead.
 // Until this is implemented, deny downloads by default rather than exposing private files.
 return NextResponse.json({error:'Pobieranie wymaga wdrozenia bezpiecznej sesji serwerowej. Pliki nie sa publiczne.'},{status:501});
}
