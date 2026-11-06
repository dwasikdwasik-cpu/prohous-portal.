const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLowerCase();
export function parseInvoiceText(source){
 const lines=String(source||'').split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean),plain=normalize(lines.join('\n'));
 const issues=[];
 const numbers=[];const dates=[];const amounts=[];
 for(let i=0;i<lines.length;i++){
  const line=normalize(lines[i]),next=normalize(lines[i+1]||'');
  const number=line.match(/(?:numer faktury|nr faktury|faktura(?: vat)?(?: nr| numer)?|numer dokumentu|nr dokumentu)\s*[:#]?\s*([a-z0-9][a-z0-9/_.-]{1,79})/);
  if(number&&!/^(vat|nr|numer|korygujaca|korekta|pro|data)$/.test(number[1])&&/\d/.test(number[1]))numbers.push(number[1].toUpperCase());
  if(/data wystawienia/.test(line)){
   const m=(line+' '+next).match(/\b(20\d{2})[-/.](\d{2})[-/.](\d{2})\b|\b(\d{2})[-/.](\d{2})[-/.](20\d{2})\b/);
   if(m){const iso=m[1]?`${m[1]}-${m[2]}-${m[3]}`:`${m[6]}-${m[5]}-${m[4]}`;if(Number.isFinite(new Date(iso+'T00:00:00Z').getTime())&&new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso)dates.push(iso)}
  }
  const label=line.match(/(?:razem(?: do zaplaty)? brutto|wartosc brutto|suma brutto|kwota brutto|razem do zaplaty|do zaplaty|kwota przelewu|kwota transakcji)\s*[:=]?\s*(.*)$/);
  if(label){const tail=label[1].trim()||next;const matches=[...tail.matchAll(/(?<![\d-])\d{1,3}(?:[ .\u00a0]\d{3})*[,.]\d{2}(?!\d)|(?<![\d-])\d+[,.]\d{2}(?!\d)/g)];
   if(matches.length===1&&!/^\s*-/.test(tail)){const raw=matches[0][0],n=Number(raw.replace(/[ \u00a0]/g,'').replace(/\.(?=\d{3}(?:[.,]|$))/g,'').replace(',','.'));if(Number.isFinite(n)&&n>0&&n<1e12)amounts.push(Math.round(n*100)/100)}
  }
 }
 const unique=a=>[...new Set(a)],ns=unique(numbers),ds=unique(dates),as=unique(amounts);
 if(ns.length!==1)issues.push(ns.length?'Różne numery dokumentu.':'Brak jednoznacznego numeru dokumentu.');
 if(ds.length!==1)issues.push('Sprawdź datę wystawienia.');
 if(as.length!==1)issues.push('Sprawdź kwotę brutto — odczyt nie jest jednoznaczny.');
 if(/\b(korekta|korygujaca|pro forma|proforma|zaliczkowa)\b/.test(plain))issues.push('Dokument wymaga sprawdzenia przed rozliczeniem.');
 const foreign=/\b(EUR|USD|GBP|CHF|CZK)\b/i.test(source),currency=foreign?'OTHER':/\bpln\b|\bzl\b/.test(plain)?'PLN':'UNKNOWN';
 if(currency==='UNKNOWN')issues.push('Sprawdź walutę dokumentu.');
 if(foreign)issues.push('Dokument zawiera walutę inną niż PLN.');
 const seller=plain.split(/sprzedawca|wystawca/)[1]?.split(/nabywca|odbiorca/)[0]||'';
 const nip=seller.match(/nip\s*:?\s*(?:pl\s*)?([\d -]{10,18})/i)?.[1]?.replace(/\D/g,'');
 return {invoice_number:ns.length===1?ns[0]:null,invoice_date:ds.length===1?ds[0]:null,gross_amount:as.length===1?as[0]:null,supplier:nip?.length===10?'NIP '+nip:null,currency,auto_book:issues.length===0,accounting_note:issues.join(' ')};
}
