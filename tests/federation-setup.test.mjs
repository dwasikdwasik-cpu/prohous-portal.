import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

function run(flags=[],options={}){
 const dir=mkdtempSync(join(tmpdir(),'prohous-wif-test-'));
 const log=join(dir,'calls.jsonl');
 writeFileSync(join(dir,'gcloud'),`#!/usr/bin/env node
const fs=require('node:fs'); const a=process.argv.slice(2);fs.appendFileSync(process.env.MOCK_GCLOUD_LOG,JSON.stringify(a)+'\\n');
const pool='projects/123456789/locations/global/workloadIdentityPools/prohous-portal';
if(a[0]==='projects')console.log('123456789');
else if(a[1]==='service-accounts'&&a[2]==='describe')console.log('prohous-portal@project-dcc520bb-b866-4147-a65.iam.gserviceaccount.com');
else if(a[2]==='list')console.log(process.env.MOCK_EMPTY?'':pool);
else if(a[2]==='describe')console.log('ACTIVE');
else if(a[3]==='list')console.log(process.env.MOCK_EMPTY?'':pool+'/providers/vercel-production');
else if(a[3]==='describe'){
const field=n=>a.find(x=>x.startsWith(n+'='))?.slice(n.length+1);
const condition="assertion.owner_id == 'team_CHkBCTDHHnuipFfpNfntp0Qy' && assertion.project_id == 'prj_YgaNjU6WFP8a7nEHGCdlUxmcS9UU' && assertion.environment == 'production' && assertion.sub == 'owner:prohous:project:prohous-portal:environment:production'";
console.log(JSON.stringify({state:'ACTIVE',oidc:{issuerUri:process.env.MOCK_BAD_PROVIDER?'https://attacker.invalid':'https://oidc.vercel.com/prohous',allowedAudiences:['https://vercel.com/prohous']},attributeCondition:condition,attributeMapping:{'google.subject':'assertion.sub','attribute.project_id':'assertion.project_id','attribute.owner_id':'assertion.owner_id','attribute.environment':'assertion.environment'}}));
}
`,{mode:0o700});
 try{
 const result=spawnSync('bash',['scripts/setup-google-federation.sh',...flags],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,MOCK_GCLOUD_LOG:log,...options}});
 return {...result,calls:existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[]};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('setup defaults to a plan without any Google mutation',()=>{const r=run();assert.equal(r.status,0);assert.deepEqual(r.calls,[])});
test('setup binds only the expected production subject',()=>{
 const r=run(['--apply']);assert.equal(r.status,0,r.stderr);
 const binding=r.calls.find(a=>a.includes('add-iam-policy-binding'));
 assert.ok(binding.includes('--role=roles/iam.workloadIdentityUser'));
 assert.ok(binding.includes('--member=principal://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/prohous-portal/subject/owner:prohous:project:prohous-portal:environment:production'));
 assert.match(r.stdout,/GCP_WORKLOAD_IDENTITY_AUDIENCE=\/\/iam.googleapis.com\/projects\/123456789\//);
 assert.ok(!r.calls.some(a=>a.includes('keys')||a.includes('org-policies')));
});
test('setup creates an issuer restricted by owner, project, production, and subject',()=>{
 const r=run(['--apply'],{MOCK_EMPTY:'1'});assert.equal(r.status,0,r.stderr);
 const provider=r.calls.find(a=>a.includes('create-oidc'));
 assert.ok(provider.includes('--issuer-uri=https://oidc.vercel.com/prohous'));
 const condition=provider.find(a=>a.startsWith('--attribute-condition='));
 assert.match(condition,/assertion.project_id == 'prj_YgaNjU6WFP8a7nEHGCdlUxmcS9UU'/);
 assert.match(condition,/assertion.owner_id == 'team_CHkBCTDHHnuipFfpNfntp0Qy'/);
 assert.match(condition,/assertion.environment == 'production'/);
});
test('a different existing provider stops before granting access',()=>{
 const r=run(['--apply'],{MOCK_BAD_PROVIDER:'1'});assert.notEqual(r.status,0);
 assert.ok(!r.calls.some(a=>a.includes('add-iam-policy-binding')));
 assert.match(r.stderr,/inną konfigurację/);
});
