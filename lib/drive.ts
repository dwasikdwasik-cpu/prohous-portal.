import {createSign} from 'node:crypto';
import {getVercelOidcToken} from '@vercel/oidc';
import {federatedDriveToken} from './google-federation.mjs';
let cached:{token:string,expires:number}|undefined;
export async function driveToken(){
 if(cached&&cached.expires>Date.now()+60000)return cached.token;
 if(process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE){
  cached=await federatedDriveToken({oidcToken:await getVercelOidcToken(),audience:process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE,serviceAccountEmail:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL});
  return cached.token;
 }
 const key=process.env.GOOGLE_SERVICE_ACCOUNT_JSON?JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON):{client_email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n')};if(!key.client_email||!key.private_key)throw new Error('503');
 const now=Math.floor(Date.now()/1000),b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:key.client_email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const sign=createSign('RSA-SHA256');sign.update(unsigned);const assertion=unsigned+'.'+sign.sign(key.private_key,'base64url');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),cache:'no-store'});if(!r.ok)throw new Error('502');
 const data=await r.json();cached={token:data.access_token,expires:Date.now()+data.expires_in*1000};return cached.token;
}
export async function driveGet(path:string){const token=await driveToken();const r=await fetch('https://www.googleapis.com/drive/v3/'+path,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)throw new Error(r.status===404?'404':'502');return r;}
export const validDriveId=(id:string)=>/^[a-zA-Z0-9_-]{10,200}$/.test(id);
export async function fileInFolder(fileId:string,folderId:string){
 let current=fileId;
 for(let depth=0;depth<30;depth++){
 const meta=await (await driveGet(`files/${encodeURIComponent(current)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`)).json();
 if(meta.trashed)return false;if(meta.parents?.includes(folderId))return true;
 if(!meta.parents?.length)return false;current=meta.parents[0];
 }return false;
}
