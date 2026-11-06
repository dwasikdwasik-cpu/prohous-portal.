import {test} from 'node:test';
import assert from 'node:assert/strict';
import {federatedDriveToken} from '../lib/google-federation.mjs';
const config={oidcToken:'platform-assertion',audience:'//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/prohous-portal/providers/vercel-production',serviceAccountEmail:'portal@example-project.iam.gserviceaccount.com'};
const expires=new Date(Date.now()+3600000).toISOString();
test('federation exchanges the assertion and requests only Drive read access',async()=>{
 const calls=[];
 const token=await federatedDriveToken(config,async(url,init)=>{
  calls.push({url,init});
  return Response.json(calls.length===1?{access_token:'federated-identity'}:{accessToken:'drive-token',expireTime:expires});
 });
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,'https://sts.googleapis.com/v1/token');
 assert.equal(calls[0].init.body.get('subject_token'),'platform-assertion');
 assert.equal(calls[0].init.body.get('audience'),config.audience);
 assert.match(calls[1].url,/^https:\/\/iamcredentials\.googleapis\.com\//);
 assert.equal(calls[1].init.headers.Authorization,'Bearer federated-identity');
 assert.deepEqual(JSON.parse(calls[1].init.body),{scope:['https://www.googleapis.com/auth/drive.readonly'],lifetime:'3600s'});
 assert.equal(token.token,'drive-token');
 assert.equal(token.expires,Date.parse(expires));
});
for(const badConfig of [{...config,audience:'https://attacker.invalid'},{...config,serviceAccountEmail:'user@attacker.invalid'},{...config,oidcToken:''}])test('invalid configuration never releases a platform assertion',async()=>{
 let contacted=false;await assert.rejects(federatedDriveToken(badConfig,async()=>{contacted=true}),/503/);assert.equal(contacted,false);
});
test('denied federation stops before impersonation and hides provider detail',async()=>{
 let count=0;await assert.rejects(federatedDriveToken(config,async()=>{count++;return Response.json({error:'private-provider-details'},{status:403})}),/^Error: 502$/);assert.equal(count,1);
});
for(const response of [{},{accessToken:'drive-token',expireTime:'invalid'},{accessToken:'drive-token',expireTime:'2000-01-01T00:00:00Z'}])test('malformed or expired tokens are rejected',async()=>{
 let count=0;await assert.rejects(federatedDriveToken(config,async()=>Response.json(++count===1?{access_token:'identity'}:response)),/502/);
});
test('missing intermediate token prevents impersonation',async()=>{
 let count=0;await assert.rejects(federatedDriveToken(config,async()=>{count++;return Response.json({})}),/502/);assert.equal(count,1);
});
