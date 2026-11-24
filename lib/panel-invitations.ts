import {existsSync,readFileSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

export function inviteSecret() {
  const token = randomBytes(32).toString('hex');
  return {token, digest: digestToken(token)};
}
export function digestToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function settings():Record<string,string|undefined> {
  const file='/run/secrets/prohouse-panel-invitations.json';
  return existsSync(file)?{...process.env,...JSON.parse(readFileSync(file,'utf8'))}:process.env;
}
export function serviceClient() {
  const env=settings();
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error('503');
  return createClient(url, key, {auth:{persistSession:false,autoRefreshToken:false}});
}
export async function sendInvitation(email: string, token: string) {
  const env=settings();
  const host=env.PORTAL_SMTP_HOST, port=Number(env.PORTAL_SMTP_PORT || 587), user=env.PORTAL_SMTP_USER;
  const from=env.PORTAL_SMTP_FROM;
  if (!host || !from) throw Error('503');
  const mail=nodemailer.createTransport({host,port,secure:port===465,requireTLS:port!==465,
    auth:user?{user,pass:env.PORTAL_SMTP_PASS}:undefined,
    connectionTimeout:10000, socketTimeout:20000});
  const link='https://klient.prohous.pl/zaproszenie#'+token;
  const introduction='Dziękujemy za zaufanie i powierzenie nam wykończenia Państwa wnętrza. Przygotowaliśmy dla Państwa Panel Klienta ProHouse. Będziemy w nim udostępniać zdjęcia z przebiegu prac, projekty i dokumenty dotyczące Państwa inwestycji. Jeśli udostępnimy rozliczenia, w panelu pojawią się również faktury i aktualne saldo.';
  const activation='Aby rozpocząć, prosimy otworzyć zaproszenie i ustawić własne hasło. Osoby, które mają już konto ProHouse pod tym adresem e-mail, mogą użyć dotychczasowego hasła. Zaproszenie jest ważne przez 7 dni.';
  const contact='W razie pytań o inwestycję lub dostęp do panelu prosimy o kontakt pod adresem kontakt@prohous.pl. Chętnie pomożemy.';
  const farewell='Cieszymy się na wspólną realizację.';
  const result=await mail.sendMail({
    from:{name:'ProHouse',address:from},to:email,replyTo:'kontakt@prohous.pl',
    subject:'Zaproszenie do Panelu Klienta ProHouse',
    text:['Dzień dobry,',introduction,activation,'Otwórz zaproszenie: '+link,contact,farewell,'Z serdecznymi pozdrowieniami,\nDamian Wąsik i zespół ProHouse'].join('\n\n'),
    html:'<div lang="pl" style="max-width:580px;margin:auto;font:16px/1.6 Arial,sans-serif;color:#20252a"><p><strong>ProHouse</strong> · Panel Klienta</p><p>Dzień dobry,</p><p>'+introduction+'</p><p>'+activation+'</p><p><a style="display:inline-block;background:#171717;color:white;padding:12px 22px;text-decoration:none;border-radius:5px" href="'+link+'">Otwórz zaproszenie</a></p><p>'+contact+'</p><p>'+farewell+'</p><p>Z serdecznymi pozdrowieniami,<br><b>Damian Wąsik i zespół ProHouse</b></p></div>'
  });
  if (!result.accepted.length) throw Error('mail');
}
