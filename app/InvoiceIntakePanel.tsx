'use client';
import {useEffect,useRef,useState} from 'react';
import {db} from '../lib/supabase';
import {matchInvoiceClient,currentScanQueue} from '../lib/invoice-intake.mjs';
import DocumentPreview from './DocumentPreview';
import {cleanupScanBatch} from '../lib/invoice-intake-batch.mjs';
import InvoiceReviewForm from './InvoiceReviewForm';
type Row=Record<string,any>;
const names:Record<string,string>={queued:'Do odczytu',needs_review:'Do przypisania / sprawdzenia',ready:'Gotowa do przypisania',imported:'W portalu — skan czeka na usunięcie',complete:'W portalu — usunięto z folderu'};
export default function InvoiceIntakePanel({canBook,onImported}:{canBook:boolean,onImported:()=>Promise<void>}){
 const [items,setItems]=useState<Row[]>([]),[targets,setTargets]=useState<Row[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[filter,setFilter]=useState('pending'),[errors,setErrors]=useState<Record<string,string>>({}),[preview,setPreview]=useState<{file:Blob|null,title:string,filename:string,intakeId:string,error?:string}|null>(null);
 const [manualFields,setManualFields]=useState<Record<string,Row>>({});
 const [draftReadings,setDraftReadings]=useState<Record<string,Row>>({});
 const active=useRef(true);useEffect(()=>{active.current=true;void reload().catch(e=>setMessage(e.message));return()=>{active.current=false}},[]);
 async function api(path:string,body?:unknown){const {data}=await db.auth.getSession();const r=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+(data.session?.access_token||''),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});if(!r.ok){const d=await r.json();throw Error(d.error||'Nie udało się wykonać operacji.')}return r;}
 async function reload(){let page=0,more=true;const items:Row[]=[];let targets:Row[]=[];while(more){const data=await (await api('/api/invoice-intake?page='+page++)).json();items.push(...data.items);targets=data.targets;more=data.more}const unique=currentScanQueue([...new Map(items.map(item=>[item.id,item])).values()]) as Row[];if(active.current){setItems(unique);setTargets(targets)}return {items:unique,targets};}
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e instanceof Error?e.message:'Nie udało się przetworzyć skanu.')}finally{if(active.current){await reload().catch(()=>{});setBusy(false)}}}
 async function review(q:Row,values:Row){const {data,error}=await db.rpc('invoice_intake_action',{p_id:q.id,p_action:'review',p_data:values});if(error)throw Error(error.message);return data;}
 async function scan(q:Row,choices:Row[]){
  setErrors(previous=>{const next={...previous};delete next[q.id];return next});
  setMessage('Czytanie na serwerze: '+q.original_name);
  const server=await (await api('/api/invoice-intake/'+q.id+'/read',{})).json();
  let parsed=server.parsed,source=server.text||'';
  if(parsed)setDraftReadings(previous=>({...previous,[q.id]:{...parsed,read_at:Date.now()}}));
  if(server.needs_ocr){
   const file=await (await api('/api/invoice-intake/'+q.id+'/file')).blob();
   const {readInvoice}=await import('../lib/invoice-reader');
   try{parsed=await readInvoice(file,text=>{if(active.current)setMessage(q.original_name+' · '+text)},'faktury',text=>source=text)}
   catch(error){if(!parsed)throw error;parsed={...parsed,auto_book:false,accounting_note:parsed.accounting_note+' Odczyt obrazu niedostępny. Sprawdź pola ręcznie.'}}
  }
  try{
   const learning=await (await api('/api/invoice-intake/'+q.id+'/learning',{operation:'observe',text:source.slice(0,60000),parsed})).json();parsed=learning.parsed;
  }catch{parsed={...parsed,accounting_note:(parsed.accounting_note||'')+' Nie zapisano historii odczytu do uczenia poprawek. Możesz nadal zapisać fakturę.'};}
  setDraftReadings(previous=>({...previous,[q.id]:{...parsed,read_at:Date.now()}}));
  if(!active.current)return;
  const match=matchInvoiceClient({filename:q.original_name,text:source},choices);
  const savedReview=await review(q,{...parsed,investment_id:match.investment_id,match_reason:match.reason});
  setItems(previous=>previous.map(item=>item.id===q.id?savedReview:item));
  setDraftReadings(previous=>{const next={...previous};delete next[q.id];return next});
  if(match.automatic&&parsed.auto_book&&!manualFields[q.id]){const saved=await (await api('/api/invoice-intake/'+q.id+'/import',{investment_id:match.investment_id})).json();if(!saved.cleaned)setErrors(e=>({...e,[q.id]:saved.error}));}
 }
 async function syncAndRead(){await run(async()=>{
  setMessage('Sprawdzanie folderu SCAN - FA…');const synced:{skipped:string[],more:boolean}={skipped:[],more:false};let page:string|null=null;do{const result=await (await api('/api/invoice-intake/sync',{page_token:page})).json();synced.skipped.push(...result.skipped);page=result.next_page_token}while(page&&active.current);const data=await reload();let processed=0,failed=0;
  const pending=data.items.filter(q=>!q.deleted_at&&!q.document_id&&!q.reviewed_at);
  for(const q of pending){if(!active.current)break;try{await scan(q,data.targets);processed++}catch(e){failed++;setErrors(previous=>({...previous,[q.id]:e instanceof Error?e.message:'Błąd odczytu skanu.'}))}await reload();}
  await onImported();setMessage(`Odczytano ${processed} skanów. ${failed?'Błędy: '+failed+'. ':''}Faktury bez pewnego przypisania lub pełnych danych czekają na sprawdzenie.`+(synced.skipped.length?' Pominięte pliki (format / rozmiar): '+synced.skipped.join(', ')+'.':'')+(synced.more?' Folder zawiera więcej skanów — ponów sprawdzenie.':''));
 });}
 async function manualImport(e:React.FormEvent<HTMLFormElement>,q:Row){e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));await run(async()=>{
  if(!q.staged_path)await api('/api/invoice-intake/'+q.id+'/file');

  await review(q,{...values,auto_book:true,accounting_note:'Dane i przypisanie sprawdzone ręcznie.',match_reason:'Przypisano ręcznie przez operatora.'});
  const saved=await (await api('/api/invoice-intake/'+q.id+'/import',{investment_id:values.investment_id})).json();
  let learningNote='';
  try{await api('/api/invoice-intake/'+q.id+'/learning',{operation:'confirm'});learningNote=' Zapamiętano zatwierdzone dane do kolejnych odczytów.'}
  catch{learningNote=' Faktura zapisana, ale nie udało się zapamiętać poprawek.'}
  await onImported();setErrors(previous=>{const next={...previous};delete next[q.id];return next});setPreview(null);setMessage((saved.cleaned?'Faktura została zapisana w portalu. Skan usunięto z folderu Google Drive.':'Faktura jest już zapisana w portalu. '+saved.error)+learningNote);
 });}
 async function removeInvoice(q:Row){
  if(!window.confirm(q.document_id?'Usunąć fakturę „'+(q.invoice_number||q.original_name)+'” z profilu klienta i obsługi faktur? Trafi do kosza inwestycji. Jej zaksięgowany koszt zostanie cofnięty w saldzie.':'Usunąć skan „'+q.original_name+'” z obsługi faktur? Nie zostanie przypisany do klienta ani ponownie pobrany w tej wersji. Plik na Google Drive pozostanie bez zmian.'))return;
  await run(async()=>{
   const {data,error}=await db.rpc('remove_intake_invoice',{p_id:q.id});if(error)throw Error(error.message);
   setPreview(null);setErrors(previous=>{const next={...previous};delete next[q.id];return next});
   await onImported();setMessage(data.document_removed?'Fakturę przeniesiono do kosza inwestycji i usunięto z obsługi faktur. Zaksięgowany koszt został cofnięty w saldzie.':'Skan usunięto z obsługi faktur. Plik Google Drive pozostaje bez zmian.');
  });
 }
 async function removeAllImported(){
  const pending=items.filter(q=>q.status==='imported'&&q.document_id&&!q.deleted_at);
  if(busy||!pending.length)return;
  if(!window.confirm('Usunąć z folderu skanera wszystkie '+pending.length+' skany z zakładki „Do usunięcia z folderu”? Faktury pozostaną w portalu. Każdy skan zostanie usunięty dopiero po potwierdzeniu poprawnej kopii.'))return;
  await run(async()=>{
   const result=await cleanupScanBatch(pending,async(q:Row)=>{
    setMessage('Sprawdzanie kopii i usuwanie skanu: '+q.original_name);
    return (await api('/api/invoice-intake/'+q.id+'/cleanup',{})).json();
   },(q:Row,result:{cleaned:boolean,error?:string})=>setErrors(previous=>{
    const next={...previous};if(result.cleaned)delete next[q.id];else next[q.id]=result.error||'Skan pozostawiono w folderze.';return next;
   }));
   setMessage('Usunięto z folderu '+result.cleaned+' z '+result.total+' skanów.'+(result.failed?' Pozostało '+result.failed+' — sprawdź komunikaty przy fakturach.':' Faktury pozostają zapisane w portalu.'));
  });
 }
 function formValues(q:Row){return {...q,...draftReadings[q.id],...manualFields[q.id]};}
 function reviewForm(q:Row){return <InvoiceReviewForm values={formValues(q)} targets={targets} busy={busy} onChange={(name,value)=>setManualFields(previous=>({...previous,[q.id]:{...previous[q.id],[name]:value}}))} onSubmit={e=>manualImport(e,q)}/>;}
 async function openPreview(q:Row){await run(async()=>{
  setPreview({file:null,title:q.invoice_number?'Faktura '+q.invoice_number:q.original_name,filename:q.original_name,intakeId:q.id});
  try{const file=await(await api(q.document_id?'/api/document/'+q.document_id:'/api/invoice-intake/'+q.id+'/file')).blob();setPreview(previous=>previous&&previous.intakeId===q.id?{...previous,file}:previous)}
  catch(error){const message=error instanceof Error?error.message:'Nie udało się pobrać podglądu';setPreview(previous=>previous&&previous.intakeId===q.id?{...previous,error:message}:previous);throw error}
 });}
 const previewItem=items.find(q=>q.id===preview?.intakeId);
 const previewTarget=previewItem?targets.find(t=>t.investment_id===(previewItem.document_id?previewItem.assigned_investment_id:(manualFields[previewItem.id]?.investment_id??previewItem.assigned_investment_id))):undefined;
 const previewAssignment=previewTarget?{client:previewTarget.client_name,investment:previewTarget.investment_name,confirmed:!!previewItem?.document_id}:previewItem?.document_id?{client:'Dane klienta niedostępne',investment:'Dane inwestycji niedostępne',confirmed:true}:null;
 const pendingCount=items.filter(q=>!q.document_id).length,cleanupCount=items.filter(q=>q.status==='imported').length;
 const visible=items.map(q=>({...q,...draftReadings[q.id]})).filter(q=>filter==='all'||(filter==='pending'?!q.document_id:filter==='cleanup'?q.status==='imported':q.status==='complete'));
 return <><section className="panel intake-heading"><span className="eyebrow">SCAN - FA / OBSŁUGA FAKTUR</span><h2>Od skanu do właściwego klienta</h2><p>Pracownik skanuje faktury do folderu Google Drive. Pobierz skany, odczytaj dane i sprawdź przypisania. Pewne dopasowania z pełnymi danymi są importowane automatycznie; pozostałe wybierzesz z listy klientów.</p><p className="muted">Po ręcznym zatwierdzeniu i zapisaniu faktury system zapamiętuje poprawki. Powtarzalne poprawki dla tego samego dostawcy pomagają podpowiadać numer, datę i kwotę na kolejnych fakturach. Podpowiedzi wymagają sprawdzenia. Jedna faktura = jeden plik PDF lub zdjęcie; faktura może mieć kilka stron. Odczyt działa w otwartym panelu. Zamknięcie strony przerywa odczyt, zachowując zapisane skany. Po potwierdzeniu kopii w portalu skan zostanie usunięty z folderu skanera; oryginały nie są kasowane bezpowrotnie. Widoczność faktur dla klienta zależy od ustawień jego inwestycji.</p>{!canBook&&<p className="notice">Twoje konto obsługuje skany i przypisania. Nie pokazuje sald i nie księguje wydatków. Rozliczenie faktur sprawdza administrator.</p>}<div className="actions"><button disabled={busy} onClick={syncAndRead}>{busy?'Trwa obsługa skanów…':'Pobierz i rozdziel faktury'}</button><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await reload();setMessage('Odświeżono kolejkę.')} )}>Odśwież kolejkę</button><a href="https://drive.google.com/drive/folders/1yIbjkSP3tsa4XsWVxlNMNia5Ah3SqmV4" target="_blank" rel="noreferrer">Otwórz folder skanera ↗</a></div>{message&&<p className="notice" role="status">{message}</p>}</section><div className="intake-filters actions" aria-label="Filtry kolejki">{[['pending',`Do obsługi (${pendingCount})`],['cleanup',`Do usunięcia z folderu (${cleanupCount})`],['complete','Zakończone'],['all','Wszystkie']].map(([key,label])=><button key={key} className={filter===key?'':'secondary'} disabled={busy} onClick={()=>setFilter(key)}>{label}</button>)}</div>{filter==='cleanup'&&<div className="actions"><button className="secondary danger" disabled={busy||!cleanupCount} onClick={removeAllImported}>{busy?'Trwa sprawdzanie i usuwanie…':'Usuń wszystko'}</button></div>}{!targets.length&&<p className="notice">Brak aktywnych inwestycji przypisanych do zatwierdzonych klientów portalu.</p>}{visible.length===0?<section className="panel"><p>Brak faktur w tym widoku. Kliknij „Pobierz i rozdziel faktury”, aby sprawdzić folder skanera.</p></section>:visible.map(q=><section className="panel intake-item" key={q.id}><div className="section-head"><div><h2>{q.original_name}</h2><small>{new Date(q.created_at).toLocaleString('pl-PL')} · {(Number(q.source_size)/1024/1024).toFixed(2)} MB</small></div><span className="pill">{names[q.status]}</span></div>{q.match_reason&&<p>{q.match_reason}</p>}{q.accounting_note&&<p className="muted">{q.accounting_note}</p>}{(errors[q.id]||q.cleanup_error)&&<p role="alert" className="notice">{errors[q.id]||q.cleanup_error}</p>}{q.document_id?<><p><b>Przypisanie:</b> {targets.find(t=>t.investment_id===q.assigned_investment_id)?.client_name||'Klient'} · {targets.find(t=>t.investment_id===q.assigned_investment_id)?.investment_name||'Inwestycja'}<br/><b>Faktura:</b> {q.invoice_number||'do sprawdzenia'} · {q.gross_amount==null?'kwota do sprawdzenia':Number(q.gross_amount).toLocaleString('pl-PL',{style:'currency',currency:'PLN'})}</p><div className="actions"><button className="secondary" disabled={busy} onClick={()=>openPreview(q)}>Podgląd zapisanej faktury</button>{q.status==='imported'&&<button disabled={busy} onClick={()=>run(async()=>{const d=await (await api('/api/invoice-intake/'+q.id+'/cleanup',{})).json();if(d.cleaned)setErrors(previous=>{const next={...previous};delete next[q.id];return next});setMessage(d.cleaned?'Potwierdzono kopię. Skan usunięto z folderu Drive.':d.error)})}>Ponów usunięcie z folderu</button>}{canBook&&<button className="secondary danger" disabled={busy} onClick={()=>removeInvoice(q)}>Usuń fakturę</button>}</div></>:<><div className="actions"><button className="secondary" disabled={busy} onClick={()=>openPreview(q)}>Podgląd i ręczne przypisanie</button><button className="secondary" disabled={busy} onClick={()=>run(async()=>{await scan(q,targets);await onImported();setMessage('Zakończono odczyt. Sprawdź dane i przypisanie.');})}>Odczytaj ponownie</button><button className="secondary danger" disabled={busy} onClick={()=>removeInvoice(q)}>Usuń fakturę</button></div>{reviewForm(q)}</>}</section>)}{preview&&<DocumentPreview file={preview.file} title={preview.title} filename={preview.filename} assignment={previewAssignment} fileError={preview.error} onClose={()=>setPreview(null)}>{previewItem&&!previewItem.document_id&&<><h3>Dane faktury i przypisanie</h3><p>Przepisz dane z podglądu i wybierz klienta. Możesz zapisać fakturę bez OCR. Zatwierdzone poprawki są zapamiętywane przy zapisie faktury.</p>{errors[previewItem.id]&&<p className="notice" role="alert">{errors[previewItem.id]}</p>}{message&&<p className="notice" role="status">{message}</p>}{reviewForm(previewItem)}</>}</DocumentPreview>}</>;
}
