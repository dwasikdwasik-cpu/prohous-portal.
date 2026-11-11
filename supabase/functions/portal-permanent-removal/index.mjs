import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {createRemovalHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),anonKey=Deno.env.get('SUPABASE_ANON_KEY');
const options={auth:{persistSession:false,autoRefreshToken:false}},service=createClient(url,serviceKey,options);
const userClient=token=>createClient(url,anonKey,{...options,global:{headers:{Authorization:'Bearer '+token}}});
async function rpc(token,name,values){const {data,error}=await userClient(token).rpc(name,values);if(error)throw error;return data}
Deno.serve(createRemovalHandler({
 async authorize(token){
  const {data,error}=await service.auth.getUser(token);if(error||!data.user)return null;
  const {data:profile}=await service.from('profiles').select('role,status').eq('id',data.user.id).single();if(profile?.role!=='admin'||profile.status!=='approved')return null;
  const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
  if(typeof payload.session_id!=='string')return null;
  return {id:data.user.id,sessionId:payload.session_id};
 },
 requestAccount:(token,id,confirmation)=>rpc(token,'request_portal_account_removal',{p_user_id:id,p_confirmation:confirmation}),
 async deleteAccount(id){const {error}=await service.auth.admin.deleteUser(id,false);if(error)throw error},
 startDocument:(token,id,confirmation)=>rpc(token,'start_portal_document_removal',{p_document_id:id,p_confirmation:confirmation}),
 async removeScans(paths){const {error}=await service.storage.from('invoice-intake').remove(paths);if(error)throw error},
 async finishDocument(id,admin){const {error}=await service.rpc('finish_portal_document_removal',{p_document_id:id,p_actor:admin.id,p_session_id:admin.sessionId});if(error)throw error},
 startInvestment:(token,id,confirmation)=>rpc(token,'start_portal_investment_removal',{p_investment_id:id,p_confirmation:confirmation}),
 async removeFiles(paths){const {error}=await service.storage.from('portal-documents').remove(paths);if(error)throw error},
 async finishInvestment(id,admin){const {error}=await service.rpc('finish_portal_investment_removal',{p_investment_id:id,p_actor:admin.id,p_session_id:admin.sessionId});if(error)throw error}
}));
