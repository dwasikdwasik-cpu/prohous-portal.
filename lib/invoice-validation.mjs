const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase();
const money=/(?<![\d.,−–-])\d{1,3}(?:[ .\u00a0]\d{3})*[,.]\d{2}(?![\d.,])|(?<![\d.,−–-])\d+[,.]\d{2}(?![\d.,])/g;
export function moneyValues(line){
 return [...String(line).matchAll(money)].map(m=>Math.round(Number(m[0].replace(/[ \u00a0]/g,'').replace(/\.(?=\d{3}(?:[.,]|$))/g,'').replace(',','.'))*100)).filter(Number.isFinite);
}
export function validateInvoiceTotals(source,gross,category='faktury'){
 const lines=String(source||'').split(/[\r\n]+/).map(normalize).map(s=>s.trim()).filter(Boolean),issues=[],net=[],tax=[],rows=new Map();let summary=false,sawSummary=false;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],next=lines[i+1]||'';
  if(/podsumowanie.*(?:podatku|vat)|zestawienie.*vat/.test(line)){summary=true;sawSummary=true;continue}
  if(summary&&/^(platnosc|termin platnosci|warunki|numer rachunku|dane kontaktowe)/.test(line))summary=false;
  if(summary&&/^(?:\d{1,2}(?:[.,]\d+)?\s*%|zw\b|np\b)/.test(line)){
   const values=moneyValues(line);
   if(values.length===3){if(/[−–-]\s*\d/.test(line))issues.push('Podsumowanie zawiera kwoty ujemne.');const rate=line.match(/^(\d{1,2}(?:[.,]\d+)?)\s*%/);rows.set((rate?rate[1]:'zw')+'|'+values.join(':'),{values,rate:rate?Number(rate[1].replace(',','.')):null})}
  }
  for(const [pattern,target] of [[/(?:razem netto|suma netto|wartosc netto|kwota netto)\s*[:=]?\s*(.*)$/ ,net],[/(?:razem vat|suma vat|kwota vat|kwota podatku(?: vat)?)\s*[:=]?\s*(.*)$/ ,tax]]){
   const match=line.match(pattern);if(!match)continue;const tail=match[1].trim()||next,values=moneyValues(tail);if(values.length===1&&!/[−-]\s*\d/.test(tail))target.push(values[0]);
  }
 }
 const grossCents=Number.isFinite(gross)?Math.round(gross*100):null,unique=a=>[...new Set(a)];let corroborated=false;
 if(rows.size){
  let sum=0;
  for(const {values:[n,v,g],rate} of rows.values()){
   if(Math.abs(n+v-g)>1)issues.push('Netto + VAT nie zgadza się z brutto w podsumowaniu.');
   if(rate!==null&&Math.abs(Math.round(n*rate/100)-v)>2)issues.push('Kwota VAT nie zgadza się ze stawką podatku.');
   sum+=g;
  }
  if(grossCents!==null&&Math.abs(sum-grossCents)>1)issues.push('Suma brutto w podsumowaniu VAT różni się od kwoty do rozliczenia.');
  else if(grossCents!==null)corroborated=true;
 }else if(sawSummary)issues.push('Nie odczytano całego podsumowania VAT.');
 const ns=unique(net),ts=unique(tax);
 if(ns.length>1||ts.length>1)issues.push('Odczytano różne kwoty netto lub VAT.');
 if(ns.length===1&&ts.length===1&&grossCents!==null){if(Math.abs(ns[0]+ts[0]-grossCents)>1)issues.push('Łączne netto + VAT nie zgadza się z kwotą brutto.');else corroborated=true}
 if(category==='faktury'&&!corroborated)issues.push('Nie potwierdzono kwoty brutto obliczeniem netto + VAT. Sprawdź dokument.');
 return [...new Set(issues)];
}
