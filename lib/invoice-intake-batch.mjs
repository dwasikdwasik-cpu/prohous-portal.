/** Cleanup is deliberately sequential. The existing endpoint must verify each
 * imported document and its source before removing anything from Drive. */
export async function cleanupScanBatch(items,cleanup,onResult=(_item,_result)=>{}){
 const eligible=items.filter(item=>item.status==='imported'&&item.document_id&&!item.deleted_at);
 let cleaned=0,failed=0;
 for(const item of eligible){
  let result;
  try{result=await cleanup(item);if(result.cleaned===true)cleaned++;else failed++;}
  catch(error){failed++;result={cleaned:false,error:error instanceof Error?error.message:'Nie udało się usunąć skanu.'};}
  onResult(item,result);
 }
 return {cleaned,failed,total:eligible.length};
}
