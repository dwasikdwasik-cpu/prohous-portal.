  if(body.action==='document_delete'){
   const payload={id:body.id,session};
   const pending=await rpc({...payload,action:'purge_begin'},actor);
   if(pending.error)return reply(pending,pending.status||400);
   if(pending.done===true)return reply({ok:true});
   if(typeof pending.path!=='string'||!pending.path)return reply({error:'Brak ścieżki dokumentu.'},502);
   // Storage's bulk-remove endpoint takes exact object names and succeeds for a previously removed key.
   const removed=await fetch(url+'/storage/v1/object/employee-documents',{
    method:'DELETE',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({prefixes:[pending.path]})
   });
   if(!removed.ok)return reply({error:'Nie ukończono usuwania pliku. Ponów usunięcie w archiwum.'},502);
   const key=pending.path.split('/').map(encodeURIComponent).join('/');
   const verify=await fetch(url+'/storage/v1/object/authenticated/employee-documents/'+key,{
    headers:{...headers,Range:'bytes=0-0'},cache:'no-store'
   });
   let missing=verify.status===404;
   if(!missing&&verify.status===400){
    const problem=await verify.json().catch(()=>({}));
    missing=String(problem.statusCode)==='404'||['NoSuchKey','ObjectNotFound','NoSuchObject'].includes(problem.code||problem.error);
   }else await verify.body?.cancel();
   if(!missing)return reply({error:'Nie potwierdzono usunięcia pliku. Ponów usunięcie w archiwum.'},502);
   const result=await rpc({...payload,action:'purge_finish'},actor);
   if(result.ok!==true)return reply({error:result.error||'Ponów usuwanie w archiwum.'},result.status||502);
   return reply({ok:true});
  }
