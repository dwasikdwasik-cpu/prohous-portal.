'use client';
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type {PDFDocumentProxy,PDFDocumentLoadingTask,RenderTask} from 'pdfjs-dist';
import {previewType} from '../lib/document-preview.mjs';

export type InvoiceAssignment={client:string,investment:string,confirmed:boolean};
export default function DocumentPreview({file,title,filename,assignment,fileError,children,onClose}:{file:Blob|null,title:string,filename:string,assignment?:InvoiceAssignment|null,fileError?:string,children?:ReactNode,onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[image,setImage]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const fallbackUrl=useRef('');
 const [nativePdf,setNativePdf]=useState('');
 useEffect(()=>{dialog.current?.showModal()},[]);
 useEffect(()=>{
  let active=true;
  let task:PDFDocumentLoadingTask|undefined;
  let url='';
  setLoading(true);setError('');setPdf(null);setImage('');setNativePdf('');setPage(1);
  if(!file){setLoading(!fileError);setError(fileError||'');return}
  (async()=>{
   const mime=await previewType(file);
   if(!active)return;
   if(mime==='application/pdf'){
    const blob=file.type===mime?file:new Blob([file],{type:mime});
    url=URL.createObjectURL(blob);
    fallbackUrl.current=url;
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    if(!active)return;
    pdfjs.GlobalWorkerOptions.workerSrc='/ocr/pdf.preview.worker.min.mjs';
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(!active)return;
    task=pdfjs.getDocument({data:bytes,standardFontDataUrl:'/ocr/standard_fonts/',cMapUrl:'/ocr/cmaps/',cMapPacked:true});
    const document=await task.promise;
    if(active)setPdf(document);
   }else if(mime?.startsWith('image/')){
    url=URL.createObjectURL(new Blob([file],{type:mime}));
    setImage(url);setLoading(false);
   }else{
    setError('Ten format nie obsługuje podglądu. Możesz pobrać dokument.');setLoading(false);
   }
  })().catch(()=>{
   if(!active)return;
   if(fallbackUrl.current)setNativePdf(fallbackUrl.current);
   else setError('Nie udało się wyświetlić podglądu. Możesz pobrać dokument.');
   setLoading(false);
  });
  return()=>{
   active=false;
   fallbackUrl.current='';
   if(url)URL.revokeObjectURL(url);
   if(task)void task.destroy().catch(()=>{});
  };
 },[file,fileError]);
 useEffect(()=>{
  if(!pdf||nativePdf||!canvas.current)return;
  let active=true,render:RenderTask|undefined;
  setLoading(true);setError('');
  (async()=>{
   const documentPage=await pdf.getPage(page),surface=canvas.current;if(!active||!surface)return;
   const ratio=Math.min(window.devicePixelRatio||1,2),base=documentPage.getViewport({scale:1});
   const width=Math.min(surface.parentElement?.clientWidth||900,1100)-32;
   const viewport=documentPage.getViewport({scale:Math.max(.2,width/base.width)*ratio});
   surface.width=Math.ceil(viewport.width);surface.height=Math.ceil(viewport.height);surface.style.width=viewport.width/ratio+'px';surface.style.height=viewport.height/ratio+'px';
   render=documentPage.render({canvas:surface,viewport});await render.promise;if(active)setLoading(false);
  })().catch(()=>{if(active){setNativePdf(fallbackUrl.current);setLoading(false)}});
  return()=>{active=false;render?.cancel()};
 },[pdf,page,nativePdf]);
 function download(){if(!file)return;const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
 return <dialog ref={dialog} className={'document-preview'+(children?' with-editor':'')} aria-labelledby="document-preview-title" onCancel={e=>{e.preventDefault();onClose()}}>
  <div className="preview-toolbar"><div><h2 id="document-preview-title">{title}</h2><small>Podgląd dokumentu</small></div><div className="actions"><button type="button" className="secondary" onClick={download} disabled={!file}>Pobierz fakturę / dokument</button><button type="button" onClick={onClose} autoFocus>Zamknij ×</button></div></div>
  {assignment!==undefined&&<div className="preview-assignment" role="status">{assignment?<><strong>{assignment.confirmed?'Przypisano do klienta':'Wybrano do przypisania — jeszcze niezapisane'}</strong><dl><div><dt>Klient</dt><dd>{assignment.client}</dd></div><div><dt>Inwestycja</dt><dd>{assignment.investment}</dd></div></dl></>:<strong>Faktura nie została jeszcze przypisana do klienta.</strong>}</div>}
  <div className="preview-workspace"><div className="preview-document">{pdf&&!nativePdf&&<nav className="preview-pagination" aria-label="Strony dokumentu"><button type="button" className="secondary" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Poprzednia</button><span>Strona {page} z {pdf.numPages}</span><button type="button" className="secondary" disabled={page>=pdf.numPages||loading} onClick={()=>setPage(p=>p+1)}>Następna</button></nav>}
  <div className="preview-content" aria-busy={loading}>{loading&&<p role="status">Wczytywanie podglądu…</p>}{error&&<p role="status" className="notice">{error}</p>}{nativePdf&&<div style={{width:'100%'}}><a href={nativePdf} target="_blank" rel="noopener noreferrer">Otwórz PDF w nowej karcie</a><iframe title={`Podgląd PDF: ${title}`} src={nativePdf} style={{display:'block',width:'100%',height:'min(66dvh, 900px)',border:0}}/></div>}{pdf&&!nativePdf&&<canvas ref={canvas} aria-label={`Strona ${page} dokumentu ${title}`}/>}{image&&<img src={image} alt={title} onError={()=>setError('Nie udało się wyświetlić zdjęcia. Możesz pobrać plik.')}/>}</div>
 </div>{children&&<section className="preview-editor" aria-label="Przypisanie i dane faktury">{children}</section>}</div>
 </dialog>;
}
