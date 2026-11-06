import test from 'node:test';import assert from 'node:assert/strict';import {parseInvoiceText} from '../lib/invoice-parser.mjs';
const valid='Faktura VAT nr FV/2026/11/12\nData wystawienia: 06.11.2026\nSprzedawca\nNIP: 1234567890\nNabywca\nRazem brutto: 1 234,56 PLN';
test('extracts invoice number, issue date, gross amount and seller',()=>{const r=parseInvoiceText(valid);assert.equal(r.invoice_number,'FV/2026/11/12');assert.equal(r.invoice_date,'2026-11-06');assert.equal(r.gross_amount,1234.56);assert.equal(r.supplier,'NIP 1234567890');assert.equal(r.auto_book,true)});
test('supports ungrouped and dot-grouped amounts and ISO issue dates',()=>{for(const amount of ['1234,56','1.234,56','1234.56']){const r=parseInvoiceText(valid.replace('1 234,56',amount).replace('06.11.2026','2026-11-06'));assert.equal(r.gross_amount,1234.56);assert.equal(r.auto_book,true)}});
test('ambiguous amounts, foreign currency, corrections, missing currency and bad dates never auto-book',()=>{for(const source of [valid+'\nDo zapłaty: 999,00 PLN',valid.replace('PLN','EUR'),valid+'\nFaktura korygująca',valid.replace('PLN',''),valid.replace('06.11.2026','99.99.2026'),valid.replace('1 234,56','-123,00')])assert.equal(parseInvoiceText(source).auto_book,false,source)});
test('does not guess fields from an unrelated filename or tax table',()=>{const r=parseInvoiceText('1313450536_KSEF_1180000314-20260929.pdf\nNetto VAT Brutto\n100,00 23,00 123,00');assert.equal(r.auto_book,false);assert.equal(r.invoice_number,null);assert.equal(r.gross_amount,null)});
test('multiple different invoice numbers require review',()=>{assert.equal(parseInvoiceText(valid+'\nFaktura nr FV/999').auto_book,false)});

test('KSeF uses the top invoice number on its own line and total gross payable',()=>{
 const text='Faktura\nNumer faktury\n1234567890\nNumer KSeF\n1111111111-20261106-ABCDEF123456-AB\nData dostarczenia do KSeF\n2026-11-07 10:00\nSprzedawca\nNIP: 1234567890\nNabywca\nData wystawienia: 2026-11-06\nFaktura wystawiona w cenach netto w walucie PLN\nKwota należności ogółem: 451,75 PLN\nKwota brutto\n23% 367,28 84,47 451,75\nOpis: Faktura nr OLD/123';
 const r=parseInvoiceText(text);assert.equal(r.invoice_number,'1234567890');assert.equal(r.gross_amount,451.75);assert.equal(r.invoice_date,'2026-11-06');assert.equal(r.auto_book,true);
});
test('KSeF identifier is never substituted for a missing invoice number',()=>{
 const r=parseInvoiceText('Faktura\nNumer faktury\nNumer KSeF\n1111111111-20261106-ABCDEF123456-AB\nKwota należności ogółem: 451,75 PLN\nData wystawienia: 2026-11-06');assert.equal(r.invoice_number,null);assert.equal(r.auto_book,false);
});
test('KSeF total may follow its label on the next line',()=>{
 const r=parseInvoiceText('Numer faktury: FV/123/2026\nData wystawienia: 2026-11-06\nKwota należności ogółem\n1 250,00 PLN');assert.equal(r.invoice_number,'FV/123/2026');assert.equal(r.gross_amount,1250);assert.equal(r.auto_book,true);
});
