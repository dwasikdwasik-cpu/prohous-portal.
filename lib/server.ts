import {createClient} from '@supabase/supabase-js';
import {NextRequest} from 'next/server';
export async function authorize(req:NextRequest,admin=false){
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)throw new Error('401');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw new Error('503');
 const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await db.auth.getUser(token);if(error||!user)throw new Error('401');
 const {data:profile}=await db.from('profiles').select('role,status').eq('id',user.id).single();
 if(profile?.status!=='approved'||(admin&&profile.role!=='admin'))throw new Error('403');
 return {db,user};
}
export function apiError(e:unknown){const code=e instanceof Error?e.message:'';const status=['401','403','404','503'].includes(code)?Number(code):502;return Response.json({error:({401:'Zaloguj się ponownie.',403:'Brak uprawnień.',404:'Nie znaleziono dokumentu.',503:'Integracja nie została skonfigurowana.',502:'Nie udało się połączyć z usługą. Spróbuj ponownie.'} as Record<number,string>)[status]},{status,headers:{'Cache-Control':'no-store'}})}
