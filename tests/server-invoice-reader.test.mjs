import test from 'node:test';import assert from 'node:assert/strict';
import {readDigitalInvoice} from '../lib/server-invoice-reader.mjs';
function pdf(pages){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',''];
 const kids=[];
 for(const lines of pages){const page=objects.length+1,stream=page+1;
  kids.push(page+' 0 R');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${stream} 0 R >>`);
  const commands='BT /F1 12 Tf 40 760 Td '+lines.map((s,i)=>(i?'0 -20 Td ':'')+'('+s.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+' ET';
  objects.push(`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`);
 }
 objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
 let result='%PDF-1.4\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${obj}\nendobj\n`});
 const xref=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF`;
 return new Uint8Array(Buffer.from(result));
}
const lines=['Faktura VAT nr TEST/2026/1','Data wystawienia: 2026-11-11','Kwota brutto: 123,00 PLN','Razem netto: 100,00','Kwota VAT: 23,00'];
test('server extracts invoice fields without browser workers and checks all PDF pages',async()=>{
 const r=await readDigitalInvoice(pdf([lines]));assert.equal(r.parsed.invoice_number,'TEST/2026/1');assert.equal(r.parsed.invoice_date,'2026-11-11');assert.equal(r.parsed.gross_amount,123);assert.equal(r.parsed.currency,'PLN');assert.equal(r.parsed.auto_book,true);assert.equal(r.needs_ocr,false);
});
test('a raster/empty continuation cannot be ignored after a readable PDF page',async()=>{const r=await readDigitalInvoice(pdf([lines,[]]));assert.equal(r.parsed.gross_amount,123);assert.equal(r.parsed.auto_book,false);assert.equal(r.needs_ocr,true)});
test('image-only PDF requests OCR without inventing invoice fields',async()=>{const r=await readDigitalInvoice(pdf([[]]));assert.equal(r.needs_ocr,true);assert.equal(r.parsed.invoice_number,null);assert.equal(r.parsed.gross_amount,null)});
test('malformed PDF reports an error instead of successful empty extraction',async()=>{await assert.rejects(()=>readDigitalInvoice(new Uint8Array(Buffer.from('not a PDF'))))});
