'use client';
import {useEffect,useState} from 'react';
import {db} from '../lib/supabase';

type Change={id:number;previous_balance:number|string;target_balance:number|string;actor_email:string|null;created_at:string};
const money=(value:number|string)=>Number(value).toLocaleString('pl-PL',{style:'currency',currency:'PLN'});
export default function BalanceEditor({investmentId,currentBalance,onSaved,disabled,onBusyChange}:{investmentId:string;currentBalance:number;onSaved:()=>Promise<void>;disabled:boolean;onBusyChange:(busy:boolean)=>void}){
 const [target,setTarget]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[history,setHistory]=useState<Change[]>([]),[historyError,setHistoryError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setHistory([]);setHistoryError('');
  async function load(){try{const {data,error}=await db.rpc('portal_balance_history',{p_investment_id:investmentId});if(error)throw error;if(active)setHistory((data||[]) as Change[])}catch{if(active)setHistoryError('Nie udało się pobrać wewnętrznej historii korekt.')}}
  void load();return()=>{active=false};
 },[investmentId,currentBalance,revision]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(disabled||busy)return;const normalized=target.trim().replace(',','.');
  if(!/^-?\d{1,12}(\.\d{1,2})?$/.test(normalized)){setMessage('Wpisz kwotę z najwyżej dwoma miejscami po przecinku.');return}
  if(!window.confirm(`Ustawić saldo tej inwestycji na ${money(normalized)}? Klient nie zobaczy wpisu o tej korekcie w historii.`))return;
  setBusy(true);onBusyChange(true);setMessage('');
  try{
   const {error}=await db.rpc('set_portal_balance',{p_investment_id:investmentId,p_target:normalized,p_expected:currentBalance.toFixed(2)});
   if(error){if(error.code==='40001'){await onSaved();throw Error('Saldo zmieniło się w międzyczasie. Dane odświeżono — sprawdź je i ponownie zapisz kwotę.')}throw Error('Nie udało się ustawić salda. Sprawdź uprawnienia administratora i spróbuj ponownie.')}
   setTarget('');setRevision(value=>value+1);
   try{await onSaved();setMessage('Ustawiono saldo. Korekta jest widoczna tylko w wewnętrznej historii administratora.')}catch{setMessage('Zapisano saldo, ale nie udało się odświeżyć widoku. Odśwież stronę przed kolejną zmianą.')}
  }catch(error){setMessage(error instanceof Error?error.message:'Nie udało się ustawić salda.')}
  finally{setBusy(false);onBusyChange(false)}
 }
 return <section className="panel"><h2>Ustaw saldo do wykorzystania</h2><p>Aktualne saldo: <b>{money(currentBalance)}</b></p><p className="muted">Tylko administrator może wpisać docelową kwotę salda. Klient zobaczy tę kwotę zgodnie z ustawieniami widoczności, bez wpisu o korekcie w historii. Późniejsze wpłaty i zaksięgowane faktury nadal zmieniają saldo.</p>
  <form onSubmit={save}><label>Nowe saldo do wykorzystania (PLN)<input inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)} placeholder="Np. 15000,00" required disabled={busy||disabled} maxLength={16}/></label><button disabled={busy||disabled}>{busy?'Zapisywanie…':'Ustaw saldo'}</button></form>
  {message&&<p role="status" className="notice">{message}</p>}
  <details><summary>Wewnętrzna historia korekt — tylko administrator</summary>{historyError?<p role="alert">{historyError}</p>:history.length?<div className="table-wrap"><table><thead><tr><th>Data</th><th>Administrator</th><th>Poprzednie saldo</th><th>Ustawione saldo</th></tr></thead><tbody>{history.map(item=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString('pl-PL',{timeZone:'Europe/Warsaw'})}</td><td>{item.actor_email||'Administrator'}</td><td>{money(item.previous_balance)}</td><td>{money(item.target_balance)}</td></tr>)}</tbody></table><small>Ostatnie 50 korekt. Pełny rejestr pozostaje w bazie.</small></div>:<p>Brak ręcznych korekt salda.</p>}</details>
 </section>;
}
