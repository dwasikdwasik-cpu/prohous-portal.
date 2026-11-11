import {parseInvoiceText} from './invoice-parser.mjs';
import {pdfInvoiceText,reconcileInvoiceReadings,tsvInvoiceText} from './invoice-readings.mjs';
import {previewType} from './document-preview.mjs';
type Reading={text:string,source:'pdf'|'ocr',confidence:number};
async function timed<T>(promise:Promise<T>,milliseconds:number,message:string){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),milliseconds)})])}finally{if(timer)clearTimeout(timer)}}
function canvas(width:number,height:number){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(width));c.height=Math.max(1,Math.round(height));return c;}
function improveScan(source:HTMLCanvasElement){
 const output=canvas(source.width,source.height),context=output.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Przeglądarka nie obsługuje odczytu obrazu.');
 context.fillStyle='#fff';context.fillRect(0,0,output.width,output.height);context.drawImage(source,0,0);
 const image=context.getImageData(0,0,output.width,output.height),hist=new Uint32Array(256),pixels=image.data;
 for(let i=0;i<pixels.length;i+=4){const g=Math.round(0.299*pixels[i]+0.587*pixels[i+1]+0.114*pixels[i+2]);hist[g]++}
 const total=output.width*output.height;let count=0,low=0,high=255;
 for(let i=0;i<256;i++){count+=hist[i];if(count>=total*0.01){low=i;break}}
 count=0;for(let i=255;i>=0;i--){count+=hist[i];if(count>=total*0.01){high=i;break}}
 if(high-low<50){low=0;high=255}
 for(let i=0;i<pixels.length;i+=4){const g=Math.max(0,Math.min(255,Math.round((0.299*pixels[i]+0.587*pixels[i+1]+0.114*pixels[i+2]-low)*255/(high-low))));pixels[i]=pixels[i+1]=pixels[i+2]=g;pixels[i+3]=255}
 context.putImageData(image,0,0);return output;
}
// Digital PDFs retain their reliable text. Raster pages get high-resolution, deskewed multi-pass OCR.
export async function readInvoice(file:Blob,onProgress:(text:string)=>void=()=>{},category='faktury',onText?:(text:string)=>void){
 let worker:Awaited<ReturnType<typeof import('tesseract.js').createWorker>>|undefined;
 const readings:Reading[]=[],warnings:string[]=[];let pagesRead=1,ocrPages=0;
 async function ocr(image:HTMLCanvasElement,mode:'3'|'11'|'6'){
  if(!worker){onProgress('Uruchamianie odczytu polskich faktur…');const {createWorker}=await import('tesseract.js');
   const loading=createWorker('pol',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core/',langPath:'/ocr/lang/',workerBlobURL:false,errorHandler:()=>{},logger:event=>{if(event.status==='recognizing text')onProgress(`Odczyt obrazu: ${Math.round(event.progress*100)}%`);}});
   try{worker=await timed(loading,60000,'Nie udało się uruchomić OCR w ciągu minuty. Odśwież stronę i ponów odczyt.')}catch(error){void loading.then(w=>w.terminate()).catch(()=>{});throw error}
  }
  await worker.setParameters({tessedit_pageseg_mode:mode as import('tesseract.js').PSM,preserve_interword_spaces:'1',user_defined_dpi:'300'});
  const {data}=await timed(worker.recognize(image,{rotateAuto:true},{text:true,tsv:true}),90000,'Przekroczono czas odczytu strony. Sprawdź skan i ponów odczyt.');
  return {text:data.text,layoutText:tsvInvoiceText(data.tsv||''),confidence:data.confidence};
 }
 async function scan(source:HTMLCanvasElement,page:number){
  onProgress(`Odczyt dokładny, strona ${page}/${pagesRead}: analiza układu i prostowanie…`);ocrPages++;
  const first=await ocr(source,'3');let second=first;
  if(!parseInvoiceText(first.text,{category}).auto_book||first.confidence<90){
   onProgress(`Ponowne sprawdzanie, strona ${page}/${pagesRead}: kontrast i drobne napisy…`);const enhanced=improveScan(source);
   try{second=await ocr(enhanced,/paragon\s+fiskalny|faktury\s+uproszczonej/i.test(first.text)?'6':'11')}catch(error){warnings.push(error instanceof Error?error.message:'Nie udało się wykonać ponownej kontroli OCR.');if(worker){await worker.terminate();worker=undefined}}finally{enhanced.width=0;enhanced.height=0}
  }
  return {first,second};
 }
 try{
  const type=await previewType(file);
  if(type==='application/pdf'){
   const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/ocr/pdf.worker.min.mjs';
   const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),standardFontDataUrl:'/ocr/standard_fonts/',cMapUrl:'/ocr/cmaps/',cMapPacked:true});
   try{
    const pdf=await timed(task.promise,45000,'Nie udało się otworzyć pliku PDF. Sprawdź, czy nie jest zabezpieczony hasłem.');pagesRead=pdf.numPages;
    const logical:string[]=[],visual:string[]=[],first:string[]=[],second:string[]=[],firstLayout:string[]=[],secondLayout:string[]=[];let confidence1=100,confidence2=100;
    for(let n=1;n<=pdf.numPages;n++){
     onProgress(`Sprawdzanie wszystkich stron: ${n}/${pdf.numPages}…`);const page=await pdf.getPage(n),content=await page.getTextContent(),text=pdfInvoiceText(content.items);
     logical.push(text.logical);visual.push(text.visual);first.push(text.logical);second.push(text.logical);firstLayout.push(text.logical);secondLayout.push(text.logical);page.cleanup();
    }
    const digital=logical.join('\n');if(digital.trim())readings.push({text:digital,source:'pdf',confidence:100});
    const geometric=visual.join('\n');if(geometric.trim()&&geometric!==digital)readings.push({text:geometric,source:'pdf',confidence:100});
    const reliableDigital=readings.some(r=>parseInvoiceText(r.text,{category}).auto_book);
    if(logical.some(text=>text.replace(/\s/g,'').length<40)||!reliableDigital){
     for(let n=1;n<=pdf.numPages;n++){
      const text=logical[n-1];
      if(reliableDigital&&text.replace(/\s/g,'').length>=40)continue;
      // Do not OCR a text-only QR/verification page: it contains no invoice fields.
      if(text.replace(/\s/g,'').length>40&&!/numer faktury|data wystawienia|kwota należności|kwota brutto|do zapłaty|netto|podsumowanie/i.test(text))continue;
      const page=await pdf.getPage(n),base=page.getViewport({scale:1});let scale=Math.min(4,2480/base.width);scale=Math.min(scale,Math.sqrt(8000000/(base.width*base.height)));
      const viewport=page.getViewport({scale}),image=canvas(viewport.width,viewport.height),context=image.getContext('2d');if(!context)throw Error('Brak obsługi skanów w przeglądarce.');
      try{await page.render({canvas:image,viewport,background:'#ffffff'}).promise;const r=await scan(image,n);if(text.replace(/\s/g,'').length<40&&Math.max(r.first.confidence,r.second.confidence)<60)warnings.push(`Strona ${n} jest pusta lub nieczytelna — sprawdź ją ręcznie.`);first[n-1]=r.first.text;second[n-1]=r.second.text;firstLayout[n-1]=r.first.layoutText;secondLayout[n-1]=r.second.layoutText;confidence1=Math.min(confidence1,r.first.confidence);confidence2=Math.min(confidence2,r.second.confidence)}
      catch(error){warnings.push(error instanceof Error?error.message:'Nie udało się odczytać obrazu strony.');if(worker){await worker.terminate();worker=undefined}}
      finally{image.width=0;image.height=0;page.cleanup()}
     }
     if(ocrPages){readings.push({text:first.join('\n'),source:'ocr',confidence:confidence1});readings.push({text:second.join('\n'),source:'ocr',confidence:confidence2});readings.push({text:firstLayout.join('\n'),source:'ocr',confidence:confidence1},{text:secondLayout.join('\n'),source:'ocr',confidence:confidence2})}
    }
   }finally{await task.destroy()}
  }else if(type?.startsWith('image/')){
   const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});const scale=Math.min(3,Math.max(1,2480/bitmap.width),Math.sqrt(8000000/(bitmap.width*bitmap.height))),image=canvas(bitmap.width*scale,bitmap.height*scale),context=image.getContext('2d');
   if(!context){bitmap.close();throw Error('Brak obsługi skanów w przeglądarce.')}
   try{context.fillStyle='#fff';context.fillRect(0,0,image.width,image.height);context.drawImage(bitmap,0,0,image.width,image.height);bitmap.close();const r=await scan(image,1);readings.push({...r.first,source:'ocr'},{...r.second,source:'ocr'},{text:r.first.layoutText,confidence:r.first.confidence,source:'ocr'},{text:r.second.layoutText,confidence:r.second.confidence,source:'ocr'})}finally{bitmap.close();image.width=0;image.height=0}
  }else throw Error('Plik nie jest poprawnym PDF ani zdjęciem. Sprawdź format i uzupełnij dane ręcznie.');
  const result=reconcileInvoiceReadings(readings,category);
  if(warnings.length){result.auto_book=false;result.accounting_note+=' '+[...new Set(warnings)].join(' ')}
  onText?.(readings.find(r=>r.source==='pdf')?.text||readings[0]?.text||'');
  result.accounting_note=`Sprawdzono wszystkie strony: ${pagesRead}. ${ocrPages?'Odczyt obrazu z kontrolą kontrastu i układu. ':'Odczyt oryginalnej warstwy tekstowej PDF. '}${result.accounting_note}`;
  onProgress('Sprawdzono numer faktury, datę wystawienia, walutę i zgodność kwot.');return result;
 }finally{if(worker)await worker.terminate()}
}
