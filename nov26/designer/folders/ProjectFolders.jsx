'use client';
import {useRef,useState} from 'react';
import {db} from '../lib/supabase';

export function ProjectFolders({investment,folders,projects,refresh,download,onBusy}) {
  const [folder,setFolder]=useState('');
  const [newName,setNewName]=useState('');
  const [rename,setRename]=useState(null);
  const [title,setTitle]=useState('');
  const [queue,setQueue]=useState([]);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const input=useRef(null);
  const lock=useRef(false);
  const current=folders.find(f=>f.id===folder);
  const shown=projects.filter(p=>(p.folder||'')===folder);
  const pending=queue.filter(entry=>!entry.done);
  async function task(run) {
    if(lock.current)return;
    lock.current=true;setBusy(true);onBusy(true);setMessage('');
    try {await run();}
    catch(error){setMessage(error.message||'Nie udało się połączyć. Spróbuj ponownie.');}
    finally{lock.current=false;setBusy(false);onBusy(false);}
  }
  function openFolder(id) {
    setFolder(id);setRename(null);setQueue([]);setTitle('');setMessage('');
    if(input.current)input.current.value='';
  }
  function saveFolder(event,isRename) {
    event.preventDefault();
    task(async()=>{
      const {data,error}=await db.rpc('designer_save_folder',{investment,folder:isRename?folder:null,folder_name:(isRename?rename:newName).trim()});
      if(error)throw Error(error.code==='23505'?'Folder o tej nazwie już istnieje.':'Nie udało się zapisać folderu.');
      if(!isRename){openFolder(data);setNewName('');}
      setRename(null);setMessage(isRename?'Zmieniono nazwę folderu.':'Utworzono folder.');refresh();
    });
  }
  function selectFiles(files) {
    const list=Array.from(files);
    setQueue(list.map(file=>({id:crypto.randomUUID(),file,done:false,error:''})));
    setMessage('');setTitle('');
  }
  function upload(event) {
    event.preventDefault();
    task(async()=>{
      const session=(await db.auth.getSession()).data.session;
      if(!session)throw Error('Sesja wygasła. Zaloguj się ponownie.');
      let saved=0;
      for(const entry of pending) {
        let error='';
        const file=entry.file;
        try {
          if(!file.size || file.size>25*1024*1024)throw Error('Wybierz niepusty plik do 25 MB.');
          const ext=file.name.split('.').pop().toLowerCase();
          if(!['pdf','png','jpg','jpeg'].includes(ext))throw Error('Dozwolone formaty to PDF, JPG i PNG.');
          const name=(queue.length===1 && title.trim()) || file.name.replace(/\.[^.]+$/,'') || file.name;
          const query=new URLSearchParams({investment,request:entry.id,title:name.slice(0,160),extension:ext});
          if(folder)query.set('folder',folder);
          const res=await fetch('/api/designer-project?'+query,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/octet-stream'},body:file});
          const result=await res.json().catch(()=>null);
          if(!res.ok || !result?.id)throw Error(result?.error||'Serwer nie potwierdził zapisu pliku.');
          saved++;
        } catch(e){error=e.message||'Błąd połączenia.';}
        setQueue(items=>items.map(item=>item.id===entry.id?{...item,done:!error,error}:item));
      }
      if(saved)refresh();
      if(saved===pending.length){setQueue([]);input.current.value='';setTitle('');}
      setMessage('Zapisano '+saved+' z '+pending.length+' plików.'+(saved<pending.length?' Sprawdź komunikaty przy plikach.':''));
    });
  }
  return <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
    <legend>Foldery i pliki inwestycji</legend>
    <form onSubmit={e=>saveFolder(e,false)}><label>Nazwa nowego folderu<input required maxLength={100} value={newName} onChange={e=>setNewName(e.target.value)}/></label>
      <button disabled={!newName.trim()||queue.length>0}>Dodaj folder</button></form>
    <label>Folder<select value={folder} disabled={queue.length>0} onChange={e=>openFolder(e.target.value)}>
      <option value="">Bez folderu</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
    </select></label>
    {current&&(rename===null?<button type="button" onClick={()=>setRename(current.name)}>Zmień nazwę folderu</button>:
      <form onSubmit={e=>saveFolder(e,true)}><label>Nowa nazwa<input required maxLength={100} value={rename} onChange={e=>setRename(e.target.value)}/></label>
      <button disabled={!rename.trim()}>Zapisz nazwę</button> <button type="button" onClick={()=>setRename(null)}>Anuluj</button></form>)}
    <form onSubmit={upload}><label>Pliki projektu (PDF, JPG lub PNG, do 25 MB każdy)
      <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple onChange={e=>selectFiles(e.target.files)}/></label>
      {queue.length===1&&<label>Nazwa projektu<input maxLength={160} value={title} placeholder={queue[0].file.name} disabled={!!queue[0].error} onChange={e=>setTitle(e.target.value)}/></label>}
      {!!queue.length&&<ul>{queue.map(entry=><li key={entry.id}>{entry.file.name} · {entry.done?'Zapisano':entry.error||'Do wysłania'}</li>)}</ul>}
      <button disabled={!pending.length}>{busy?'Zapisywanie…':queue.some(e=>e.error)?'Ponów niezapisane pliki':'Wyślij pliki'}</button>
      {!!queue.length&&<button type="button" onClick={()=>{selectFiles([]);input.current.value='';}}>Wyczyść wybór</button>}
    </form>
    <p role="status" aria-live="polite">{message}</p>
    <h3>Pliki w folderze</h3>{shown.length?<ul>{shown.map(p=><li key={p.id}><button type="button" onClick={()=>download(p)}>{p.title}</button> · {new Date(p.date).toLocaleDateString('pl-PL')}</li>)}</ul>:<p>Brak plików w tym folderze.</p>}
  </fieldset>;
}
