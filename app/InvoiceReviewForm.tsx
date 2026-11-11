'use client';
type Row=Record<string,any>;
export default function InvoiceReviewForm({values,targets,busy,onChange,onSubmit}:{values:Row,targets:Row[],busy:boolean,onChange:(name:string,value:string|boolean)=>void,onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void}){
 const selected=String(values.investment_id??values.assigned_investment_id??''),search=String(values.client_search||'');
 const choices=targets.filter(t=>!search||[t.client_name,t.investment_name].join(' ').toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'))||t.investment_id===selected);
 return <form className="intake-review" onSubmit={onSubmit}>
  <label>Szukaj klienta<input type="search" placeholder="Imię, nazwisko lub inwestycja…" value={search} onChange={e=>onChange('client_search',e.target.value)} disabled={busy}/></label>
  <label>Klient i inwestycja<select name="investment_id" value={selected} onChange={e=>onChange('investment_id',e.target.value)} disabled={busy} required><option value="">Wybierz klienta i inwestycję…</option>{choices.map(t=><option value={t.investment_id} key={t.investment_id}>{t.client_name} — {t.investment_name}</option>)}</select></label>
  <label>Numer faktury<input name="invoice_number" value={values.invoice_number??''} onChange={e=>onChange('invoice_number',e.target.value)} disabled={busy} required maxLength={150}/></label>
  <label>Data wystawienia<input name="invoice_date" type="date" value={values.invoice_date??''} onChange={e=>onChange('invoice_date',e.target.value)} disabled={busy} required/></label>
  <div className="form-row"><label>Kwota brutto<input name="gross_amount" type="number" min="0.01" step="0.01" value={values.gross_amount??''} onChange={e=>onChange('gross_amount',e.target.value)} disabled={busy} required/></label><label>Waluta<select name="currency" value={values.currency||'UNKNOWN'} onChange={e=>onChange('currency',e.target.value)} disabled={busy}><option value="PLN">PLN</option><option value="OTHER">Inna — sprawdź rozliczenie</option><option value="UNKNOWN">Do sprawdzenia</option></select></label></div>
  <label>Dostawca / NIP<input name="supplier" value={values.supplier??''} onChange={e=>onChange('supplier',e.target.value)} disabled={busy} maxLength={300}/></label>
  <label className="checkbox-label"><input type="checkbox" checked={values.confirmed===true} onChange={e=>onChange('confirmed',e.target.checked)} required disabled={busy}/>Sprawdziłem dane i potwierdzam przypisanie całego pliku do wybranego klienta.</label>
  <button disabled={busy||!targets.length}>{busy?'Proszę czekać…':'Zapisz fakturę'}</button>
  <small>Po potwierdzeniu kopii w portalu skan zostanie usunięty z folderu Google Drive.</small>
 </form>;
}
