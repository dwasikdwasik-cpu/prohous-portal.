export function createRemovalHandler(services){
 const origins=new Set(['https://klient.prohous.pl','https://prohous-portal.vercel.app']);
 return async request=>{
  const origin=request.headers.get('origin'),allowed=!origin||origins.has(origin);
  const headers={'Cache-Control':'no-store','Content-Type':'application/json','Vary':'Origin',...(origin&&allowed?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(!allowed)return reply(403,{error:'Brak dostępu.'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Niedozwolona metoda.'});
  const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];if(!token)return reply(401,{error:'Zaloguj się ponownie.'});
  try{
   const admin=await services.authorize(token);if(!admin)return reply(403,{error:'Tylko administrator może usuwać bezpowrotnie.'});
   if(Number(request.headers.get('content-length')||0)>2048)return reply(413,{error:'Zbyt duże żądanie.'});
   const text=await request.text();if(text.length>2048)return reply(413,{error:'Zbyt duże żądanie.'});
   let body;try{body=JSON.parse(text)}catch{return reply(400,{error:'Niepoprawne żądanie.'})}
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body?.id)||typeof body.confirmation!=='string'||body.confirmation.length>1000)return reply(400,{error:'Niepoprawne potwierdzenie.'});
   if(body.action==='account'){
    const id=await services.requestAccount(token,body.id,body.confirmation);
    if(id!==body.id||id===admin.id)throw Error('Account mismatch');
    await services.deleteAccount(id);
    return reply(200,{message:'Usunięto konto i możliwość logowania. Inwestycje, pliki i rozliczenia zostały zachowane.'});
   }
   if(body.action==='document'){
    const paths=await services.startDocument(token,body.id,body.confirmation);
    for(let i=0;i<paths.document_paths.length;i+=100)await services.removeFiles(paths.document_paths.slice(i,i+100));
    for(let i=0;i<paths.scan_paths.length;i+=100)await services.removeScans(paths.scan_paths.slice(i,i+100));
    await services.finishDocument(body.id,admin);
    return reply(200,{message:'Bezpowrotnie usunięto dokument i jego pliki z portalu. Historia rozliczeń i oryginały Google Drive zostały zachowane.'});
   }
   if(body.action==='investment'){
    const paths=await services.startInvestment(token,body.id,body.confirmation);
    for(let i=0;i<paths.length;i+=100)await services.removeFiles(paths.slice(i,i+100));
    await services.finishInvestment(body.id,admin);
    return reply(200,{message:'Bezpowrotnie usunięto inwestycję, jej dokumenty i rozliczenia z portalu. Oryginały Google Drive pozostają bez zmian.'});
   }
   return reply(400,{error:'Niepoprawna operacja.'});
  }catch{return reply(409,{error:'Nie udało się zakończyć usuwania. Sprawdź potwierdzenie i uprawnienia. Jeśli rozpoczęto usuwanie, ponów tę samą operację w koszu — pliki mogły już zostać usunięte.'})}
 };
}
