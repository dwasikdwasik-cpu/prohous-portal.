import {NextRequest} from 'next/server';
import {authorize,apiError} from '../../../../lib/server';
import {inviteSecret,sendInvitation} from '../../../../lib/panel-invitations';

const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest) {
  try {
    const {db}=await authorize(req,true);
    const data=await req.json();
    const {action,investmentId:inv,email='',name=''}=data;
    if (!['create','list','send','remove','remove_primary'].includes(action)||typeof inv!=='string'||
      !uuid.test(inv) ||
      typeof name!=='string'||(action==='create'&&(!name.trim()||name.length>200))||
      typeof email!=='string'||(action==='remove_primary'&&!uuid.test(email))||(['send','remove'].includes(action)&&(!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)||email.length>254)))
      return reply({error:'Sprawdź dane inwestycji i adres e-mail.'},400);
    const secret=action==='send'?inviteSecret():null;
    const args={inv,title:name,address:email.trim().toLowerCase(),digest:secret?.digest||''};
    const {data:result,error}=await db.rpc('manage_panel_invites',{...args,op:secret?'stage':action});
    if (error) return reply({error:error.code==='P0001'?error.message:'Nie udało się zapisać danych dla tej inwestycji.'},409);
    if (!secret||result.active) return reply(result);
    try {await sendInvitation(args.address,secret.token)} catch {
      return reply({error:'Panel jest zapisany. Wysyłka nie została potwierdzona. Możesz ponowić zaproszenie.'},502);
    }
    const sent=await db.rpc('manage_panel_invites',{...args,op:'sent'});
    if(sent.error)return reply({error:'Wiadomość przekazano do wysyłki. Nie udało się zapisać jej statusu.'},502);
    return reply({sent:true});
  } catch(error) {return apiError(error)}
}
