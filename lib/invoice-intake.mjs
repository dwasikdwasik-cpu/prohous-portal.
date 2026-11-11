export const INVOICE_INBOX_FOLDER='1yIbjkSP3tsa4XsWVxlNMNia5Ah3SqmV4';
export const INTAKE_BUCKET='invoice-intake';
export const SCAN_TYPES={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
export const MAX_SCAN_BYTES=25*1024*1024;
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[łŁ]/g,'l').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const contains=(text,term)=>(' '+text+' ').includes(' '+term+' ');
/** Only a unique full client name or investment reference is sufficient; seller data is excluded. */
export function matchInvoiceClient({filename='',text=''},targets){
 const lines=String(text).split(/[\r\n]+/),sections=[];let delivery=false;
 for(const line of lines){const n=normalize(line);if(/^(odbiorca|miejsce dostawy|adres dostawy|adres inwestycji|inwestycja|uwagi|klient)\b/.test(n))delivery=true;if(/^(sprzedawca|wystawca|pozycje|podsumowanie|rachunek bankowy)\b/.test(n))delivery=false;if(delivery)sections.push(line)}
 const source=normalize(filename+' '+sections.join(' '));
 const matches=[];
 for(const target of targets){const terms=[target.investment_name,target.client_name];const hit=terms.map(normalize).find(t=>t.length>=8&&t.split(' ').length>=2&&!/^(prohous|prohouse)\b/.test(t)&&contains(source,t));if(hit)matches.push({id:target.investment_id,reason:'Znaleziono pełną nazwę: '+hit})}
 if(matches.length===1)return {investment_id:matches[0].id,automatic:true,reason:matches[0].reason};
 return {investment_id:null,automatic:false,reason:matches.length?'Pasuje więcej niż jedna inwestycja — wybierz ręcznie.':'Brak jednoznacznej nazwy klienta lub inwestycji w nazwie pliku / danych dostawy.'};
}
export function validateScan(meta,folder=INVOICE_INBOX_FOLDER){
 if(!meta||meta.trashed||!meta.parents?.includes(folder))throw Error('Plik nie należy do folderu SCAN - FA.');
 if(!SCAN_TYPES[meta.mimeType])throw Error('Obsługiwane skany: PDF, JPG, PNG, WEBP.');
 if(!(Number(meta.size)>0)||Number(meta.size)>MAX_SCAN_BYTES)throw Error('Skany muszą mieć od 1 bajtu do 25 MB.');
 return SCAN_TYPES[meta.mimeType];
}
/** Never remove the source unless the assigned, published copy has been read back and verified. */
export async function cleanupImportedScan(item,services){
 const doc=await services.document(item.document_id);
 if(!doc||doc.source_intake_id!==item.id||doc.deleted_at||!doc.published||doc.investment_id!==item.assigned_investment_id||doc.storage_path!==item.target_storage_path||!item.content_sha256||doc.content_sha256!==item.content_sha256)throw Error('Brak potwierdzonej faktury w profilu klienta. Oryginał pozostaje w folderze.');
 const hash=await services.destinationHash(doc.storage_path);
 if(hash!==item.content_sha256)throw Error('Kopia nie jest zgodna ze skanem. Oryginał pozostaje w folderze.');
 const meta=await services.metadata(item.drive_file_id);
 if(meta.trashed||Array.isArray(meta.parents)&&!meta.parents.includes(INVOICE_INBOX_FOLDER))return {alreadyRemoved:true};
 validateScan(meta);
 if(String(meta.version)!==String(item.source_version))throw Error('Skan zmienił się od pobrania. Oryginał pozostaje w folderze.');
 const sourceHash=await services.sourceHash(item.drive_file_id);
 if(sourceHash!==item.content_sha256)throw Error('Kopia różni się od oryginału w Drive. Oryginał pozostaje w folderze.');
 const fresh=await services.metadata(item.drive_file_id);validateScan(fresh);
 if(String(fresh.version)!==String(item.source_version))throw Error('Skan zmienił się podczas weryfikacji. Oryginał pozostaje w folderze.');
 // Conditional PATCH also protects against changes between metadata read and trash.
 if(!fresh.etag)throw Error('Brak warunku bezpiecznej zmiany pliku. Oryginał pozostaje w folderze.');
 const result=await services.remove(item.drive_file_id,fresh.etag,fresh.capabilities);
 if(result?.removed!==true)throw Error('Nie potwierdzono usunięcia z folderu.');
 return {alreadyRemoved:false};
}

/** Shared Drive files may omit parents/version in files.get. Prove membership by the inbox listing. */
export async function confirmInboxMetadata(fileId,meta,readPage){
 if(meta.trashed)return meta;
 if(meta.parents?.includes(INVOICE_INBOX_FOLDER)&&meta.version)return meta;
 let token=null;const seen=new Set();
 do{
  const page=await readPage(token),entry=page.files?.find(file=>file.id===fileId);
  if(entry){
   if(meta.version&&entry.version&&String(meta.version)!==String(entry.version))throw Error('Skan zmienił się podczas sprawdzania folderu. Ponów odczyt.');
   return {...meta,version:entry.version||meta.version,mimeType:meta.mimeType||entry.mimeType,size:meta.size||entry.size,parents:[INVOICE_INBOX_FOLDER]};
  }
  token=page.nextPageToken||null;
  if(token&&seen.has(token))throw Error('Nie udało się sprawdzić całego folderu skanera. Ponów odczyt.');
  if(token)seen.add(token);
 }while(token);
 return {...meta,parents:[]};
}
