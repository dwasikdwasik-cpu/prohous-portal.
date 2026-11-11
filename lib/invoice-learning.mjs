import {parseInvoiceText} from './invoice-parser.mjs';
export const LEARNING_FIELDS=['invoice_number','invoice_date','gross_amount','supplier','currency'];
export const MAX_LEARNING_TEXT=60000;
const norm=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().replace(/\s+/g,' ').trim();
const linesOf=text=>String(text||'').split(/[\r\n]+/).map(line=>line.trim()).filter(Boolean);
export function readingValues(values={}){return Object.fromEntries(LEARNING_FIELDS.map(field=>[field,values[field]??null]));}
export function supplierKey(text){
 const supplier=parseInvoiceText(text).supplier;
 return /^NIP \d{10}$/.test(supplier||'')?supplier.slice(4):null;
}
function comparable(field,value){return field==='gross_amount'&&value!=null?Number(value).toFixed(2):norm(value);}
function dateValue(raw){
 const m=raw.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$|^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})$/);
 if(!m)return null;
 const value=m[1]?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:`${m[6]}-${m[5].padStart(2,'0')}-${m[4].padStart(2,'0')}`;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?value:null;
}
function candidates(line,field){
 const pattern=field==='invoice_date'?/\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})\b/g:
 field==='gross_amount'?/(?<![\d.,−–-])(?:\d{1,3}(?:[ .\u00a0]\d{3})+|\d+)[,.]\d{2}(?![\d.,])/g:/[\p{L}\d][\p{L}\d/_.-]{1,79}/gu;
 return [...line.matchAll(pattern)].flatMap(match=>{
  const raw=match[0];if(field==='invoice_number'&&!/\d/.test(raw))return [];
  const value=field==='invoice_date'?dateValue(raw):field==='gross_amount'?Number(raw.replace(/[ \u00a0]/g,'').replace(/\.(?=\d{3}(?:[.,]|$))/g,'').replace(',','.')):raw;
  if(value==null||field==='gross_amount'&&(!(value>0)||value>=1e12))return [];
  return [{value,index:match.index,end:match.index+raw.length}];
 });
}
function label(text){
 const value=norm(text).replace(/\s*[:#=]+\s*$/,'').trim();
 return value.length>=3&&value.length<=80&&!/\d/.test(value)&&/^[\p{L} .()/-]+$/u.test(value)?value:null;
}
function anchoredValues(text,field){
 const lines=linesOf(text),result=[];
 for(let i=0;i<lines.length;i++){
  const found=candidates(lines[i],field);if(found.length!==1)continue;
  const candidate=found[0],prefix=lines[i].slice(0,candidate.index),suffix=lines[i].slice(candidate.end);
  if(!/^\s*(?:PLN|zł)?\s*$/i.test(suffix))continue;
  const sameLine=label(prefix),previousLine=!prefix.trim()&&i>0?label(lines[i-1]):null;
  if(sameLine||previousLine)result.push({field,label:sameLine||previousLine,offset:sameLine?0:1,value:candidate.value});
 }
 return result;
}
/** Learn field locations, never old invoice numbers, dates or amounts. */
export function learnedSuggestions(text,parsed,examples=[]){
 const key=supplierKey(text),result={...parsed},used=[];
 if(!key)return result;
 for(const field of ['invoice_number','invoice_date','gross_amount']){
  const votes=new Map();
  for(const example of examples){
   if(!example.confirmed_at||example.supplier_key!==key||!example.corrected_values)continue;
   const corrected=example.corrected_values[field];
   if(corrected==null||comparable(field,corrected)===comparable(field,example.original_values?.[field]))continue;
   const anchors=anchoredValues(example.original_text,field).filter(anchor=>comparable(field,anchor.value)===comparable(field,corrected));
   if(anchors.length!==1)continue;
   const anchor=anchors[0],id=JSON.stringify([anchor.label,anchor.offset]);
   if(!votes.has(id))votes.set(id,new Set());
   votes.get(id).add(example.content_sha256); // Re-reading one document is never independent evidence.
  }
  const current=anchoredValues(text,field);
  const values=current.filter(anchor=>votes.get(JSON.stringify([anchor.label,anchor.offset]))?.size>=2).map(anchor=>anchor.value);
  const unique=[...new Map(values.map(value=>[comparable(field,value),value])).values()];
  if(unique.length===1&&comparable(field,unique[0])!==comparable(field,parsed[field])){result[field]=unique[0];used.push(field);}
 }
 if(used.length){result.auto_book=false;result.accounting_note='Podpowiedź na podstawie zatwierdzonych poprawek ('+used.map(field=>({invoice_number:'numer',invoice_date:'data',gross_amount:'kwota'})[field]).join(', ')+'). Sprawdź i potwierdź dane. '+(parsed.accounting_note||'');}
 return result;
}
