'use client';
import {ProjectFolders} from './ProjectFolders';
import {useEffect,useState} from 'react';
import {db} from '../lib/supabase';

function usePanelData(procedure, enabled=true) {
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;
    if (enabled) {
      setError('');
      db.rpc(procedure).then(({data,error})=>{
        if (!active) return;
        if (error) {setData(null);setError('Nie udało się pobrać danych. Spróbuj ponownie.');}
        else setData(data);
      }).catch(()=>{if(active){setData(null);setError('Nie udało się połączyć z portalem.');}});
    }
    return ()=>{active=false;};
  },[procedure,enabled,revision]);
  return {data,error,refresh:()=>setRevision(n=>n+1)};
}

function State({error,refresh}) {
  return error ? <p role="alert">{error} <button type="button" onClick={refresh}>Spróbuj ponownie</button></p> : <p role="status">Wczytywanie…</p>;
}
function person(row) {
  return row.email && row.name!==row.email ? row.name+' ('+row.email+')' : row.name;
}

export function DesignerAssignments() {
  const {data,error,refresh}=usePanelData('designer_admin_data');
  const [designer,setDesigner]=useState('');
  const [client,setClient]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const selected=data?.designers.find(d=>d.id===designer);
  const assigned=new Set(data?.assignments.filter(a=>a.designer_id===designer).map(a=>a.client_id));
  async function change(operation,id=null) {
    if (busy) return;
    setBusy(true);setMessage('');
    try {
      const {error}=await db.rpc('designer_admin_change',{designer,client:id,operation});
      if (error) throw error;
      setClient('');
      setMessage({approve:'Konto projektanta zatwierdzone.',add:'Przypisano klienta.',remove:'Cofnięto dostęp do inwestycji klienta.'}[operation]);
      refresh();
    } catch {setMessage('Nie udało się zapisać zmiany. Odśwież listę i spróbuj ponownie.');refresh();}
    finally {setBusy(false);}
  }
  return <section className="panel"><details><summary>Projektanci i przypisani klienci</summary>
    {!data ? <State error={error} refresh={refresh}/> : !data.designers.length ? <p>Nie ma jeszcze zarejestrowanych projektantów.</p> : <>
      <label>Projektant<select value={designer} disabled={busy} onChange={e=>{setDesigner(e.target.value);setClient('');setMessage('');}}>
        <option value="">Wybierz projektanta</option>{data.designers.map(d=><option key={d.id} value={d.id}>{person(d)}{d.status==='pending'?' — oczekuje na akceptację':''}</option>)}
      </select></label>
      {selected?.status==='pending' && <button type="button" disabled={busy} onClick={()=>change('approve')}>Zatwierdź konto projektanta</button>}
      {selected?.status==='approved' && <>
        <label>Klient<select value={client} disabled={busy} onChange={e=>setClient(e.target.value)}>
          <option value="">Wybierz klienta</option>{data.clients.filter(c=>!assigned.has(c.id)).map(c=><option key={c.id} value={c.id}>{person(c)}</option>)}
        </select></label>
        <button type="button" disabled={busy||!client} onClick={()=>change('add',client)}>Przypisz klienta</button>
        <h3>Przypisani klienci</h3>
        {assigned.size ? <ul>{data.clients.filter(c=>assigned.has(c.id)).map(c=><li key={c.id}>{person(c)} {' '}
          <button type="button" disabled={busy} onClick={()=>change('remove',c.id)}>Cofnij przypisanie</button></li>)}</ul> : <p>Projektant nie ma jeszcze przypisanego klienta.</p>}
      </>}
    </>}{message&&<p role="status">{message}</p>}
  </details></section>;
}

export function DesignerPanel({profile}) {
  const approved=profile.status==='approved';
  const {data,error,refresh}=usePanelData('designer_folder_workspace',approved);
  const [investment,setInvestment]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const chosen=investment&&data?.investments.some(i=>i.id===investment)?investment:'';
  function switchInvestment(value){setInvestment(value);setMessage('');}
  async function download(item){
    const {data,error}=await db.storage.from('portal-documents').download(item.path);
    if(error){setMessage('Nie udało się pobrać pliku.');refresh();return;}
    const url=URL.createObjectURL(data), a=document.createElement('a');a.href=url;a.download=item.title+'.'+item.extension;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  return <main className="content" style={{maxWidth:900,margin:'0 auto',padding:'1.5rem'}}>
    <header><h1>Panel projektanta</h1><p>{profile.full_name||profile.email}</p>
      <button type="button" onClick={async()=>{await db.auth.signOut();window.location.assign('/');}}>Wyloguj się</button></header>
    {!approved ? <section className="panel"><p>{profile.status==='pending'?'Twoje konto czeka na zatwierdzenie przez administratora.':'Dostęp do konta jest wstrzymany. Skontaktuj się z administratorem.'}</p></section> :
    !data ? <State error={error} refresh={refresh}/> :
    <section className="panel"><h2>Projekty realizacji</h2>
      {!data.investments.length ? <p>Nie masz jeszcze dostępnej inwestycji. Administrator przypisuje klientów do Twojego konta.</p> :
      <><label>Inwestycja<select value={chosen} disabled={busy} onChange={e=>switchInvestment(e.target.value)}>
        <option value="">Wybierz inwestycję klienta</option>{data.investments.map(i=><option key={i.id} value={i.id}>{i.client} — {i.name}</option>)}
      </select></label>
      {chosen&&<ProjectFolders key={chosen} investment={chosen} folders={data.folders.filter(f=>f.investment===chosen)}
        projects={data.projects.filter(p=>p.investment===chosen)} refresh={refresh} download={download} onBusy={setBusy}/>}</>}
    </section>}{message&&<p role="status">{message}</p>}
  </main>;
}
