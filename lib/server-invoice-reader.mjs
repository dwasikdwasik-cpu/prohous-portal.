import {pdfInvoiceText,reconcileInvoiceReadings} from './invoice-readings.mjs';
/** Read digital PDFs without relying on browser PDF workers. Images still use local OCR. */
export async function readDigitalInvoice(bytes){
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
 let timer;
 try{
  const pdf=await Promise.race([task.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Przekroczono czas otwierania PDF.')),20000)})]);
  clearTimeout(timer);
  if(pdf.numPages>150)throw Error('PDF zawiera ponad 150 stron. Rozdziel go na pojedyncze faktury.');
  const logical=[],visual=[];let hasRasterPages=false;
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),text=pdfInvoiceText((await page.getTextContent()).items);
   logical.push(text.logical);visual.push(text.visual);if(text.logical.replace(/\s/g,'').length<40)hasRasterPages=true;page.cleanup();
  }
  const readings=[{text:logical.join('\n'),source:'pdf',confidence:100},{text:visual.join('\n'),source:'pdf',confidence:100}];
  const parsed=reconcileInvoiceReadings(readings);
  // Do not silently ignore scanned continuation pages after a good text page.
  if(hasRasterPages)parsed.auto_book=false;
  parsed.accounting_note=`Odczyt serwerowy PDF. Sprawdzono stron: ${pdf.numPages}. `+parsed.accounting_note;
  return {parsed,text:readings[0].text,needs_ocr:hasRasterPages||!parsed.auto_book};
 }finally{clearTimeout(timer);await task.destroy()}
}
