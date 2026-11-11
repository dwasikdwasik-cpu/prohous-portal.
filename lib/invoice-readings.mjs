import {parseInvoiceText} from './invoice-parser.mjs';
/** Preserve PDF's logical reading order, plus a geometric alternative for fragmented text layers. */
export function pdfInvoiceText(items){
 const textItems=items.filter(item=>typeof item.str==='string');
 const logical=textItems.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
 const rows=[];
 for(const item of textItems.filter(item=>item.str.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])){
  const y=item.transform[5],tolerance=Math.max(1.5,Math.min(8,Number(item.height||8)*0.35));
  let row=rows.find(row=>Math.abs(row.y-y)<=tolerance);if(!row){row={y,items:[]};rows.push(row)}row.items.push(item);
 }
 const visual=rows.sort((a,b)=>b.y-a.y).map(row=>row.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(item=>item.str).join('   ')).join('\n');
 return {logical,visual};
}
const fields=['invoice_number','invoice_date','gross_amount','supplier','currency'];
const critical=['invoice_number','invoice_date','gross_amount'];
const present=(value,key)=>value!==null&&value!==undefined&&value!==''&&(key!=='currency'||value!=='UNKNOWN');
export function reconcileInvoiceReadings(readings,category='faktury'){
 const parsed=readings.filter(r=>r.text?.trim()).map(r=>({...r,result:parseInvoiceText(r.text,{category})}));
 if(!parsed.length)return {...parseInvoiceText('',{category}),accounting_note:'Nie odczytano tekstu. Sprawdź jakość skanu i uzupełnij dane ręcznie.'};
 const digital=parsed.filter(r=>r.source==='pdf');
 const score=r=>(r.result.auto_book?100:0)+critical.filter(k=>present(r.result[k],k)).length*15+(r.confidence||0)/10;
 const selected=(digital.find(r=>r.result.auto_book)||parsed.slice().sort((a,b)=>score(b)-score(a))[0]);
 const result={...selected.result};const conflicts=[];
 for(const key of fields){
  const digitalValues=digital.map(r=>r.result[key]).filter(value=>present(value,key));
  const pool=digitalValues.length?digitalValues:parsed.map(r=>r.result[key]).filter(value=>present(value,key));
  const values=[...new Set(pool)];
  if(!present(result[key],key)&&values.length===1)result[key]=values[0];
  if(critical.includes(key)&&values.length>1)conflicts.push(key);
 }
 const lowConfidence=selected.source==='ocr'&&selected.confidence<90;
 const multipleInvoices=parsed.some(r=>/Plik zawiera różne numery faktur/.test(r.result.accounting_note));
 const blockedByDigital=digital.some(r=>/różne numery|różne kwoty|sprzeczne|nie zgadza|różni się|ujemne|wymaga sprawdzenia przed rozliczeniem/.test(r.result.accounting_note));
 result.auto_book=Boolean(selected.result.auto_book&&!lowConfidence&&!conflicts.length&&!blockedByDigital&&!multipleInvoices);
 if(conflicts.length)result.accounting_note='Różne odczyty numeru, daty lub kwoty — sprawdź podgląd. '+result.accounting_note;
 if(multipleInvoices)result.accounting_note='Plik może zawierać więcej niż jedną fakturę. Sprawdź wszystkie strony. '+result.accounting_note;
 if(lowConfidence)result.accounting_note='Dokładność OCR wymaga sprawdzenia. '+result.accounting_note;
 if(blockedByDigital&&!selected.result.accounting_note.includes('Sprawdź'))result.accounting_note='Sprawdź sprzeczności w warstwie tekstowej PDF. '+result.accounting_note;
 return result;
}

/** Rebuild OCR words by their physical line instead of column-first text ordering. */
export function tsvInvoiceText(tsv=''){
 const items=[];
 for(const line of String(tsv).split(/\r?\n/).slice(1)){
  const cells=line.split('\t');if(cells[0]!=='5'||!cells[11]?.trim())continue;
  const [x,y,width,height]=cells.slice(6,10).map(Number);if(![x,y,width,height].every(Number.isFinite))continue;
  items.push({str:cells.slice(11).join('\t').trim(),transform:[1,0,0,1,x,-(y+height)],height});
 }
 return pdfInvoiceText(items).visual;
}
