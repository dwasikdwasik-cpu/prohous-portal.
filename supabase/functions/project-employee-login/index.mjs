import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {createEmployeeHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),anonKey=Deno.env.get('SUPABASE_ANON_KEY');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,serviceKey,options),email='pracownik@prohous.pl';
// A platform secret derives an internal Auth password. The four-digit PIN is
// stored only as a hash in the private login table, and is never an Auth password.
const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(serviceKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('prohouse-project-employee-auth-v1')));
const password='P!'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function getProfile(id){const query=service.from('profiles').select('id,role,status');const {data,error}=await(id?query.eq('id',id):query.eq('email',email)).maybeSingle();if(error)throw error;return data}
Deno.serve(createEmployeeHandler({
 async checkPin(pin){const {data,error}=await service.rpc('check_project_employee_pin',{p_pin:pin});if(error||!data?.[0])throw Error('PIN validation unavailable');return data[0]},
 getProfile,
 async createEmployee(){
  const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'Pracownik'}});if(error||!data.user)throw Error('Account creation failed');
  const {error:updateError}=await service.from('profiles').update({role:'employee',status:'approved'}).eq('id',data.user.id);
  if(updateError){await service.auth.admin.deleteUser(data.user.id);throw Error('Profile setup failed')}
  const profile=await getProfile(data.user.id);if(!profile)throw Error('Profile missing');return profile;
 },
 async bindEmployee(id){const {error}=await service.rpc('bind_project_employee',{p_user_id:id});if(error)throw error},
 async login(){const client=createClient(url,anonKey,options);const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;return data.session}
}));
