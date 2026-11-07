/**
 * General portal use, document management and full administration are distinct.
 * @param {{role?:string,status?:string}|null|undefined} profile
 * @param {boolean|'document-management'} requirement
 */
export function portalAccessAllowed(profile,requirement=false){
 if(profile?.status!=='approved')return false;
 const role=profile.role;
 if(requirement===true)return role==='admin';
 if(requirement==='document-management')return role==='admin'||role==='manager';
 if(requirement!==false)return false;
 return ['admin','manager','client','electrician','plumber','employee'].includes(role);
}
