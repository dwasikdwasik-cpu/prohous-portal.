export function accountingMessage(document){
 if(!['faktury','platnosci'].includes(document.category))return '';
 if(document.accounting_status==='booked')return 'Zaksięgowano — kwota brutto odjęta od salda.';
 if(document.accounting_status==='duplicate')return 'Duplikat — bez ponownego potrącenia.';
 const missing=[];
 if(!String(document.invoice_number||'').trim())missing.push('numer faktury / dokumentu');
 if(!document.invoice_date)missing.push('data wystawienia');
 if(!(Number(document.gross_amount)>0))missing.push('dodatnia kwota brutto');
 if(document.currency!=='PLN')missing.push('potwierdzona kwota w PLN');
 return 'Nie odjęto od salda. '+(missing.length?'Uzupełnij: '+missing.join(', ')+'.':document.accounting_note||'Sprawdź dane i wybierz Zapisz i zaksięguj.');
}
