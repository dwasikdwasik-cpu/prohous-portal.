import {downloadZip} from 'client-zip';
const extensions={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
export function safeArchiveName(value){return String(value||'pliki').normalize('NFC').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').replace(/\.{2,}/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,160)||'pliki'}
export function archiveEntryName(index,value,mime){
 let name=safeArchiveName(value||'plik'),extension=extensions[String(mime||'').split(';')[0]];
 if(extension&&!new RegExp('\\.'+(extension==='jpg'?'jpe?g':extension)+'$','i').test(name))name+='.'+extension;
 return String(index+1).padStart(4,'0')+'_'+name;
}
/**
 * Stream original files through their existing authenticated download endpoint.
 * @param {Array<Record<string,any>>} items
 * @param {{download:(id:string)=>Promise<Response>,onProgress?:(completed:number,total:number,title:string)=>void}} options
 */
export function createDocumentArchive(items,{download,onProgress=()=>{}}){
 if(!items.length)throw Error('Brak plików do pobrania.');
 const snapshot=items.map(item=>({...item}));
 async function* files(){
  for(let index=0;index<snapshot.length;index++){
   const item=snapshot[index];
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))throw Error('Nieprawidłowy identyfikator dokumentu.');
   onProgress(index,snapshot.length,item.title);
   let response;try{response=await download(item.id)}catch{throw Error('Nie udało się pobrać pliku „'+safeArchiveName(item.title)+'”. Sprawdź połączenie i dostęp do pliku.');}
   if(!response.ok)throw Error('Nie udało się pobrać pliku „'+safeArchiveName(item.title)+'”. Archiwum nie zostało ukończone.');
   let originalName=item.title;const header=response.headers.get('x-download-name');if(header)try{originalName=decodeURIComponent(header)}catch{}
   const name=archiveEntryName(index,originalName,item.mime_type||response.headers.get('content-type'));
   const date=new Date(item.created_at||Date.now());
   yield {name,input:response,lastModified:Number.isFinite(date.getTime())?date:new Date()};
   onProgress(index+1,snapshot.length,item.title);
  }
 }
 return downloadZip(files());
}
