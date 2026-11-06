export const UPLOAD_BUCKET='portal-documents';
export const MAX_UPLOAD_BYTES=25*1024*1024;
export const MAX_UPLOAD_FILES=50;
const types={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
export const UPLOAD_MIME_TYPES=new Set(Object.values(types));
export async function inspectUpload(file,category){
 if(!['zdjecia','faktury','umowy','protokoly','inne'].includes(category))throw Error('Wybierz kategorię.');
 if(!file.size)throw Error('Plik jest pusty.');
 if(file.size>MAX_UPLOAD_BYTES)throw Error('Plik przekracza 25 MB.');
 const extension=file.name.split('.').pop()?.toLowerCase();
 const mime=types[extension];
 if(!mime)throw Error('Dozwolone formaty: PDF, JPG, PNG, WEBP, GIF, DOCX i XLSX.');
 if(category==='zdjecia'&&!mime.startsWith('image/'))throw Error('W kategorii Zdjęcia wybierz plik JPG, PNG, WEBP lub GIF.');
 const b=new Uint8Array(await file.slice(0,16).arrayBuffer()),s=String.fromCharCode(...b);
 const valid=extension==='pdf'?s.startsWith('%PDF-'):
 ['jpg','jpeg'].includes(extension)?b[0]===255&&b[1]===216&&b[2]===255:
 extension==='png'?[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v):
 extension==='webp'?s.startsWith('RIFF')&&s.slice(8,12)==='WEBP':
 extension==='gif'?/^GIF8[79]a/.test(s):b[0]===80&&b[1]===75&&b[2]===3&&b[3]===4;
 if(!valid)throw Error('Zawartość pliku nie odpowiada jego rozszerzeniu.');
 return {mime,extension:extension==='jpeg'?'jpg':extension};
}
export async function serveUploadedDocument(doc,services){
 const failure=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store'}});
 if(!doc||doc.deleted_at||typeof doc.storage_path!=='string'||!doc.storage_path.startsWith(doc.investment_id+'/')||!new RegExp('^[0-9a-f-]{36}/[0-9a-f-]{36}\\.(pdf|jpg|png|webp|gif|docx|xlsx)$').test(doc.storage_path))return failure('Nie znaleziono dokumentu.',404);
 try{
  const file=await services.info(doc.storage_path);
  if(!file||!UPLOAD_MIME_TYPES.has(file.contentType))return failure('Nieobsługiwany plik.',404);
  if(!Number.isFinite(Number(file.size))||Number(file.size)<=0||Number(file.size)>MAX_UPLOAD_BYTES)return failure('Nieprawidłowy rozmiar pliku.',413);
  const url=await services.sign(doc.storage_path,(doc.title||'dokument').replace(/[\r\n\x00-\x1f]/g,''));
  // Never release the short-lived download URL if recording access fails.
  await services.audit(doc.id);
  return new Response(null,{status:307,headers:{Location:url,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
 }catch{return failure('Nie udało się pobrać pliku. Spróbuj ponownie.',503)}
}
