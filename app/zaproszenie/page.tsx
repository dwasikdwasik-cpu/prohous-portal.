'use client';
import {FormEvent,useEffect,useState} from 'react';
import {db} from '../../lib/supabase';

type Invite={email:string,registered:boolean};
export default function Invitation() {
 const [token,setToken]=useState(''),[invite,setInvite]=useState<Invite|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function request(action:string,token:string,password?:string,bearer?:string){
   const res=await fetch('/api/client-invitations',{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify({action,token,password})});
   const body=await res.json(); if(!res.ok)throw Error(body.error); return body;
 }
 useEffect(()=>{const code=location.hash.slice(1);setToken(code);
   request('check',code).then(setInvite).catch(e=>setMessage(e.message));},[]);
 async function submit(e:FormEvent<HTMLFormElement>){
   e.preventDefault(); if(!invite||busy)return;
   const form=new FormData(e.currentTarget),password=String(form.get('password'));
   if(!invite.registered&&form.get('repeat')!==password){setMessage('Podane hasła różnią się.');return}
   setBusy(true);setMessage('');
   try{
     if(!invite.registered){await request('register',token,password);setInvite({...invite,registered:true})}
     const {data,error}=await db.auth.signInWithPassword({email:invite.email,password});
     if(error||!data.session)throw Error('Nie udało się zalogować. Sprawdź hasło i potwierdzenie adresu e-mail.');
     await request('accept',token,undefined,data.session.access_token);
     location.replace('/');
   }catch(e){setMessage(e instanceof Error?e.message:'Nie udało się aktywować dostępu.');try{setInvite(await request('check',token))}catch{}}
   finally{setBusy(false)}
 }
 return <main className="center"><section className="auth-card"><p>ProHouse · Panel Klienta</p><h1>Zaproszenie do panelu</h1>
 {invite?<form onSubmit={submit}><p>{invite.registered?'Zaloguj się dotychczasowym hasłem, aby otworzyć udostępniony panel.':'Ustaw własne hasło, aby otworzyć przygotowany dla Ciebie panel.'}</p>
 <label>Adres e-mail<input type="email" autoComplete="username" value={invite.email} readOnly/></label>
 <label>{invite.registered?'Hasło':'Nowe hasło (minimum 12 znaków)'}<input name="password" type="password" required minLength={invite.registered?1:12} maxLength={invite.registered?undefined:128} autoComplete={invite.registered?'current-password':'new-password'}/></label>
 {!invite.registered&&<label>Powtórz nowe hasło<input name="repeat" type="password" required autoComplete="new-password"/></label>}
 <button disabled={busy}>{busy?'Proszę czekać…':'Otwórz mój panel'}</button>
 {invite.registered&&<a href="/" target="_blank" rel="noopener noreferrer">Odzyskaj hasło w panelu klienta</a>}</form>:!message&&<p>Sprawdzamy zaproszenie…</p>}
 {message&&<p role="alert">{message}</p>}<p><a href="/">Przejdź do logowania</a></p></section></main>
}
