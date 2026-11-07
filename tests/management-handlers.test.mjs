import test from 'node:test';import assert from 'node:assert/strict';import {createEmployeeHandler} from '../supabase/functions/project-employee-login/handler.mjs';import {createRemovalHandler} from '../supabase/functions/portal-permanent-removal/handler.mjs';import {isEmployeeLogin,signInEmployee} from '../lib/employee-login.mjs';
const employee={id:'00000000-0000-0000-0000-000000000006',role:'employee',status:'approved'};
const request=(body,auth=false)=>new Request('https://example.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer token'}:{})},body:JSON.stringify(body)});
function employeeServices(overrides={}){const calls=[];return {calls,checkPin:async pin=>{calls.push('pin');return {valid:pin==='1234',retry_after:0,user_id:employee.id}},getProfile:async()=>employee,createEmployee:async()=>{calls.push('create');return employee},bindEmployee:async()=>{calls.push('bind')},login:async()=>{calls.push('login');return {user:{id:employee.id},access_token:'user-access',refresh_token:'user-refresh'}},...overrides}}
test('employee login checks the PIN before provisioning and returns only a matching project employee session',async()=>{
 const services=employeeServices();const handler=createEmployeeHandler(services);
 assert.equal((await handler(request({login:'pracownik',password:'9999'}))).status,401);assert.deepEqual(services.calls,['pin']);services.calls.length=0;
 const response=await handler(request({login:'Pracownik',password:'1234',role:'admin'}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{access_token:'user-access',refresh_token:'user-refresh'});assert.deepEqual(services.calls,['pin','login']);
 for(const profile of [{...employee,role:'admin'},{...employee,status:'rejected'},null]){
  const denied=employeeServices({getProfile:async()=>profile});const r=await createEmployeeHandler(denied)(request({login:'pracownik',password:'1234'}));assert.equal(r.status,403);assert.ok(!denied.calls.includes('login'));assert.ok(!denied.calls.includes('create'));
 }
});
test('PIN rate limits, first creation and session identity checks fail closed',async()=>{
 const limited=employeeServices({checkPin:async()=>({valid:false,retry_after:60})});assert.equal((await createEmployeeHandler(limited)(request({login:'pracownik',password:'1234'}))).status,429);assert.ok(!limited.calls.includes('create'));
 let created=false;const fresh=employeeServices({checkPin:async()=>({valid:true,retry_after:0,user_id:null}),getProfile:async()=>created?employee:null,createEmployee:async()=>{created=true;return employee}});
 assert.equal((await createEmployeeHandler(fresh)(request({login:'pracownik',password:'1234'}))).status,200);assert.ok(fresh.calls.includes('bind'));
 const wrong=employeeServices({login:async()=>({user:{id:'other'},access_token:'secret',refresh_token:'secret'})});const response=await createEmployeeHandler(wrong)(request({login:'pracownik',password:'1234'}));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('secret'));
});
test('employee alias signs in through the dedicated function and propagates blocked-login errors',async()=>{
 assert.equal(isEmployeeLogin(' Pracownik '),true);assert.equal(isEmployeeLogin('admin@prohous.pl'),false);
 const calls=[];const db={functions:{invoke:async(name,options)=>{calls.push([name,options]);return {data:{access_token:'access',refresh_token:'refresh'},error:null}}},auth:{setSession:async session=>{calls.push(session);return {data:{},error:null}}}};
 await signInEmployee(db,'1234');assert.equal(calls[0][0],'project-employee-login');assert.equal(calls[0][1].body.password,'1234');assert.equal(calls[1].access_token,'access');
 db.functions.invoke=async()=>({error:{context:{json:async()=>({error:'Blocked'})}}});await assert.rejects(()=>signInEmployee(db,'1234'),/Blocked/);
});
const admin={id:'00000000-0000-0000-0000-000000000001',sessionId:'10000000-0000-0000-0000-000000000001'};
function removalServices(overrides={}){const calls=[];return {calls,authorize:async()=>admin,requestAccount:async(token,id)=>{calls.push('request');return id},deleteAccount:async()=>{calls.push('delete-account')},startInvestment:async()=>{calls.push('start');return ['own/one.pdf','own/two.pdf']},removeFiles:async paths=>{calls.push(['files',paths])},finishInvestment:async()=>{calls.push('finish')},...overrides}}
test('account removal verifies admin and exact database-approved identity before deleting',async()=>{
 const services=removalServices();const handler=createRemovalHandler(services);const body={action:'account',id:employee.id,confirmation:'employee@test.invalid'};
 assert.equal((await handler(request(body))).status,401);assert.equal(services.calls.length,0);
 const unauthorized=removalServices({authorize:async()=>null});assert.equal((await createRemovalHandler(unauthorized)(request(body,true))).status,403);assert.equal(unauthorized.calls.length,0);
 assert.equal((await handler(request(body,true))).status,200);assert.deepEqual(services.calls,['request','delete-account']);
 const mismatch=removalServices({requestAccount:async()=>admin.id});assert.equal((await createRemovalHandler(mismatch)(request(body,true))).status,409);assert.ok(!mismatch.calls.includes('delete-account'));
});
test('investment purge uses only database-returned paths and never finalizes after a Storage failure',async()=>{
 const services=removalServices();const body={action:'investment',id:employee.id,confirmation:'Purge',paths:['arbitrary/other.pdf']};
 assert.equal((await createRemovalHandler(services)(request(body,true))).status,200);assert.deepEqual(services.calls,['start',['files',['own/one.pdf','own/two.pdf']],'finish']);
 const failed=removalServices({removeFiles:async()=>{throw Error('Storage offline')}});assert.equal((await createRemovalHandler(failed)(request(body,true))).status,409);assert.ok(!failed.calls.includes('finish'));
});
