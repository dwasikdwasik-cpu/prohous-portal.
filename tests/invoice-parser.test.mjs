import test from 'node:test';import assert from 'node:assert/strict';import {parseInvoiceText} from '../lib/invoice-parser.mjs';
const valid='Faktura VAT nr FV/2026/11/12\nData wystawienia: 06.11.2026\nSprzedawca\nNIP: 1234567890\nNabywca\nRazem netto: 1 003,71 PLN\nKwota VAT: 230,85 PLN\nRazem brutto: 1 234,56 PLN';
test('extracts invoice number, issue date, gross amount and seller',()=>{const r=parseInvoiceText(valid);assert.equal(r.invoice_number,'FV/2026/11/12');assert.equal(r.invoice_date,'2026-11-06');assert.equal(r.gross_amount,1234.56);assert.equal(r.supplier,'NIP 1234567890');assert.equal(r.auto_book,true)});
test('supports ungrouped and dot-grouped amounts and ISO issue dates',()=>{for(const amount of ['1234,56','1.234,56','1234.56']){const r=parseInvoiceText(valid.replace('1 234,56',amount).replace('06.11.2026','2026-11-06'));assert.equal(r.gross_amount,1234.56);assert.equal(r.auto_book,true)}});
test('ambiguous amounts, foreign currency, corrections, missing currency and bad dates never auto-book',()=>{for(const source of [valid+'\nDo zapłaty: 999,00 PLN',valid.replace('PLN','EUR'),valid+'\nFaktura korygująca',valid.replaceAll('PLN',''),valid.replace('06.11.2026','99.99.2026'),valid.replace('1 234,56','-123,00')])assert.equal(parseInvoiceText(source).auto_book,false,source)});
test('does not guess fields from an unrelated filename or tax table',()=>{const r=parseInvoiceText('1313450536_KSEF_1180000314-20260929.pdf\nNetto VAT Brutto\n100,00 23,00 123,00');assert.equal(r.auto_book,false);assert.equal(r.invoice_number,null);assert.equal(r.gross_amount,null)});
test('multiple different invoice numbers require review',()=>{assert.equal(parseInvoiceText(valid+'\nFaktura nr FV/999').auto_book,false)});

test('KSeF uses the top invoice number on its own line and total gross payable',()=>{
 const text='Faktura\nNumer faktury\n1234567890\nNumer KSeF\n1111111111-20261106-ABCDEF123456-AB\nData dostarczenia do KSeF\n2026-11-07 10:00\nSprzedawca\nNIP: 1234567890\nNabywca\nData wystawienia: 2026-11-06\nFaktura wystawiona w cenach netto w walucie PLN\nKwota należności ogółem: 451,75 PLN\nPodsumowanie stawek podatku\nKwota netto Kwota podatku Kwota brutto\n23% 367,28 84,47 451,75\nOpis: Faktura nr OLD/123';
 const r=parseInvoiceText(text);assert.equal(r.invoice_number,'1234567890');assert.equal(r.gross_amount,451.75);assert.equal(r.invoice_date,'2026-11-06');assert.equal(r.auto_book,true);
});
test('KSeF identifier is never substituted for a missing invoice number',()=>{
 const r=parseInvoiceText('Faktura\nNumer faktury\nNumer KSeF\n1111111111-20261106-ABCDEF123456-AB\nKwota należności ogółem: 451,75 PLN\nData wystawienia: 2026-11-06');assert.equal(r.invoice_number,null);assert.equal(r.auto_book,false);
});
test('KSeF total may follow its label on the next line',()=>{
 const r=parseInvoiceText('Numer faktury: FV/123/2026\nData wystawienia: 2026-11-06\nRazem netto: 1 000,00 PLN\nKwota VAT: 250,00 PLN\nKwota należności ogółem\n1 250,00 PLN');assert.equal(r.invoice_number,'FV/123/2026');assert.equal(r.gross_amount,1250);assert.equal(r.auto_book,true);
});

test('gross amount must reconcile with net and VAT before automatic invoice booking',()=>{
 assert.equal(parseInvoiceText(valid.replace('230,85','200,00')).auto_book,false);
 const onlyGross='Numer faktury: FV/77\nData wystawienia: 2026-11-06\nDo zapłaty: 123,00 PLN';
 assert.equal(parseInvoiceText(onlyGross).auto_book,false);
 assert.equal(parseInvoiceText(onlyGross,{category:'platnosci'}).auto_book,true);
});
test('scans the VAT summary across pages and validates multiple VAT rates',()=>{
 const text='Numer faktury\nFV/77\nSprzedawca\nData wystawienia: 2026-11-06\nKwota należności ogółem: 231,00 PLN\nStrona 2\nPodsumowanie stawek podatku\nKwota netto Kwota podatku Kwota brutto\n23% 100,00 23,00 123,00\n8% 100,00 8,00 108,00\nPłatność';
 assert.equal(parseInvoiceText(text).auto_book,true);
 assert.equal(parseInvoiceText(text.replace('8,00 108,00','9,00 108,00')).auto_book,false);
 assert.equal(parseInvoiceText(text.replace('231,00','232,00')).auto_book,false);
});
test('a PDF containing two separate invoice headers never auto-books one as the whole file',()=>{
 assert.equal(parseInvoiceText(valid+'\nNumer faktury\nFV/OTHER/2\nKwota należności ogółem: 1 234,56 PLN').auto_book,false);
});
test('KSeF payable conflicts and unreadable tax summaries require review',()=>{
 const text='Numer faktury: FV/8\nData wystawienia: 2026-11-06\nKwota należności ogółem: 123,00 PLN\nPodsumowanie stawek podatku\n23% 100,00 23,00 123,00';
 assert.equal(parseInvoiceText(text).auto_book,true);
 assert.equal(parseInvoiceText(text+'\nDo zapłaty: 50,00 PLN').auto_book,false);
 assert.equal(parseInvoiceText(text.replace('23% 100,00 23,00 123,00','nieczytelna tabela')).auto_book,false);
});

test('unsupported thousands separators and Unicode negative amounts are never read as smaller positive amounts',()=>{
 const us='Numer faktury: FV/99\nData wystawienia: 2026-11-06\nRazem netto: 1,000.00 PLN\nKwota VAT: 234.56 PLN\nRazem brutto: 1,234.56 PLN';
 assert.equal(parseInvoiceText(us).auto_book,false);
 assert.equal(parseInvoiceText(valid.replace('1 234,56','−1 234,56')).auto_book,false);
});

test('KSeF issue date ignores dates in delivery, payment terms, WZ and QR verification',()=>{
 const text='Numer faktury\nFV/2026/44\nNumer KSeF\n1111111111-20261104-ABCDEF123456-AB\nData dostarczenia do KSeF\n2026-11-04 04:06\nSprzedawca\nNIP: 1234567890\nNabywca\nData wystawienia, z zastrzeżeniem art. 106na ust. 1 ustawy: 2026-11-04\nData dostawy: 2026-11-03\nKwota należności ogółem: 123,00 PLN\nPodsumowanie stawek podatku\n23% 100,00 23,00 123,00\nPłatność\nTermin płatności Opis terminu płatności\n2026-12-04 30 DAYS data wystawienia dokumentu\nDataWZ[#] 2026-11-03\nSprawdź fakturę w KSeF';
 const r=parseInvoiceText(text);assert.equal(r.invoice_date,'2026-11-04');assert.equal(r.invoice_number,'FV/2026/44');assert.equal(r.gross_amount,123);assert.equal(r.auto_book,true);
});
test('isolated issue-date labels read a following date without borrowing delivery dates',()=>{
 assert.equal(parseInvoiceText(valid.replace('06.11.2026','\n2026-11-06')).invoice_date,'2026-11-06');
 assert.equal(parseInvoiceText(valid.replace('Data wystawienia: 06.11.2026','Data wystawienia\nData dostawy: 2026-11-06')).invoice_date,null);
 assert.equal(parseInvoiceText(valid.replace('06.11.2026','6.11.2026')).invoice_date,'2026-11-06');
});

test('scanned fiscal receipt reads its standalone date, PLN total, receipt reference and seller NIP for manual verification',()=>{
 const r=parseInvoiceText('SKLEP TESTOWY\nNIP 111-22-33-444\nPARAGON FISKALNY\nSUMA PLN 49,47\n000009/1461 #050 KA\nNIP Nabywcy: 5556667788\n2026-08-26 08:14');
 assert.equal(r.invoice_number,'000009/1461');assert.equal(r.invoice_date,'2026-08-26');assert.equal(r.gross_amount,49.47);assert.equal(r.supplier,'NIP 1112233444');assert.equal(r.auto_book,false);
});
test('explicit simplified invoice number takes precedence over receipt reference and never includes the label',()=>{
 const r=parseInvoiceText('SKLEP TESTOWY\nNIP 1112233444\nPARAGON FISKALNY\nSUMA PLN 98,00\n000151/0739 #053\nNIP Nabywcy: 5556667788\n2026-08-26\n14:12\nNr faktury uproszczonej 800600/010000/26');
 assert.equal(r.invoice_number,'800600/010000/26');assert.equal(r.invoice_date,'2026-08-26');assert.equal(r.gross_amount,98);assert.equal(r.auto_book,false);
});
test('receipt date is not inferred for unrelated documents and ambiguous receipt dates remain unset',()=>{
 assert.equal(parseInvoiceText('Dokument\n2026-08-26\nSUMA PLN 98,00').invoice_date,null);
 const r=parseInvoiceText('PARAGON FISKALNY\n2026-08-26\n2026-08-27\nSUMA PLN 98,00');assert.equal(r.invoice_date,null);assert.equal(r.auto_book,false);
});
