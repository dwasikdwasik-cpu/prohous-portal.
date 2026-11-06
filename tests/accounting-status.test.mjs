import test from 'node:test';
import assert from 'node:assert/strict';
import {accountingMessage} from '../lib/accounting-status.mjs';
const invoice={category:'faktury',gross_amount:123.45,invoice_date:'2026-01-01',currency:'PLN',accounting_status:'needs_review'};
test('missing invoice number explains why a saved file did not debit the balance',()=>{
 assert.match(accountingMessage(invoice),/Nie odjęto od salda.*numer faktury/);
 assert.doesNotMatch(accountingMessage(invoice),/data wystawienia/);
});
test('booked and duplicate have distinct balance outcomes',()=>{
 assert.match(accountingMessage({...invoice,accounting_status:'booked'}),/kwota brutto odjęta/);
 assert.match(accountingMessage({...invoice,accounting_status:'duplicate'}),/bez ponownego/);
});
test('complete data preserves the OCR review reason, project files have no balance status',()=>{
 assert.match(accountingMessage({...invoice,invoice_number:'FV/TEST',accounting_note:'Sprzeczne kwoty VAT.'}),/Sprzeczne kwoty VAT/);
 assert.equal(accountingMessage({...invoice,category:'projekty'}),'');
});
