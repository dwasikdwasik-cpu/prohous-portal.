function PersonnelDialog({title, onClose, busy, wide, children}) {
 const h = D.createElement, dialog = D.useRef(null);
 D.useEffect(() => {
  const element = dialog.current;
  const opener = document.activeElement;
  element.showModal();
  return () => {
   element.close();
   if (opener?.isConnected) opener.focus();
  };
 }, []);
 return h('dialog', {
  ref:dialog, className:'phDocumentDialog'+(wide?' phDocumentWide':''),
  'aria-labelledby':'ph-document-heading',
  onCancel:e=>{e.preventDefault(); if(!busy) onClose();}
 }, h('h2',{id:'ph-document-heading'},title), children);
}

function PersonnelFilePreview({file, url, onClose}) {
 const h=D.createElement, canvas=D.useRef(null);
 const [content,setContent]=D.useState(null), [error,setError]=D.useState('');
 const [page,setPage]=D.useState(1), [painted,setPainted]=D.useState(0);
 D.useEffect(()=>{
  const abort=new AbortController();
  let loading, imageUrl;
  async function read(){
   const response=await fetch(url,{cache:'no-store',signal:abort.signal});
   if(!response.ok)throw Error(response.status===401?'Sesja wygasła. Zaloguj się ponownie.':'Nie udało się pobrać dokumentu.');
   const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
   if(mime!==file.mime)throw Error('Serwer zwrócił inny typ pliku niż zapisany w kartotece.');
   if(mime==='application/pdf'){
    const [pdf,bytes]=await Promise.all([import(__PDF_MODULE__),response.arrayBuffer()]);
    if(abort.signal.aborted)return;
    pdf.GlobalWorkerOptions.workerSrc='/ocr/pdf.worker.min.mjs';
    loading=pdf.getDocument({data:new Uint8Array(bytes),isEvalSupported:false});
    const doc=await loading.promise;
    if(!abort.signal.aborted)setContent({pdf:doc});
   }else if(mime==='text/plain'){
    const text=await response.text();
    if(!abort.signal.aborted)setContent({text});
   }else if(mime==='image/png'||mime==='image/jpeg'){
    const blob=await response.blob();
    if(abort.signal.aborted)return;
    imageUrl=URL.createObjectURL(blob);
    setContent({image:imageUrl});
   }else throw Error('Ten typ dokumentu można pobrać.');
  }
  read().catch(e=>{if(!abort.signal.aborted)setError(e.message||'Nie udało się otworzyć pliku.');});
  return ()=>{abort.abort(); if(loading)void loading.destroy().catch(()=>{}); if(imageUrl)URL.revokeObjectURL(imageUrl);};
 },[file.id,file.mime,url]);
 D.useEffect(()=>{
  if(!content?.pdf)return;
  let cancelled=false, job;
  async function paint(){
   const sheet=await content.pdf.getPage(page);
   if(cancelled)return;
   const element=canvas.current, base=sheet.getViewport({scale:1});
   const width=Math.max(250,element.parentElement.clientWidth);
   const scale=Math.min(width*Math.min(window.devicePixelRatio||1,2)/base.width,2200/Math.max(base.width,base.height));
   const viewport=sheet.getViewport({scale});
   element.width=Math.ceil(viewport.width); element.height=Math.ceil(viewport.height);
   job=sheet.render({canvas:element,viewport});
   await job.promise;
   if(!cancelled)setPainted(page);
  }
  paint().catch(e=>{if(!cancelled){console.warn('Podgląd PDF:',e.message);setError('Nie udało się wyświetlić tej strony dokumentu.');}});
  return ()=>{cancelled=true;if(job)job.cancel();};
 },[content,page]);
 const count=content?.pdf?.numPages||0;
 function turn(p){setPainted(0);setPage(p);}
 return h(PersonnelDialog,{title:file.title,onClose,wide:true},
  h('div',{className:'phDocumentControls'},
   h('button',{type:'button',className:'secondary',onClick:onClose},'Zamknij podgląd'),
   h('a',{className:'secondary',href:url+'&download=1',download:file.filename},'Pobierz plik')),
  error?h('p',{role:'alert'},error):h(D.Fragment,null,
   (!content||(count&&painted!==page))?h('p',{role:'status'},'Wczytywanie podglądu…'):null,
   count>0&&h('div',{className:'phDocumentControls'},
    h('button',{type:'button',className:'secondary',disabled:page===1,onClick:()=>turn(page-1)},'Poprzednia'),
    h('span',{'aria-live':'polite'},'Strona '+page+' z '+count),
    h('button',{type:'button',className:'secondary',disabled:page===count,onClick:()=>turn(page+1)},'Następna')),
   h('div',{className:'phDocumentBody'},
    count>0&&h('canvas',{ref:canvas,role:'img','aria-label':'Podgląd strony '+page,style:{visibility:painted===page?'visible':'hidden'}}),
    content?.image&&h('img',{src:content.image,alt:file.title,onError:()=>setError('Nie udało się odczytać obrazu.')}),
    content?.text!==undefined&&h('pre',null,content.text))));
}
