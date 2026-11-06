import {parseInvoiceText} from './invoice-parser.mjs';
// PDF and OCR execute locally in the administrator's browser. No document is sent to an OCR provider.
export async function readInvoice(file:Blob,onProgress:(text:string)=>void=()=>{}){
 let worker:Awaited<ReturnType<typeof import('tesseract.js').createWorker>>|undefined;
 async function ocr(image:Blob|HTMLCanvasElement){
  if(!worker){onProgress('Uruchamianie odczytu zdjęć…');const {createWorker}=await import('tesseract.js');worker=await createWorker('pol',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core/',langPath:'/ocr/lang/',workerBlobURL:false,logger:event=>{if(event.status==='recognizing text')onProgress(`Odczyt dokumentu: ${Math.round(event.progress*100)}%`)}})}
  const {data}=await worker.recognize(image);return {text:data.text,confidence:data.confidence};
 }
 try{
  let text='',confidence=100;
  if(file.type==='application/pdf'){
   const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/ocr/pdf.worker.min.mjs';
   const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),standardFontDataUrl:'/ocr/standard_fonts/',cMapUrl:'/ocr/cmaps/',cMapPacked:true});
   const pdf=await task.promise;
   try{
    if(pdf.numPages>12)throw Error('PDF ma ponad 12 stron. Uzupełnij dane ręcznie.');
    for(let n=1;n<=pdf.numPages;n++){
     onProgress(`Odczyt strony ${n}/${pdf.numPages}…`);const page=await pdf.getPage(n),content=await page.getTextContent();
     let pageText=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('');
     if(pageText.replace(/\s/g,'').length<40){
      const viewport=page.getViewport({scale:Math.min(2,2200/page.getViewport({scale:1}).width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try{await page.render({canvas,viewport}).promise;const r=await ocr(canvas);pageText=r.text;confidence=Math.min(confidence,r.confidence)}finally{canvas.width=0;canvas.height=0}
     }
     text+=pageText+'\n';page.cleanup();
    }
   }finally{await task.destroy()}
  }else if(file.type.startsWith('image/')){const r=await ocr(file);text=r.text;confidence=r.confidence}
  else throw Error('Automatyczny odczyt obsługuje PDF i zdjęcia. Uzupełnij dane dokumentu ręcznie.');
  const result=parseInvoiceText(text);
  if(confidence<90){result.auto_book=false;result.accounting_note='Odczyt zdjęcia wymaga sprawdzenia. '+result.accounting_note}
  return result;
 }finally{if(worker)await worker.terminate()}
}
