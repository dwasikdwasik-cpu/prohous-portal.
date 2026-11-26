'use client';
import {useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {db} from '../lib/supabase';

type Folder = {id: string; name: string};
type DocumentRow = Record<string, any>;
type Props = {
  investment: string;
  documents: DocumentRow[];
  busy: boolean;
  uploadForm: (folder: string) => ReactNode;
  renderFile: (doc: DocumentRow) => ReactNode;
  refresh: () => Promise<void>;
};

export default function InvestmentProjectFolders({investment, documents, busy, uploadForm, renderFile, refresh}: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeId, setActiveId] = useState('');
  const [names, setNames] = useState('');
  const [newName, setNewName] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [destination, setDestination] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const revision = useRef(0);
  const active = folders.find(folder => folder.id === activeId);
  const files = documents.filter(doc => doc.investment_id === investment);
  const shown = files.filter(doc => (doc.project_folder_id || '') === activeId);
  const selectedIds = shown.filter(doc => checked.includes(doc.id)).map(doc => doc.id);
  const locked = busy || working;
  function openFolder(id: string) {
    setActiveId(id); setNewName(null); setChecked([]); setDestination(''); setNotice('');
  }
  const load = useCallback(async () => {
    const request = ++revision.current;
    const {data, error} = await db.from('investment_project_folders').select('id,name')
      .eq('investment_id', investment).order('name');
    if (request !== revision.current) return;
    setLoadError(Boolean(error));
    if (error) return;
    const rows: Folder[] = data || [];
    setFolders(rows);
    setActiveId(current => rows.some(folder => folder.id === current) ? current : '');
  }, [investment]);
  useEffect(() => {
    void load();
    const onFocus = () => { if (!lock.current) void load(); };
    window.addEventListener('focus', onFocus);
    return () => { ++revision.current; window.removeEventListener('focus', onFocus); };
  }, [load]);

  async function run(task: () => Promise<void>) {
    if (lock.current || busy) return;
    lock.current = true; setWorking(true); setNotice('');
    try { await task(); }
    catch (error) {
      const err = error as {code?: string; message?: string};
      setNotice(err.code === '23505' ? 'Folder o tej nazwie już istnieje. Sprawdź wpisane nazwy.'
        : err.code === 'PGRST116' ? 'Folder został zmieniony lub usunięty. Odśwież listę.'
        : err.message || 'Nie udało się zapisać zmian. Spróbuj ponownie.');
    } finally { lock.current = false; setWorking(false); }
  }
  function createFolders(event: FormEvent) {
    event.preventDefault();
    const list = names.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
    void run(async () => {
      if (!list.length || list.some(name => Array.from(name).length > 100))
        throw Error('Wpisz nazwy folderów, do 100 znaków każda.');
      const {data, error} = await db.from('investment_project_folders')
        .insert(list.map(name => ({investment_id: investment, name}))).select('id,name');
      if (error) throw error;
      setNames(''); await load();
      const first = data?.find(folder => folder.name === list[0]);
      if (first) openFolder(first.id);
      setNotice('Utworzono foldery: ' + list.length + '.');
    });
  }
  function renameFolder(event: FormEvent) {
    event.preventDefault();
    if (!active || !newName?.trim()) return;
    void run(async () => {
      const {error} = await db.from('investment_project_folders').update({name: newName.trim()})
        .eq('investment_id', investment).eq('id', active.id).select('id').single();
      if (error) throw error;
      setNewName(null); await load(); setNotice('Zmieniono nazwę folderu.');
    });
  }
  function removeFolder() {
    if (!active || !window.confirm('Usunąć folder „' + active.name + '”? Jego pliki trafią do sekcji „Bez folderu”.')) return;
    void run(async () => {
      const {error} = await db.from('investment_project_folders').delete()
        .eq('investment_id', investment).eq('id', active.id).select('id').single();
      if (error) throw error;
      openFolder(''); await Promise.all([load(), refresh()]); setNotice('Usunięto folder. Zachowano jego pliki.');
    });
  }
  function moveFiles() {
    if (!destination || !selectedIds.length) return;
    void run(async () => {
      const target = destination === 'root' ? null : destination;
      const query = db.from('documents').update({project_folder_id: target})
        .eq('investment_id', investment).eq('category', 'projekty').is('deleted_at', null).in('id', selectedIds);
      const {data, error} = await (activeId ? query.eq('project_folder_id', activeId) : query.is('project_folder_id', null)).select('id');
      if (error) throw error;
      setChecked([]); setDestination(''); await refresh();
      setNotice('Przeniesiono ' + (data?.length || 0) + ' z ' + selectedIds.length + ' zaznaczonych plików.');
    });
  }

  return <>
    <section className="panel">
      <h2>Foldery projektu</h2>
      <form onSubmit={createFolders}>
        <label>Nazwy nowych folderów<textarea rows={2} value={names} disabled={locked}
          onChange={event => setNames(event.target.value)} placeholder={'Łazienka\nElektryka'}/>
          <small>Wpisz każdą nazwę w osobnym wierszu.</small></label>
        <button disabled={locked || !names.trim()}>Utwórz foldery</button>
      </form>
      {loadError && <p role="alert">Nie udało się wczytać folderów. <button className="secondary" onClick={() => void load()}>Odśwież foldery</button></p>}
      <label>Otwórz folder<select value={activeId} disabled={locked} onChange={event => openFolder(event.target.value)}>
        <option value="">Bez folderu</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select></label>
      {active && (newName === null ? <div className="actions">
        <button type="button" className="secondary" disabled={locked} onClick={() => setNewName(active.name)}>Zmień nazwę folderu</button>
        <button type="button" className="secondary danger" disabled={locked} onClick={removeFolder}>Usuń folder</button>
      </div> : <form onSubmit={renameFolder}>
        <label>Nowa nazwa folderu<input required maxLength={100} value={newName} disabled={locked}
          onChange={event => setNewName(event.target.value)}/></label>
        <div className="actions"><button disabled={locked || !newName.trim()}>Zapisz nazwę</button>
          <button type="button" className="secondary" disabled={locked} onClick={() => setNewName(null)}>Anuluj</button></div>
      </form>)}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
    <section className="panel" key={activeId}>
      <h2>Dodaj pliki projektu</h2><p className="muted">Folder docelowy: <strong>{active?.name || 'Bez folderu'}</strong></p>
      <fieldset style={{border: 0, margin: 0, padding: 0}} disabled={locked}>{uploadForm(activeId)}</fieldset>
    </section>
    <section className="panel">
      <div className="section-head"><h2>{active?.name || 'Bez folderu'}</h2><span className="muted">Liczba plików: {shown.length}</span></div>
      {shown.length > 0 && <div>
        <label className="checkbox-label"><input type="checkbox" disabled={locked} checked={selectedIds.length === shown.length}
          onChange={event => setChecked(event.target.checked ? shown.map(doc => doc.id) : [])}/>Zaznacz wszystkie pliki</label>
        {selectedIds.length > 0 && <div className="actions"><label>Przenieś do<select value={destination} disabled={locked} onChange={e => setDestination(e.target.value)}>
          <option value="">Wybierz folder docelowy</option>{activeId && <option value="root">Bez folderu</option>}
          {folders.filter(folder => folder.id !== activeId).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label><button disabled={locked || !destination} onClick={moveFiles}>Przenieś zaznaczone ({selectedIds.length})</button></div>}
      </div>}
      {shown.map(doc => <div key={doc.id} style={{display:'grid',gridTemplateColumns:'auto minmax(0,1fr)',alignItems:'center',gap:12}}>
        <input type="checkbox" aria-label={'Zaznacz plik ' + doc.title} disabled={locked} checked={checked.includes(doc.id)}
          onChange={event => setChecked(current => event.target.checked ? [...current, doc.id] : current.filter(id => id !== doc.id))}/>
        {renderFile(doc)}
      </div>)}
      {!shown.length && <p className="muted">Ten folder jest pusty.</p>}
    </section>
  </>;
}
