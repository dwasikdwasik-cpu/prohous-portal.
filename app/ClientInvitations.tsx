'use client';
import {useEffect,useRef,useState,FormEvent} from 'react';

type Member={email:string,key:string,active:boolean,sent:boolean,expired:boolean};
type Props={id:string,name:string,primary?:string,api:(path:string,body:unknown)=>Promise<Response>,onSelected:(id:string)=>Promise<void>};
export default function ClientInvitations({id,name,primary,api,onSelected}:Props){
 const [mode,setMode]=useState(id?'existing':'new'),[title,setTitle]=useState(''),[emails,setEmails]=useState('');
 const [members,setMembers]=useState<Member[]>([]),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const nextId=useRef(''),[createdId,setCreatedId]=useState('');
 const panel=mode==='new'?createdId:id;
 const call=async(action:string,investmentId:string,extra:Record<string,string>={})=>(await api('/api/admin/client-invitations',{action,investmentId,...extra})).json();
 useEffect(()=>{let alive=true;setMembers([]);if(panel)call('list',panel).then(r=>{if(alive)setMembers(r.members)}).catch(()=>{if(alive)setStatus('Nie udało się wczytać listy zaproszeń.')});return()=>{alive=false}},[panel]);
 async function deliver(target:string,list:string[]){
  const results:string[]=[];
  for(const email of list){
   try{const r=await call('send',target,{email});results.push(email+' — '+(r.active?'ma już dostęp':'wysłano zaproszenie'))}
   catch(e){results.push(email+' — '+(e instanceof Error?e.message:'wysyłka niepotwierdzona'))}
  }
  setStatus(results.join('\n'));
  const r=await call('list',target);setMembers(r.members);
 }
 async function submit(e:FormEvent){
  e.preventDefault();if(busy)return;
  const list=[...new Set(emails.split(/[\s,;]+/).filter(Boolean).map(x=>x.toLowerCase()))];
  if(list.some(x=>x.length>254||!/^\S+@[^@\s]+\.[^@\s]+$/.test(x))){setStatus('Sprawdź podane adresy e-mail.');return}
  if(!list.length&&mode==='existing'){setStatus('Wpisz przynajmniej jeden adres e-mail.');return}
  setBusy(true);setStatus('');
  try{
   let target=panel;
   if(mode==='new'&&!target){nextId.current ||= crypto.randomUUID();target=nextId.current;await call('create',target,{name:title.trim()});setCreatedId(target)}
   if(list.length)await deliver(target,list);else setStatus('Panel został utworzony. Adresy możesz dodać w dowolnej chwili.');
   setEmails('');if(mode==='new'){await onSelected(target);setMode('existing');setCreatedId('');nextId.current='';setTitle('')}
  }catch(e){setStatus(e instanceof Error?e.message:'Nie udało się zapisać zmian.')}finally{setBusy(false)}
 }
 async function memberAction(m:Member,remove:boolean){
  if(busy||!panel)return;
  if(remove&&!window.confirm('Cofnąć zaproszenie lub dodatkowy dostęp dla '+m.email+' do tego panelu?'))return;
  setBusy(true);try{if(remove){await call('remove',panel,{email:m.key});setMembers((await call('list',panel)).members);setStatus('Cofnięto dostęp lub zaproszenie.')}else await deliver(panel,[m.email])}
  catch(e){setStatus(e instanceof Error?e.message:'Nie udało się zmienić dostępu.')}finally{setBusy(false)}
 }
 return <section className="panel"><h2>Panele klientów i zaproszenia</h2><form onSubmit={submit}>
 <label>Panel klienta<select value={mode} disabled={busy} onChange={e=>{setMode(e.target.value);setStatus('')}}>
 {id&&<option value="existing">Wybrana inwestycja · {name}</option>}<option value="new">Utwórz nowy panel inwestycji</option></select></label>
 {mode==='new'&&<label>Nazwa inwestycji<input required maxLength={200} readOnly={!!createdId} value={title} onChange={e=>setTitle(e.target.value)}/></label>}
 <label>Adresy e-mail klientów<textarea rows={3} value={emails} onChange={e=>setEmails(e.target.value)} placeholder="Wpisz adresy po przecinku lub po jednym w wierszu"/></label>
 <small>Każda osoba otrzyma osobne zaproszenie do tej samej inwestycji i będzie korzystać z własnego hasła.</small>
 <button disabled={busy}>{busy?'Proszę czekać…':mode==='new'?(emails.trim()?'Utwórz panel i wyślij zaproszenia':'Utwórz panel'):'Wyślij zaproszenia'}</button></form>
 {panel&&<div>{mode==='existing'&&primary&&<p>Główny klient · {primary}</p>}{members.map(m=><div className="doc-row" key={m.key}><div><b>{m.email}</b><small>{m.active?'Dostęp aktywny':m.expired?'Zaproszenie wygasło':m.sent?'Zaproszenie wysłane':'Wysyłka niepotwierdzona'}</small></div><div className="actions">{!m.active&&<button className="secondary" disabled={busy} onClick={()=>memberAction(m,false)}>Wyślij ponownie</button>}<button className="secondary danger" disabled={busy} onClick={()=>memberAction(m,true)}>{m.active?'Cofnij dostęp':'Wycofaj zaproszenie'}</button></div></div>)}</div>}
 {status&&<p role="status" style={{whiteSpace:'pre-line'}}>{status}</p>}</section>
}
