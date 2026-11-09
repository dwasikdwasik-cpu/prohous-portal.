'use client';
import {useEffect, useRef, useState} from 'react';
import {db} from '../lib/supabase';
import {validateCamera} from '../lib/cameras.mjs';

export type Camera = {id:string; investment_id:string; name:string; playback_type:'hls'|'embed'; playback_url:string|null; client_visible:boolean};
type Props = {investmentId:string; investmentName:string; cameras:Camera[]; canManage:boolean; onSaved:()=>Promise<void>};

export default function CameraPanel({investmentId, investmentName, cameras, canManage, onSaved}:Props) {
 const [editing, setEditing] = useState<Camera|null>(null);
 const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
 const [playing, setPlaying] = useState<string|null>(null);
 const [formVersion, setFormVersion] = useState(0);
 async function perform(operation:()=>Promise<void>) {
  setBusy(true); setMessage('');
  try { await operation(); } catch { setMessage('Nie udało się zapisać zmiany. Sprawdź połączenie i uprawnienia, a następnie spróbuj ponownie.'); }
  finally { setBusy(false); }
 }
 async function save(event:React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  let values;
  try { values = validateCamera({name:form.get('name'), playback_type:form.get('playback_type'), playback_url:form.get('playback_url'), client_visible:form.get('client_visible')==='on'}, location.origin); }
  catch (error) { setMessage(error instanceof Error ? error.message : 'Sprawdź dane kamery.'); return; }
  await perform(async()=>{
   const result = editing
    ? await db.from('investment_cameras').update(values).eq('id', editing.id).eq('investment_id', investmentId).select('id').single()
    : await db.from('investment_cameras').insert({...values, investment_id:investmentId}).select('id').single();
   if (result.error) throw result.error;
   setPlaying(null); setEditing(null); setFormVersion(value=>value+1);
   await onSaved(); setMessage('Zapisano kamerę.');
  });
 }
 async function toggle(camera:Camera) {
  if (!camera.client_visible && !camera.playback_url) { setMessage('Najpierw edytuj kamerę i uzupełnij adres podglądu HTTPS.'); return; }
  await perform(async()=>{
   const {error} = await db.from('investment_cameras').update({client_visible:!camera.client_visible}).eq('id',camera.id).eq('investment_id',investmentId).select('id').single();
   if (error) throw error;
   setPlaying(null); await onSaved(); setMessage(camera.client_visible?'Cofnięto dostęp klienta do kamery w portalu.':'Udostępniono kamerę klientowi tej inwestycji.');
  });
 }
 async function remove(camera:Camera) {
  if (!window.confirm(`Usunąć kamerę „${camera.name}” z inwestycji? Zniknie również z panelu klienta.`)) return;
  await perform(async()=>{
   const {error} = await db.from('investment_cameras').delete().eq('id',camera.id).eq('investment_id',investmentId).select('id').single();
   if (error) throw error;
   setPlaying(null); if (editing?.id===camera.id) {setEditing(null); setFormVersion(value=>value+1);}
   await onSaved(); setMessage('Usunięto kamerę z portalu.');
  });
 }
 return <section className="panel camera-panel">
  <h2>Kamera online</h2><p className="muted">Inwestycja: {investmentName}. Podgląd uruchomisz przyciskiem poniżej.</p>
  {message&&<p role="status" className="notice">{message}</p>}
  {cameras.length===0&&<p className="empty">Nie udostępniono jeszcze żadnej kamery.</p>}
  <div className="camera-list">{cameras.map(camera=><article className="camera-card" key={camera.id}>
   <div className="section-head"><h3>{camera.name}</h3>{canManage&&<span className="pill">{camera.client_visible?'Widoczna dla klienta':'Ukryta przed klientem'}</span>}</div>
   <div className="actions">
    <button type="button" disabled={!camera.playback_url||busy} onClick={()=>setPlaying(playing===camera.id?null:camera.id)}>{playing===camera.id?'Zatrzymaj podgląd':'Uruchom podgląd'}</button>
    {canManage&&<><button type="button" className="secondary" disabled={busy} onClick={()=>{setEditing(camera); setMessage('');}}>Edytuj kamerę</button><button type="button" className="secondary" disabled={busy} onClick={()=>toggle(camera)}>{camera.client_visible?'Cofnij udostępnienie':'Udostępnij klientowi'}</button><button type="button" className="secondary danger" disabled={busy} onClick={()=>remove(camera)}>Usuń kamerę</button></>}
   </div>
   {!camera.playback_url&&canManage&&<p className="muted">Konfiguracja w przygotowaniu — uzupełnij adres transmisji.</p>}
   {playing===camera.id&&camera.playback_url&&<CameraPlayer key={camera.id+camera.playback_type+camera.playback_url} camera={camera}/>}
  </article>)}</div>
  {canManage&&<details className="camera-configuration" open={editing!==null}>
   <summary>{editing?'Edytuj konfigurację kamery':'Dodaj kamerę do tej inwestycji'}</summary>
   <form key={investmentId+':'+(editing?.id||'new')+':'+formVersion} onSubmit={save}>
    <label>Nazwa kamery<input name="name" required maxLength={120} defaultValue={editing?.name||''} placeholder="Np. Budowa — salon" disabled={busy}/></label>
    <label>Rodzaj podglądu<select name="playback_type" defaultValue={editing?.playback_type||'hls'} disabled={busy}><option value="hls">Transmisja HLS (.m3u8)</option><option value="embed">Odtwarzacz internetowy (osadzanie)</option></select></label>
    <label>Adres podglądu HTTPS<input name="playback_url" type="url" maxLength={2048} defaultValue={editing?.playback_url||''} placeholder="https://transmisja.example/kamera/index.m3u8" disabled={busy}/></label>
    <p className="muted">Możesz zapisać kamerę bez adresu jako ukrytą. Adres RTSP z Tapo trzeba wcześniej przekształcić w transmisję HTTPS. Dla HLS usługa musi zezwalać na odtwarzanie z portalu (CORS); odtwarzacz internetowy musi zezwalać na osadzanie.</p>
    <label className="checkbox-label"><input name="client_visible" type="checkbox" defaultChecked={editing?.client_visible||false} disabled={busy}/>Udostępnij podgląd klientowi tej inwestycji</label>
    <p className="muted">Nie wpisuj hasła kamery do adresu. Adres podglądu otrzyma uprawniony klient; ochrona samego linku i wygasanie dostępu zależą również od usługi transmisji.</p>
    <div className="actions"><button disabled={busy}>{busy?'Zapisywanie…':editing?'Zapisz konfigurację':'Dodaj kamerę'}</button>{editing&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setEditing(null); setFormVersion(value=>value+1);}}>Anuluj edycję</button>}</div>
   </form>
  </details>}
 </section>;
}

function CameraPlayer({camera}:{camera:Camera}) {
 const video = useRef<HTMLVideoElement>(null);
 const [error, setError] = useState(''), [status, setStatus] = useState('Łączenie z transmisją…'), [retry, setRetry] = useState(0);
 useEffect(()=>{
  if (camera.playback_type!=='hls'||!video.current||!camera.playback_url) return;
  const element=video.current; let active=true, destroy:(()=>void)|undefined;
  setError(''); setStatus('Łączenie z transmisją…');
  const fail=()=>{if(active){setError('Nie można odtworzyć transmisji. Sprawdź połączenie kamery z internetem i konfigurację adresu podglądu.');setStatus('')}};
  const onPlaying=()=>{if(active){setStatus('Odtwarzanie transmisji');setError('')}};
  element.addEventListener('error',fail); element.addEventListener('playing',onPlaying);
  const timeout=window.setTimeout(()=>{if(active&&element.readyState<2)fail()},25000);
  if (element.canPlayType('application/vnd.apple.mpegurl')) {element.src=camera.playback_url; void element.play().catch(()=>{if(active)setStatus('Naciśnij odtwarzanie na obrazie kamery.');});}
  else void import('hls.js').then(({default:Hls})=>{
   if(!active)return;
   if(!Hls.isSupported()){fail();return;}
   const hls=new Hls({maxBufferLength:15,backBufferLength:0}); destroy=()=>hls.destroy();
   hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)fail()});
   hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(active)void element.play().catch(()=>setStatus('Naciśnij odtwarzanie na obrazie kamery.'))});
   hls.loadSource(camera.playback_url!); hls.attachMedia(element);
  }).catch(fail);
  return()=>{active=false;window.clearTimeout(timeout);element.removeEventListener('error',fail);element.removeEventListener('playing',onPlaying);destroy?.();element.pause();element.removeAttribute('src');element.load()};
 },[camera.playback_type,camera.playback_url,retry]);
 if(camera.playback_type==='embed')return <div className="camera-player"><iframe src={camera.playback_url!} title={'Podgląd kamery: '+camera.name} sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen" allowFullScreen/><p className="muted">Odtwarzacz dostawcy transmisji. Jeśli podgląd się nie pojawia, skontaktuj się z opiekunem inwestycji.</p></div>;
 return <div className="camera-player"><video ref={video} controls playsInline muted aria-label={'Podgląd kamery: '+camera.name}/>{status&&!error&&<p role="status" className="muted">{status}</p>}{error&&<div role="alert"><p>{error}</p><button className="secondary" type="button" onClick={()=>setRetry(value=>value+1)}>Ponów połączenie</button></div>}</div>;
}
