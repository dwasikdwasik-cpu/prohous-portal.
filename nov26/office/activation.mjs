import {readFileSync} from 'node:fs';
const account=JSON.parse(readFileSync(new URL('./staff-office-settings.json',import.meta.url),'utf8')).email;
const cookieName='ph_office_activation';
const cookiePath='/api/staff-activation';
const cookieFlags='; Path='+cookiePath+'; HttpOnly; Secure; SameSite=Strict';

export default async function activate(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Metoda niedozwolona.'});
  if(req.headers.origin!=='https://praca.prohous.pl')return res.status(403).json({error:'Otwórz formularz w Centrum Pracownika.'});
  const body=req.body??{};
  const auth=process.env.EDGE_URL+'/auth/v1';
  const headers={'Content-Type':'application/json',apikey:process.env.EDGE_ANON_KEY};
  try {
    if(body.action==='verify') {
      if(typeof body.code!=='string'|| !/^\d{6,10}$/.test(body.code) || !['invite','recovery'].includes(body.kind))
        return res.status(400).json({error:'Sprawdź kod z wiadomości.'});
      const reply=await fetch(auth+'/verify',{method:'POST',headers,body:JSON.stringify({email:account,token:body.code,type:body.kind}),signal:AbortSignal.timeout(15000)});
      const data=await reply.json();
      if(!reply.ok||!data.access_token||data.user?.email?.toLowerCase()!==account)
        return res.status(400).json({error:'Kod jest nieprawidłowy, wygasł lub został już wykorzystany. Poproś ProHouse o ponowne zaproszenie.'});
      res.setHeader('Set-Cookie',cookieName+'='+encodeURIComponent(data.access_token)+cookieFlags+'; Max-Age='+Math.min(Number(data.expires_in)||600,600));
      return res.json({ok:true});
    }
    if(body.action!=='password'||typeof body.password!=='string'||body.password.length<12||body.password.length>128)
      return res.status(400).json({error:'Podaj hasło od 12 do 128 znaków.'});
    const part=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
    if(!part)return res.status(401).json({error:'Potwierdź zaproszenie kodem z wiadomości.'});
    const token=decodeURIComponent(part.slice(cookieName.length+1));
    const authorized={...headers,Authorization:'Bearer '+token};
    const check=await fetch(auth+'/user',{headers:authorized,signal:AbortSignal.timeout(10000)});
    if(!check.ok||(await check.json()).email?.toLowerCase()!==account)
      return res.status(401).json({error:'Potwierdź zaproszenie ponownie.'});
    const update=await fetch(auth+'/user',{method:'PUT',headers:authorized,body:JSON.stringify({password:body.password}),signal:AbortSignal.timeout(15000)});
    if(!update.ok)return res.status(400).json({error:'Nie udało się ustawić hasła. Sprawdź wymagania hasła i spróbuj ponownie.'});
    res.setHeader('Set-Cookie',cookieName+'='+cookieFlags+'; Max-Age=0');
    await fetch(auth+'/logout?scope=local',{method:'POST',headers:authorized,signal:AbortSignal.timeout(5000)}).catch(()=>{});
    return res.json({ok:true});
  } catch {return res.status(503).json({error:'Usługa logowania jest chwilowo niedostępna. Spróbuj ponownie.'});}
}
