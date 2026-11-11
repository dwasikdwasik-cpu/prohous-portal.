import {parseInvoiceText} from './invoice-parser.mjs';
// All pages are read locally; OCR is retried when text fields or totals cannot be verified.
export async function readInvoice(file:Blob,onProgress:(text:string)=>void=()=>{},category='faktury',onText?:(text:string)=>void){
 let worker:Awaited<ReturnType<typeof import('tesseract.js').createWorker>>|undefined;
 async function ocr(image:Blob|HTMLCanvasElement){
  if(!worker){onProgress('Uruchamianie dokładnego odczytu…');const {createWorker}=await import('tesseract.js');worker=await createWorker('pol',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core/',langPath:'/ocr/lang/',workerBlobURL:false,logger:event=>{if(event.status==='recognizing text')onProgress(`Dokładny odczyt: ${Math.round(event.progress*100)}%`)}})}
  const {data}=await worker.recognize(image);return {text:data.text,confidence:data.confidence};
 }
 try{
  let text='',confidence=100,pagesRead=1,usedOcr=false;
  if(file.type==='application/pdf'){
   const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/ocr/pdf.worker.min.mjs';
   const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),standardFontDataUrl:'/ocr/standard_fonts/',cMapUrl:'/ocr/cmaps/',cMapPacked:true});
   try{
    const pdf=await task.promise;pagesRead=pdf.numPages;const texts:string[]=[],ocrPages=new Set<number>();
    async function scanPage(n:number){
     const page=await pdf.getPage(n),viewport=page.getViewport({scale:Math.min(2,2200/page.getViewport({scale:1}).width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     try{await page.render({canvas,viewport}).promise;const r=await ocr(canvas);confidence=Math.min(confidence,r.confidence);usedOcr=true;ocrPages.add(n);return r.text}finally{canvas.width=0;canvas.height=0;page.cleanup()}
    }
    for(let n=1;n<=pdf.numPages;n++){
     onProgress(`Czytanie całej faktury: strona ${n}/${pdf.numPages}…`);const page=await pdf.getPage(n),content=await page.getTextContent();
     let pageText=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('');
     if(pageText.replace(/\s/g,'').length<40)pageText+='\n'+await scanPage(n);
     texts.push(pageText);page.cleanup();
    }
    text=texts.join('\n');
    if(!parseInvoiceText(text,{category}).auto_book&&ocrPages.size<pdf.numPages){
     const secondPass:string[]=[];
     for(let n=1;n<=pdf.numPages;n++)if(!ocrPages.has(n)){onProgress(`Ponowne sprawdzanie skanu: strona ${n}/${pdf.numPages}…`);secondPass.push(await scanPage(n))}
     // Preserve both reads so conflicting numbers or amounts block automatic booking.
     text+='\n'+secondPass.join('\n');
    }
   }finally{await task.destroy()}
  }else if(file.type.startsWith('image/')){const r=await ocr(file);text=r.text;confidence=r.confidence;usedOcr=true}
  else throw Error('Odczyt obsługuje PDF i zdjęcia. Uzupełnij dane dokumentu ręcznie.');
  onText?.(text);
  const result=parseInvoiceText(text,{category});
  if(usedOcr&&confidence<90){result.auto_book=false;result.accounting_note='Dokładność OCR wymaga sprawdzenia. '+result.accounting_note}
  result.accounting_note=`Sprawdzono wszystkie strony: ${pagesRead}. ${result.accounting_note}`;
  return result;
 }finally{if(worker)await worker.terminate()}
}
