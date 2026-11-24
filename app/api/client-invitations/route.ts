import {NextRequest} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {serviceClient,digestToken} from '../../../lib/panel-invitations';
import {apiError} from '../../../lib/server';

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:NextRequest) {
  try {
    const {token,action,password}=await req.json();
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!['check','register','accept'].includes(action))
      return reply({error:'Nieprawidłowe zaproszenie.'},400);
    const digest=digestToken(token);
    if(action==='accept'){
      const bearer=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if(!bearer)return reply({error:'Zaloguj się ponownie.'},401);
      const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {global:{headers:{Authorization:'Bearer '+bearer}},auth:{persistSession:false,autoRefreshToken:false}});
      const {error}=await db.rpc('accept_panel_invite',{digest});
      if(error)return reply({error:error.code==='P0001'?error.message:'Nie udało się przyjąć zaproszenia.'},409);
      return reply({accepted:true});
    }
    const admin=serviceClient();
    const {data:info,error}=await admin.rpc('panel_invite_info',{digest});
    if(error)throw Error('503');
    if(!info)return reply({error:'Zaproszenie wygasło, zostało wykorzystane lub wycofane. Poproś ProHouse o nowe zaproszenie.'},410);
    if(action==='check')return reply(info);
    if(typeof password!=='string'||password.length<12||password.length>128)return reply({error:'Wybierz hasło o długości od 12 do 128 znaków.'},400);
    if(info.registered)return reply({error:'Konto już istnieje. Zaloguj się dotychczasowym hasłem.',registered:true},409);
    // The invite proves mailbox possession only for creation of a new identity.
    // Existing identities always authenticate with their original credentials.
    const created=await admin.auth.admin.createUser({email:info.email,password,email_confirm:true});
    if(created.error)return reply({error:'Nie udało się utworzyć konta. Sprawdź wymagania hasła lub zaloguj się, jeśli konto już istnieje.'},409);
    return reply({created:true});
  } catch(error) {return apiError(error)}
}
