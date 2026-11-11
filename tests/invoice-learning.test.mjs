import test from 'node:test';
import assert from 'node:assert/strict';
import {learnedSuggestions,supplierKey} from '../lib/invoice-learning.mjs';
const text=(amount='123,45',number='FV/12',date='11.11.2026')=>`Sprzedawca\nNIP 1234567890\nNabywca\nNIP 0987654321\nIdentyfikator sprzedaży: ${number}\nWydano dnia: ${date}\nŁącznie PLN: ${amount}`;
const example=(hash,amount='123,45',number='FV/12',date='11.11.2026')=>({content_sha256:hash,supplier_key:'1234567890',original_text:text(amount,number,date),original_values:{invoice_number:null,invoice_date:null,gross_amount:null},corrected_values:{invoice_number:number,invoice_date:date.split('.').reverse().join('-'),gross_amount:Number(amount.replace(',','.'))},confirmed_at:'2026-11-11'});
test('learns repeated field labels and reads new values instead of copying historical amounts or dates',()=>{
 const parsed={invoice_number:null,invoice_date:null,gross_amount:null,auto_book:true,accounting_note:'Sprawdź dane.'};
 const result=learnedSuggestions(text('567,89','FV/99','12.11.2026'),parsed,[example('a'),example('b','234,56','FV/13')]);
 assert.equal(result.invoice_number,'FV/99');assert.equal(result.invoice_date,'2026-11-12');assert.equal(result.gross_amount,567.89);
 assert.equal(result.auto_book,false);assert.match(result.accounting_note,/Podpowiedź/);assert.equal(parsed.gross_amount,null);
});
test('one correction, repeated reads of the same file, and unconfirmed examples never generalize',()=>{
 const parsed={gross_amount:null};
 for(const examples of [[example('a')],[example('a'),example('a')],[{...example('a'),confirmed_at:null},example('b')]])assert.deepEqual(learnedSuggestions(text(),parsed,examples),parsed);
});
test('rules stay with the seller, never the buyer or another supplier',()=>{
 assert.equal(supplierKey(text()),'1234567890');
 assert.equal(supplierKey('Nabywca\nNIP 0987654321'),null);
 const parsed={gross_amount:null};
 assert.deepEqual(learnedSuggestions(text().replace('1234567890','1111111111'),parsed,[example('a'),example('b')]),parsed);
});
test('ambiguous labels, negative totals and invalid dates require manual entry',()=>{
 const examples=[example('a'),example('b')],parsed={gross_amount:null,invoice_date:null};
 assert.equal(learnedSuggestions(text()+'\nŁącznie PLN: 200,00',parsed,examples).gross_amount,null);
 assert.equal(learnedSuggestions(text('-123,45'),parsed,examples).gross_amount,null);
 assert.equal(learnedSuggestions(text('123,45','FV/12','31.02.2026'),parsed,examples).invoice_date,null);
});
test('a manually typed value absent from OCR does not become a reusable constant',()=>{
 const examples=[example('a'),example('b')].map(e=>({...e,corrected_values:{gross_amount:999}}));
 assert.deepEqual(learnedSuggestions(text(),{gross_amount:null},examples),{gross_amount:null});
});
test('conflicting learned locations do not override the reading',()=>{
 const a=[example('a'),example('b')];
 const b=[example('c'),example('d')].map(e=>({...e,original_text:e.original_text.replace('Łącznie PLN:','Suma do uregulowania:')}));
 const result=learnedSuggestions(text()+'\nSuma do uregulowania: 900,00',{gross_amount:null},[...a,...b]);
 assert.equal(result.gross_amount,null);
});
test('learns a label on the previous line only when it has independent confirmations',()=>{
 const examples=[example('a'),example('b')].map(e=>({...e,original_text:e.original_text.replace('Łącznie PLN: ','Łącznie PLN:\n')}));
 assert.equal(learnedSuggestions(text('345,67').replace('Łącznie PLN: ','Łącznie PLN:\n'),{gross_amount:null},examples).gross_amount,345.67);
 assert.equal(learnedSuggestions(text('345,67'),{gross_amount:null},examples).gross_amount,null);
});
