// The public entry point authenticates a fixed project-only account by PIN.
// It never accepts a role, user ID, email, or permissions from the request.
export function createEmployeeHandler(services){
 const origins=new Set(['https://klient.prohous.pl','https://prohous-portal.vercel.app']);
 return async request=>{
  const origin=request.headers.get('origin'),allowed=!origin||origins.has(origin);
  const headers={'Cache-Control':'no-store','Content-Type':'application/json','Vary':'Origin',...(origin&&allowed?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const reply=(status,body,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
  if(!allowed)return reply(403,{error:'Brak dostępu.'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Niedozwolona metoda.'});
  try{
   if(Number(request.headers.get('content-length')||0)>1024)return reply(413,{error:'Zbyt duże żądanie.'});
   const text=await request.text();if(text.length>1024)return reply(413,{error:'Zbyt duże żądanie.'});
   let body;try{body=JSON.parse(text)}catch{return reply(400,{error:'Niepoprawne żądanie.'})}
   if(typeof body?.login!=='string'||body.login.trim().toLowerCase()!=='pracownik'||typeof body.password!=='string'||!/^\d{4}$/.test(body.password))return reply(401,{error:'Nieprawidłowy login lub hasło.'});
   const result=await services.checkPin(body.password);
   if(result.retry_after>0)return reply(429,{error:'Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut.'},{'Retry-After':String(result.retry_after)});
   if(!result.valid)return reply(401,{error:'Nieprawidłowy login lub hasło.'});
   let profile=await services.getProfile(result.user_id);
   if(!profile){if(result.user_id)return reply(403,{error:'Konto pracownika jest niedostępne.'});profile=await services.createEmployee()}
   if(profile.role!=='employee'||profile.status!=='approved'||(result.user_id&&result.user_id!==profile.id))return reply(403,{error:'Konto pracownika jest niedostępne.'});
   if(!result.user_id)await services.bindEmployee(profile.id);
   const session=await services.login();
   if(!session||session.user?.id!==profile.id)throw Error('Session mismatch');
   // Recheck current permissions after authentication, including concurrent blocks.
   const current=await services.getProfile(profile.id);
   if(current?.role!=='employee'||current.status!=='approved')return reply(403,{error:'Konto pracownika jest niedostępne.'});
   return reply(200,{access_token:session.access_token,refresh_token:session.refresh_token});
  }catch{return reply(503,{error:'Logowanie pracownika jest chwilowo niedostępne. Spróbuj ponownie.'})}
 };
}
