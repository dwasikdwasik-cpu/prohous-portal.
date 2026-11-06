'use client';
import {useEffect,useRef,useState} from 'react';
type InstallPrompt=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export default function InstallApp(){
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null),[installed,setInstalled]=useState(false),[busy,setBusy]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const display=window.matchMedia('(display-mode: standalone)');
  const sync=()=>setInstalled(display.matches||Boolean((navigator as Navigator & {standalone?:boolean}).standalone));
  const onPrompt=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt)};
  const onInstalled=()=>{setInstalled(true);setPrompt(null);dialog.current?.close()};
  sync();display.addEventListener('change',sync);window.addEventListener('beforeinstallprompt',onPrompt);window.addEventListener('appinstalled',onInstalled);
  if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
  return()=>{display.removeEventListener('change',sync);window.removeEventListener('beforeinstallprompt',onPrompt);window.removeEventListener('appinstalled',onInstalled)};
 },[]);
 async function install(){
  if(!prompt){dialog.current?.showModal();return}
  setBusy(true);
  try{await prompt.prompt();await prompt.userChoice;setPrompt(null)}catch{dialog.current?.showModal()}finally{setBusy(false)}
 }
 if(installed)return null;
 return <><button className="install-app secondary" disabled={busy} onClick={install}>{busy?'Otwieranie…':'Zainstaluj aplikację'}</button><dialog className="install-dialog" ref={dialog} aria-labelledby="install-title"><h2 id="install-title">Prohouse Sp. z o.o. na telefonie</h2><p>Dodaj aplikację z tej strony do ekranu głównego telefonu.</p><h3>iPhone / iPad</h3><p>Otwórz portal w Safari. Wybierz Udostępnij → Do ekranu początkowego → Dodaj. Jeśli pojawi się opcja „Otwieraj jako aplikację”, włącz ją.</p><h3>Android</h3><p>Otwórz portal w Chrome. W menu ⋮ wybierz „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.</p><p className="muted">Logujesz się na dotychczasowe konto. Projekty, zdjęcia i rozliczenia wymagają połączenia z internetem.</p><button onClick={()=>dialog.current?.close()}>Rozumiem</button></dialog></>;
}
