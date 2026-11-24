'use client';
import {useCallback,useEffect,useRef,useState, type FormEvent} from 'react';
import {db} from '../lib/supabase';
import styles from './IssuedInvoices.module.css';

type Term={id:string;due_on:string;cents:number;paid_at:string|null};
type Invoice={id:string;number:string;issued_on:string;created_at:string;total_cents:number;has_pdf:boolean;revision:number;terms:Term[]};
type Props={investmentId:string;investmentName:string;manage?:boolean;previewClient?:string};
const currency=new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'});
const money=(cents:number)=>currency.format(cents/100);
const day=(iso:string)=>iso.slice(0,10).split('-').reverse().join('.');
const outstanding=(i:Invoice)=>i.terms.reduce((sum,t)=>sum+(t.paid_at?0:t.cents),0);
const errorText=(e:unknown)=>e instanceof Error?e.message:'Nie udało się połączyć z panelem.';
function paymentState(i:Invoice) {
 const left=outstanding(i);
 return left===0?'Zapłacone':left<i.total_cents?'Częściowo zapłacone':'Do zapłaty';
}
function Badge({paid,text}:{paid:boolean;text:string}) {
 return <span className={paid?styles.paid:styles.due}>{text}</span>;
}
export default function IssuedInvoices({investmentId,investmentName,manage=false,previewClient}:Props){
 const [items,setItems]=useState<Invoice[]|null>(null),[message,setMessage]=useState(''),[loadError,setLoadError]=useState('');
 const [working,setWorking]=useState(false),[editor,setEditor]=useState<Invoice|'new'|null>(null);
 const sequence=useRef(0);
 const load=useCallback(async()=>{
  const ticket=++sequence.current;
  const {data,error}=await db.rpc('prohouse_invoice_history',{inv:investmentId,preview:previewClient||null});
  if(ticket!==sequence.current)return;
  if(error){setItems(null);setLoadError('Nie udało się pobrać historii faktur.');return}
  setItems(data||[]);setLoadError('');
 },[investmentId,previewClient]);
 useEffect(()=>{
  void load();
  const refresh=()=>{if(document.visibilityState==='visible')void load()};
  const timer=window.setInterval(refresh,30000);window.addEventListener('focus',refresh);
  return ()=>{sequence.current++;window.clearInterval(timer);window.removeEventListener('focus',refresh)};
 },[load]);
 async function change(invoice:string,version:number,action:string,details:Record<string,unknown>){
  const {error}=await db.rpc('manage_prohouse_invoice',{inv:investmentId,invoice,version,action,details});
  if(error){
   await load();
   throw Error(error.code==='23505'?'Faktura o tym numerze już jest w historii tej inwestycji.':
    error.code==='P0001'?error.message:'Nie udało się zapisać faktury. Sprawdź dane i spróbuj ponownie.');
  }
  await load();
 }
 async function settle(i:Invoice,t:Term){
  if(!window.confirm((t.paid_at?'Cofnąć potwierdzenie wpłaty':'Potwierdzić otrzymanie wpłaty')+' '+money(t.cents)+' za fakturę '+i.number+'?'))return;
  setWorking(true);setMessage('');
  try{await change(i.id,i.revision,t.paid_at?'unpaid':'paid',{term:t.id});setMessage(t.paid_at?'Cofnięto potwierdzenie wpłaty.':'Potwierdzono wpłatę.')}
  catch(e){setMessage(errorText(e))}finally{setWorking(false)}
 }
 async function download(i:Invoice){
  setWorking(true);setMessage('');
  try{
   const {data,error}=await db.rpc('prohouse_invoice_pdf',{inv:investmentId,invoice:i.id,preview:previewClient||null});
   if(error||!data)throw Error('Nie udało się pobrać pliku PDF.');
   const bytes=Uint8Array.from(atob(data),ch=>ch.charCodeAt(0));
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   const a=document.createElement('a');a.href=url;a.download='Faktura '+i.number.replace(/[^\p{L}\p{N} ._-]/gu,'-')+'.pdf';
   document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){setMessage(errorText(e))}finally{setWorking(false)}
 }
 const latest=items?.[0];
 const isNew=!!latest&&Date.now()-Date.parse(latest.created_at)<7*86400000;
 return <section className={'panel '+styles.section} aria-label={manage?'Wystawione faktury za Prohouse':'Faktury od ProHouse'}>
  <div className="section-head"><div><h2>{manage?'Wystawione faktury za Prohouse':'Faktury od ProHouse'}</h2>
   <p className="muted">{manage?'Faktury dla inwestycji „'+investmentName+'”. W tym miejscu potwierdzasz otrzymane wpłaty.':'Faktury i terminy płatności za Twoją inwestycję.'}</p></div>
   {manage&&!editor&&<button type="button" onClick={()=>{setMessage('');setEditor('new')}}>Wgraj fakturę ProHouse</button>}
  </div>
  {manage&&editor&&<InvoiceEditor key={editor==='new'?'new':editor.id} invoice={editor==='new'?null:editor} onCancel={()=>setEditor(null)}
   onSave={async(id,revision,details)=>{await change(id,revision,'save',details);setEditor(null);setMessage('Zapisano fakturę. Jest widoczna w panelu klienta.')}}/>}
  {message&&<p role="status" className="notice">{message}</p>}
  {loadError?<div role="alert">{loadError} <button className="link" onClick={()=>void load()}>Spróbuj ponownie</button></div>:
   !items?<p role="status">Wczytywanie faktur…</p>:!latest?<p className="muted">Brak wystawionych faktur dla tej inwestycji.</p>:<>
   {!manage&&<div className={styles.latest}><div><span className={styles.label}>{isNew?'Nowa faktura':'Ostatnio dodana faktura'}</span>
    <h3>{latest.number}</h3><p>Wystawiona {day(latest.issued_on)} · {money(latest.total_cents)} brutto</p></div>
    <div><Badge paid={outstanding(latest)===0} text={paymentState(latest)}/><p><strong>Pozostało {money(outstanding(latest))}</strong></p>
    {latest.has_pdf&&<button className="link" disabled={working} onClick={()=>void download(latest)}>Pobierz fakturę PDF</button>}</div></div>}
   <h3>Historia faktur</h3>
   {items.map(i=><article key={i.id} className={styles.record}><div className="section-head"><div><h4>Faktura {i.number}</h4>
    <p className="muted">{day(i.issued_on)} · {money(i.total_cents)} brutto</p></div><Badge paid={outstanding(i)===0} text={paymentState(i)}/></div>
    <ul className={styles.terms}>{i.terms.map((t,n)=><li key={t.id}><div><b>Transza {n+1}</b><small>Termin {day(t.due_on)}{t.paid_at?' · Wpłatę potwierdzono '+new Date(t.paid_at).toLocaleDateString('pl-PL',{timeZone:'Europe/Warsaw'}):''}</small></div>
     <strong>{money(t.cents)}</strong><Badge paid={!!t.paid_at} text={t.paid_at?'Zapłacone':'Do zapłaty'}/>
     {manage&&<button type="button" className="secondary" disabled={working||!!editor} onClick={()=>void settle(i,t)}>{t.paid_at?'Cofnij potwierdzenie':'Potwierdź wpłatę'}</button>}
    </li>)}</ul><div className="actions">
     {i.has_pdf&&<button className="link" disabled={working} onClick={()=>void download(i)}>Pobierz PDF</button>}
     {manage&&<button className="secondary" type="button" disabled={working||!!editor} onClick={()=>{setEditor(i);setMessage('')}}>Edytuj fakturę</button>}
    </div></article>)}
  </>}
 </section>;
}

type DraftTerm={id:string;due:string;amount:string;paid:boolean};
function cents(s:string){
 if(!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(s.trim()))return NaN;
 const [whole,fraction='']=s.trim().replace(',','.').split('.');
 return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
function newTerm():DraftTerm{return {id:crypto.randomUUID(),due:'',amount:'',paid:false}}
function readPdf(file:File):Promise<string>{
 if(file.size>5*1024*1024)throw Error('Wybierz PDF o rozmiarze do 5 MB.');
 return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('Nie udało się odczytać pliku.'));
  r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(file)});
}
function InvoiceEditor({invoice,onSave,onCancel}:{invoice:Invoice|null;onSave:(id:string,revision:number,details:Record<string,unknown>)=>Promise<void>;onCancel:()=>void}){
 const [id]=useState(()=>invoice?.id||crypto.randomUUID());
 const [rows,setRows]=useState<DraftTerm[]>(()=>invoice?.terms.map(t=>({id:t.id,due:t.due_on,amount:(t.cents/100).toFixed(2),paid:!!t.paid_at}))||[newTerm()]);
 const [total,setTotal]=useState(invoice?(invoice.total_cents/100).toFixed(2):'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Warsaw'});
 function update(id:string,data:Partial<DraftTerm>){setRows(all=>all.map(r=>r.id===id?{...r,...data}:r))}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const data=new FormData(e.currentTarget);setBusy(true);setError('');
  try{
   const totalCents=cents(total),terms=rows.map(r=>({id:r.id,due_on:r.due,cents:cents(r.amount)}));
   if(!(totalCents>0)||terms.some(t=>!(t.cents>0))||terms.reduce((s,t)=>s+t.cents,0)!==totalCents)
    throw Error('Suma transz musi być równa kwocie brutto faktury. Wpisz kwoty z dokładnością do grosza.');
   const file=data.get('pdf') as File|null;
   const pdf=file?.size?await readPdf(file):null;
   await onSave(id,invoice?.revision||0,{number:String(data.get('number')).trim(),issued_on:data.get('issued'),total_cents:totalCents,terms,pdf});
  }catch(e){setError(errorText(e))}finally{setBusy(false)}
 }
 return <form onSubmit={submit} className={styles.form}><h3>{invoice?'Edycja faktury':'Wgraj fakturę ProHouse dla klienta'}</h3>
  <fieldset disabled={busy}><label>{invoice?.has_pdf?'Zastąp PDF faktury (opcjonalnie)':'Wybierz plik faktury ProHouse (PDF, do 5 MB)'}<input name="pdf" type="file" accept="application/pdf,.pdf" required={!invoice}/></label><div className={styles.fields}><label>Numer faktury<input name="number" required maxLength={100} defaultValue={invoice?.number}/></label>
   <label>Data wystawienia<input type="date" name="issued" required defaultValue={invoice?.issued_on||today}/></label>
   <label>Kwota brutto (PLN)<input type="text" inputMode="decimal" required value={total} onChange={e=>{const v=e.target.value;setTotal(v);if(rows.length===1&&!rows[0].paid&&(rows[0].amount===total||!rows[0].amount))update(rows[0].id,{amount:v})}}/></label></div>

   <h4>Transze płatności</h4>
   {rows.map((r,n)=><div className={styles.fields} key={r.id}><label>Termin transzy {n+1}<input type="date" required value={r.due} disabled={r.paid} onChange={e=>update(r.id,{due:e.target.value})}/></label>
    <label>Kwota transzy {n+1} (PLN)<input type="text" inputMode="decimal" required value={r.amount} disabled={r.paid} onChange={e=>update(r.id,{amount:e.target.value})}/></label>
    {rows.length>1&&!r.paid&&<button type="button" className="link" onClick={()=>setRows(all=>all.filter(t=>t.id!==r.id))}>Usuń transzę {n+1}</button>}</div>)}
   <div className="actions"><button type="button" className="secondary" disabled={rows.length>=100} onClick={()=>setRows(all=>[...all,newTerm()])}>Dodaj transzę</button></div>
  </fieldset>
  {error&&<p className="notice" role="alert">{error}</p>}
  <div className="actions"><button disabled={busy}>{busy?'Zapisywanie…':invoice?'Zapisz zmiany':'Udostępnij fakturę klientowi'}</button>
  <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Anuluj</button></div></form>;
}
