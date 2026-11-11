import test from 'node:test';import assert from 'node:assert/strict';
import {pdfInvoiceText,reconcileInvoiceReadings} from '../lib/invoice-readings.mjs';
const source='Numer faktury: FV/2026/77\nData wystawienia: 2026-11-04\nSprzedawca\nNIP: 1234567890\nNabywca\nRazem netto: 100,00 PLN\nKwota VAT: 23,00 PLN\nRazem brutto: 123,00 PLN';
test('PDF geometry restores lines from unsorted fragmented text without losing logical order',()=>{
 const item=(str,x,y,hasEOL=false)=>({str,transform:[1,0,0,1,x,y],height:10,hasEOL});
 const r=pdfInvoiceText([item('123,00 PLN',180,20),item('Razem brutto:',20,20),item('FV/1',180,100),item('Numer faktury:',20,100)]);
 assert.match(r.visual,/Numer faktury:.*FV\/1\nRazem brutto:.*123,00 PLN/);
});
test('a complete digital reading is not downgraded by an empty/low-confidence OCR pass',()=>{
 const r=reconcileInvoiceReadings([{text:source,source:'pdf',confidence:100},{text:'nieczytelne',source:'ocr',confidence:30}]);assert.equal(r.invoice_date,'2026-11-04');assert.equal(r.auto_book,true);
});
test('low confidence keeps extracted fields but prevents automatic booking',()=>{
 const r=reconcileInvoiceReadings([{text:source,source:'ocr',confidence:60}]);assert.equal(r.gross_amount,123);assert.equal(r.invoice_number,'FV/2026/77');assert.equal(r.auto_book,false);
});
test('conflicting OCR passes keep the best candidate for review without automatic booking',()=>{
 const r=reconcileInvoiceReadings([{text:source,source:'ocr',confidence:97},{text:source.replace('FV/2026/77','FV/2026/11'),source:'ocr',confidence:92}]);assert.equal(r.invoice_number,'FV/2026/77');assert.equal(r.auto_book,false);assert.match(r.accounting_note,/Różne odczyty/);
});
test('extra scanned invoice pages cannot be ignored after a complete digital invoice',()=>{
 const r=reconcileInvoiceReadings([{text:source,source:'pdf',confidence:100},{text:source+'\nNumer faktury: FV/SECOND/9',source:'ocr',confidence:95}]);assert.equal(r.auto_book,false);assert.match(r.accounting_note,/więcej niż jedną fakturę/);
});
test('partial evidence never invents a missing amount or completes automatic booking',()=>{
 const r=reconcileInvoiceReadings([{text:'Numer faktury: FV/7\nData wystawienia: 2026-11-04',source:'ocr',confidence:99}]);assert.equal(r.gross_amount,null);assert.equal(r.auto_book,false);
});

test('OCR word boxes restore VAT rows despite column-first OCR ordering',async()=>{
 const {tsvInvoiceText}=await import('../lib/invoice-readings.mjs');
 const word=(text,x,y)=>`5\t1\t1\t1\t1\t1\t${x}\t${y}\t70\t20\t95\t${text}`;
 const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'+[word('23%',0,100),word('100,00',120,100),word('8%',0,140),word('100,00',120,140),word('23,00',250,100),word('123,00',380,100),word('8,00',250,140),word('108,00',380,140)].join('\n');
 const result=tsvInvoiceText(tsv);assert.match(result,/23%.*100,00.*23,00.*123,00\n8%.*100,00.*8,00.*108,00/);
});
