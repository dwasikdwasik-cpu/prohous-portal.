'use client';
import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy,PDFDocumentLoadingTask,RenderTask} from 'pdfjs-dist';
import {previewType} from '../lib/document-preview.mjs';

export default function DocumentPreview({file,title,filename,onClose}:{file:Blob,title:string,filename:string,onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[image,setImage]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal()},[]);
 useEffect(()=>{
  let active=true,task:PDFDocumentLoadingTask|undefined,imageUrl='';setLoading(true);setError('');setPdf(null);setImage('');setPage(1);
  (async()=>{
   const mime=await previewType(file);
   if(mime==='application/pdf'){
    const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/ocr/pdf.worker.min.mjs';
    if(!active)return;
    task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),standardFontDataUrl:'/ocr/standard_fonts/',cMapUrl:'/ocr/cmaps/',cMapPacked:true});
    const document=await task.promise;if(active)setPdf(document);
   }else if(mime?.startsWith('image/')){
    imageUrl=URL.createObjectURL(new Blob([file],{type:mime}));if(active){setImage(imageUrl);setLoading(false)}
   }else if(active){setError('Ten format nie obsługuje podglądu. Możesz pobrać dokument.');setLoading(false)}
  })().catch(()=>{if(active){setError('Nie udało się wyświetlić podglądu. Możesz pobrać dokument.');setLoading(false)}});
  return()=>{active=false;if(imageUrl)URL.revokeObjectURL(imageUrl);if(task)void task.destroy()};
 },[file]);
 useEffect(()=>{
  if(!pdf||!canvas.current)return;
  let active=true,render:RenderTask|undefined;
  setLoading(true);setError('');
  (async()=>{
   const documentPage=await pdf.getPage(page),surface=canvas.current;if(!active||!surface)return;
   const ratio=Math.min(window.devicePixelRatio||1,2),base=documentPage.getViewport({scale:1});
   const width=Math.min(surface.parentElement?.clientWidth||900,1100)-32;
   const viewport=documentPage.getViewport({scale:Math.max(.2,width/base.width)*ratio});
   surface.width=Math.ceil(viewport.width);surface.height=Math.ceil(viewport.height);surface.style.width=viewport.width/ratio+'px';surface.style.height=viewport.height/ratio+'px';
   render=documentPage.render({canvas:surface,viewport});await render.promise;if(active)setLoading(false);
  })().catch(()=>{if(active){setError('Nie udało się wyświetlić strony. Możesz pobrać dokument.');setLoading(false)}});
  return()=>{active=false;render?.cancel()};
 },[pdf,page]);
 function download(){const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
 return <dialog ref={dialog} className="document-preview" aria-labelledby="document-preview-title" onCancel={e=>{e.preventDefault();onClose()}}>
  <div className="preview-toolbar"><div><h2 id="document-preview-title">{title}</h2><small>Podgląd dokumentu</small></div><div className="actions"><button type="button" className="secondary" onClick={download}>Pobierz fakturę / dokument</button><button type="button" onClick={onClose} autoFocus>Zamknij ×</button></div></div>
  {pdf&&<nav className="preview-pagination" aria-label="Strony dokumentu"><button type="button" className="secondary" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Poprzednia</button><span>Strona {page} z {pdf.numPages}</span><button type="button" className="secondary" disabled={page>=pdf.numPages||loading} onClick={()=>setPage(p=>p+1)}>Następna</button></nav>}
  <div className="preview-content" aria-busy={loading}>{loading&&<p role="status">Wczytywanie podglądu…</p>}{error&&<p role="status" className="notice">{error}</p>}{pdf&&<canvas ref={canvas} aria-label={`Strona ${page} dokumentu ${title}`}/>}{image&&<img src={image} alt={title} onError={()=>setError('Nie udało się wyświetlić zdjęcia. Możesz pobrać plik.')}/>}</div>
 </dialog>;
}
