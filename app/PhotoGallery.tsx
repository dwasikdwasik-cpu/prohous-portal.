'use client';
import {useEffect,useRef,useState} from 'react';
import type {TouchEvent} from 'react';
import {previewType} from '../lib/document-preview.mjs';

type Photo={id:string;title:string};
type Loaded={id:string;url:string;file:Blob;filename:string};
export default function PhotoGallery({photos,selectedId,onSelect,onClose,api}:{photos:Photo[];selectedId:string;onSelect:(id:string)=>void;onClose:()=>void;api:(path:string)=>Promise<Response>}){
 const dialog=useRef<HTMLDialogElement>(null),loader=useRef(api),touch=useRef<{x:number;y:number}|null>(null);
 const [loaded,setLoaded]=useState<Loaded|null>(null),[error,setError]=useState<{id:string;message:string}|null>(null),[retry,setRetry]=useState(0);
 const index=photos.findIndex(photo=>photo.id===selectedId),photo=photos[index],current=loaded?.id===selectedId?loaded:null,currentError=error?.id===selectedId?error.message:'';
 useEffect(()=>{loader.current=api},[api]);
 useEffect(()=>{dialog.current?.showModal()},[]);
 useEffect(()=>{
  let active=true,url='';setLoaded(null);setError(null);
  if(!photo)return;
  const id=photo.id,title=photo.title;
  async function load(){
   try{
    const response=await loader.current('/api/document/'+id);
    if(!response.ok)throw Error();
    const bytes=await response.blob(),mime=await previewType(bytes);
    if(!mime?.startsWith('image/'))throw Error();
    if(!active)return;
    const file=new Blob([bytes],{type:mime});url=URL.createObjectURL(file);
    const encoded=response.headers.get('x-download-name');let filename=title;
    if(encoded)try{filename=decodeURIComponent(encoded)}catch{}
    setLoaded({id,url,file,filename});
   }catch{if(active)setError({id,message:'Nie udało się wczytać zdjęcia. Możesz spróbować ponownie lub przejść do kolejnego.'})}
  }
  void load();return()=>{active=false;if(url)URL.revokeObjectURL(url)};
 },[photo?.id,retry]);
 function move(direction:-1|1){const next=photos[index+direction];if(index>=0&&next){touch.current=null;onSelect(next.id)}}
 function startTouch(e:TouchEvent){touch.current=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null}
 function endTouch(e:TouchEvent){const start=touch.current;touch.current=null;if(!start||e.touches.length||e.changedTouches.length!==1)return;const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y;if(Math.abs(dx)>=60&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1)}
 function download(){if(!current||!photo)return;const url=URL.createObjectURL(current.file),link=document.createElement('a');link.href=url;link.download=current.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
 return <dialog ref={dialog} className="document-preview photo-gallery" aria-labelledby="photo-gallery-title" onCancel={e=>{e.preventDefault();onClose()}} onKeyDown={e=>{if(e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}if(e.key==='ArrowRight'){e.preventDefault();move(1)}}}>
  <div className="preview-toolbar"><div><h2 id="photo-gallery-title">{photo?.title||'Galeria zdjęć'}</h2><small>Zdjęcia wybranej inwestycji</small></div><div className="actions"><button type="button" className="secondary" disabled={!current||!!currentError} onClick={download}>Pobierz zdjęcie</button><button type="button" onClick={onClose} autoFocus>Zamknij ×</button></div></div>
  <div className="gallery-controls" role="group" aria-label="Przewijanie zdjęć"><button type="button" className="secondary" disabled={index<=0} onClick={()=>move(-1)}>← Poprzednie</button><span role="status">{index>=0?`Zdjęcie ${index+1} z ${photos.length}`:'Zdjęcie niedostępne'}</span><button type="button" className="secondary" disabled={index<0||index>=photos.length-1} onClick={()=>move(1)}>Następne →</button></div>
  <div className="gallery-stage" aria-busy={!!photo&&!current&&!currentError} onTouchStart={startTouch} onTouchMove={e=>{if(e.touches.length!==1)touch.current=null}} onTouchEnd={endTouch} onTouchCancel={()=>{touch.current=null}}>
   {!photo?<p role="status">To zdjęcie nie jest już dostępne w albumie.</p>:currentError?<div><p role="alert" className="notice">{currentError}</p><button className="secondary" type="button" onClick={()=>setRetry(value=>value+1)}>Spróbuj ponownie</button></div>:current?<img src={current.url} alt={photo.title} draggable={false} onError={()=>setError({id:selectedId,message:'Nie udało się wyświetlić zdjęcia. Możesz spróbować ponownie lub przejść do kolejnego.'})}/>:<p role="status">Wczytywanie zdjęcia…</p>}
  </div><p className="gallery-hint muted">Przewijaj strzałkami ← → lub przesuwaj zdjęcie palcem w lewo i w prawo.</p>
 </dialog>;
}
