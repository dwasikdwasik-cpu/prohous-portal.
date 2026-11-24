'use client';
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type {PDFDocumentProxy,PDFDocumentLoadingTask,RenderTask} from 'pdfjs-dist';
import {previewType} from '../lib/document-preview.mjs';

export type InvoiceAssignment={client:string,investment:string,confirmed:boolean};
type PreviewSource = {file: Blob, url: string, mime: string};

function PdfPages({file, title}: {file: Blob, title: string}) {
 const canvas = useRef<HTMLCanvasElement>(null);
 const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
 const [page, setPage] = useState(1);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');

 useEffect(() => {
  let active = true;
  let task: PDFDocumentLoadingTask | undefined;
  async function load() {
   const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
   const bytes = new Uint8Array(await file.arrayBuffer());
   if (!active) return;
   pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf.preview.worker.min.mjs';
   task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: '/ocr/standard_fonts/',
    cMapUrl: '/ocr/cmaps/',
    cMapPacked: true,
    wasmUrl: '/ocr/wasm/',
    stopAtErrors: true,
   });
   const doc = await task.promise;
   if (active) setPdf(doc);
  }
  void load().catch(() => {
   if (active) {
    setError('Nie udało się odczytać PDF. Otwórz oryginał w nowej karcie lub pobierz dokument.');
    setLoading(false);
   }
  });
  return () => {
   active = false;
   if (task) void task.destroy().catch(() => {});
  };
 }, [file]);

 useEffect(() => {
  if (!pdf) return;
  let active = true;
  let render: RenderTask | undefined;
  setLoading(true);
  setError('');
  async function draw(doc: PDFDocumentProxy) {
   const documentPage = await doc.getPage(page);
   const surface = canvas.current;
   if (!active || !surface) return;
   const ratio = Math.min(window.devicePixelRatio || 1, 2);
   const width = Math.min(surface.parentElement?.clientWidth || 900, 1100) - 32;
   const base = documentPage.getViewport({scale: 1});
   const viewport = documentPage.getViewport({scale: Math.max(0.2, width / base.width) * ratio});
   surface.width = Math.ceil(viewport.width);
   surface.height = Math.ceil(viewport.height);
   surface.style.width = viewport.width / ratio + 'px';
   surface.style.height = viewport.height / ratio + 'px';
   render = documentPage.render({canvas: surface, viewport});
   await render.promise;
  }
  void draw(pdf).catch(() => {
   if (active) setError('Nie udało się wyświetlić strony. Otwórz oryginał w nowej karcie lub pobierz dokument.');
  }).finally(() => {
   if (active) setLoading(false);
  });
  return () => { active = false; render?.cancel(); };
 }, [pdf, page]);

 return <>
  {pdf && <nav className="preview-pagination" aria-label="Strony dokumentu">
   <button type="button" className="secondary" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>Poprzednia</button>
   <span>Strona {page} z {pdf.numPages}</span>
   <button type="button" className="secondary" disabled={page >= pdf.numPages || loading} onClick={() => setPage(p => p + 1)}>Następna</button>
  </nav>}
  <div className="preview-content" aria-busy={loading}>
   {loading && <p role="status">Wczytywanie podglądu…</p>}
   {error && <p role="status" className="notice">{error}</p>}
   {pdf && <canvas hidden={Boolean(error)} ref={canvas} aria-label={`Strona ${page} dokumentu ${title}`}/>}
  </div>
 </>;
}

function PdfPreview({source, title}: {source: PreviewSource, title: string}) {
 const nativeAvailable = navigator.pdfViewerEnabled === true;
 const [native, setNative] = useState(nativeAvailable);

 return <>
  <div className="preview-pagination">
   <a href={source.url} target="_blank" rel="noopener noreferrer">Otwórz oryginalny PDF w nowej karcie</a>
   {nativeAvailable && <button type="button" className="secondary" onClick={() => setNative(value => !value)}>
    {native ? 'Użyj czytnika portalu' : 'Użyj czytnika przeglądarki'}
   </button>}
  </div>
  {native ? <iframe title={`Podgląd PDF: ${title}`} src={source.url}
   style={{display:'block',width:'100%',height:'min(66dvh, 900px)',border:0}}/>
   : <PdfPages file={source.file} title={title}/>}
 </>;
}

export default function DocumentPreview({file,title,filename,assignment,fileError,children,onClose}:{file:Blob|null,title:string,filename:string,assignment?:InvoiceAssignment|null,fileError?:string,children?:ReactNode,onClose:()=>void}){
 const dialog = useRef<HTMLDialogElement>(null);
 const [source, setSource] = useState<PreviewSource | null>(null);
 const [failure, setFailure] = useState<{file: Blob, message: string} | null>(null);
 const current = source?.file === file ? source : null;
 const error = fileError || (failure?.file === file ? failure?.message : '');
 useEffect(() => { dialog.current?.showModal(); }, []);
 useEffect(() => {
  let active = true;
  let url = '';
  setSource(null);
  setFailure(null);
  if (!file) return;
  const input = file;
  async function prepare() {
   const mime = await previewType(input);
   if (!active) return;
   if (!mime) {
    setFailure({file: input, message: 'Ten format nie obsługuje podglądu. Możesz pobrać dokument.'});
    return;
   }
   const blob = input.type === mime ? input : new Blob([input], {type: mime});
   url = URL.createObjectURL(blob);
   setSource({file: input, url, mime});
  }
  void prepare().catch(() => {
   if (active) setFailure({file: input, message: 'Nie udało się otworzyć pliku. Możesz pobrać dokument.'});
  });
  return () => { active = false; if (url) URL.revokeObjectURL(url); };
 }, [file]);
 function download(){if(!file)return;const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
 return <dialog ref={dialog} className={'document-preview'+(children?' with-editor':'')} aria-labelledby="document-preview-title" onCancel={e=>{e.preventDefault();onClose()}}>
  <div className="preview-toolbar"><div><h2 id="document-preview-title">{title}</h2><small>Podgląd dokumentu</small></div><div className="actions"><button type="button" className="secondary" onClick={download} disabled={!file}>Pobierz fakturę / dokument</button><button type="button" onClick={onClose} autoFocus>Zamknij ×</button></div></div>
  {assignment!==undefined&&<div className="preview-assignment" role="status">{assignment?<><strong>{assignment.confirmed?'Przypisano do klienta':'Wybrano do przypisania — jeszcze niezapisane'}</strong><dl><div><dt>Klient</dt><dd>{assignment.client}</dd></div><div><dt>Inwestycja</dt><dd>{assignment.investment}</dd></div></dl></>:<strong>Faktura nie została jeszcze przypisana do klienta.</strong>}</div>}
  <div className="preview-workspace"><div className="preview-document">
  {error ? <p role="status" className="notice">{error}</p>
   : !current ? <p role="status">Wczytywanie podglądu…</p>
   : current.mime === 'application/pdf' ? <PdfPreview key={current.url} source={current} title={title}/>
   : <div className="preview-content"><img src={current.url} alt={title}
     onError={() => setFailure({file: current.file, message: 'Nie udało się wyświetlić zdjęcia. Możesz pobrać plik.'})}/></div>}
 </div>{children&&<section className="preview-editor" aria-label="Przypisanie i dane faktury">{children}</section>}</div>
 </dialog>;
}
