'use client';
import {useEffect,useState} from 'react';
import {db} from '../lib/supabase';

type Login={session_id:string;user_id:string;email:string|null;full_name:string|null;role:string|null;profile_status:string|null;signed_in_at:string;ip_address:string|null;user_agent:string|null};
const roles:Record<string,string>={admin:'Administrator',manager:'Menedżerka',client:'Klient',electrician:'Elektryk',plumber:'Hydraulik'};
const statuses:Record<string,string>={approved:'Zatwierdzone',pending:'Oczekujące',rejected:'Zablokowane'};
const pageSize=50;
const timestamp=(value:string)=>new Date(value).toLocaleString('pl-PL',{timeZone:'Europe/Warsaw',dateStyle:'medium',timeStyle:'medium'});

export default function LoginHistory(){
 const [search,setSearch]=useState(''),[days,setDays]=useState('30'),[filter,setFilter]=useState({search:'',since:new Date(Date.now()-30*86400000).toISOString()}),[page,setPage]=useState(0),[reload,setReload]=useState(0);
 const [rows,setRows]=useState<Login[]>([]),[more,setMore]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[updated,setUpdated]=useState('');
 useEffect(()=>{
  let active=true;setBusy(true);setError('');setRows([]);setMore(false);
  async function load(){
   try{
    const result=await db.rpc('portal_login_history',{p_search:filter.search,p_since:filter.since||null,p_limit:pageSize+1,p_offset:page*pageSize});
    if(result.error)throw result.error;
    if(active){const data=(result.data||[]) as Login[];setRows(data.slice(0,pageSize));setMore(data.length>pageSize);setUpdated(new Date().toISOString())}
   }catch{if(active)setError('Nie udało się pobrać historii logowań. Sprawdź uprawnienia lub spróbuj ponownie.')}
   finally{if(active)setBusy(false)}
  }
  void load();return()=>{active=false};
 },[filter,page,reload]);
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==='visible')setReload(value=>value+1)};
  const timer=window.setInterval(refresh,60000);window.addEventListener('focus',refresh);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh)};
 },[]);
 function apply(e:React.FormEvent){e.preventDefault();setPage(0);setFilter({search:search.trim(),since:days?new Date(Date.now()-Number(days)*86400000).toISOString():''})}
 return <section className="panel">
  <div className="section-head"><div><h2>Kto logował się do panelu</h2><p className="muted">Każdy wpis oznacza utworzenie uwierzytelnionej sesji. Godziny podano w strefie Warszawy.</p></div><button className="secondary" disabled={busy} onClick={()=>setReload(value=>value+1)}>Odśwież historię</button></div>
  <form onSubmit={apply}><div className="form-row"><label>Użytkownik lub e-mail<input value={search} onChange={e=>setSearch(e.target.value)} maxLength={200} placeholder="Szukaj osoby lub adresu e-mail"/></label><label>Okres<select value={days} onChange={e=>setDays(e.target.value)}><option value="7">Ostatnie 7 dni</option><option value="30">Ostatnie 30 dni</option><option value="90">Ostatnie 90 dni</option><option value="">Cała historia</option></select></label></div><button disabled={busy}>Zastosuj filtry</button></form>
  <p className="muted">Rejestr zbiera nowe logowania od włączenia monitorowania. Odświeżenie strony i odnowienie tokenu nie tworzą kolejnych wpisów. Historia obejmuje również konta oczekujące lub zablokowane, jeśli zostały uwierzytelnione; dostęp do inwestycji nadal zależy od zatwierdzenia konta. Nieudane próby logowania nie są częścią tego rejestru.</p>
  {error&&<p role="alert" className="notice">{error}</p>}
  <div aria-live="polite">{busy?<p>Wczytywanie historii…</p>:!error&&!rows.length?<p>Brak logowań w wybranym okresie i dla podanego użytkownika.</p>:!error&&<div className="table-wrap"><table><thead><tr><th>Logowanie</th><th>Użytkownik</th><th>Rola w chwili logowania</th><th>Status konta w chwili logowania</th><th>Adres IP</th><th>Przeglądarka / urządzenie</th></tr></thead><tbody>{rows.map(row=><tr key={row.session_id}><td>{timestamp(row.signed_in_at)}</td><td><b>{row.full_name||'Bez nazwy'}</b><small>{row.email||'Brak adresu e-mail'}</small></td><td>{roles[row.role||'']||row.role||'—'}</td><td>{statuses[row.profile_status||'']||'—'}</td><td>{row.ip_address||'Brak danych'}</td><td style={{maxWidth:300,overflowWrap:'anywhere'}}>{row.user_agent||'Brak danych'}</td></tr>)}</tbody></table></div>}</div>
  <div className="section-head"><div className="actions"><button className="secondary" disabled={busy||page===0} onClick={()=>setPage(value=>value-1)}>Poprzednia</button><span>Strona {page+1}</span><button className="secondary" disabled={busy||!!error||!more} onClick={()=>setPage(value=>value+1)}>Następna</button></div>{updated&&!error&&<small>Ostatnio sprawdzono: {timestamp(updated)} · odświeżanie co minutę</small>}</div>
 </section>;
}
