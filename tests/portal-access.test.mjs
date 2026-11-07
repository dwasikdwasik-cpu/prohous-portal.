import test from 'node:test';
import assert from 'node:assert/strict';
import {portalAccessAllowed} from '../lib/portal-access.mjs';
test('approved managers can manage documents while full administrator checks remain restricted',()=>{
 assert.equal(portalAccessAllowed({role:'manager',status:'approved'},'document-management'),true);
 assert.equal(portalAccessAllowed({role:'manager',status:'approved'},true),false);
 assert.equal(portalAccessAllowed({role:'admin',status:'approved'},true),true);
 assert.equal(portalAccessAllowed({role:'admin',status:'approved'},'document-management'),true);
});
test('clients and installers retain portal access without document management permission',()=>{
 for(const role of ['client','electrician','plumber']){
  const profile={role,status:'approved'};
  assert.equal(portalAccessAllowed(profile),true);
  assert.equal(portalAccessAllowed(profile,'document-management'),false);
  assert.equal(portalAccessAllowed(profile,true),false);
 }
});
test('pending, blocked and unknown profiles cannot gain access',()=>{
 for(const role of ['admin','manager','client','electrician','plumber'])for(const status of ['pending','rejected'])for(const requirement of [false,true,'document-management'])assert.equal(portalAccessAllowed({role,status},requirement),false);
 for(const profile of [null,undefined,{}, {role:'unknown',status:'approved'}])assert.equal(portalAccessAllowed(profile),false);
});
