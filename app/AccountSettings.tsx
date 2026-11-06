'use client';
import {useState} from 'react';
import {db} from '../lib/supabase';

export default function AccountSettings({email}:{email:string}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[needsCode,setNeedsCode]=useState(false);
 async function changeEmail(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,values=new FormData(form),next=String(values.get('email')||'').trim();
  if(next.toLowerCase()===email.toLowerCase()){setMessage('Wpisz nowy adres e-mail.');return}
  setBusy(true);setMessage('');
  try{const {error}=await db.auth.updateUser({email:next},{emailRedirectTo:location.origin});if(error)throw error;form.reset();setMessage('Sprawdź pocztę na dotychczasowym i nowym adresie. Wykonaj wymagane potwierdzenia. Do czasu zakończenia zmiany loguj się dotychczasowym adresem.');}
  catch(error){setMessage(error instanceof Error?error.message:'Nie udało się zmienić adresu e-mail.')}
  finally{setBusy(false)}
 }
 async function sendCode(){
  setBusy(true);setMessage('');
  try{const {error}=await db.auth.reauthenticate();if(error)throw error;setNeedsCode(true);setMessage('Wysłano kod potwierdzający na Twój adres e-mail. Wpisz go poniżej i ponownie zapisz nowe hasło.');}
  catch(error){setMessage(error instanceof Error?error.message:'Nie udało się wysłać kodu.')}
  finally{setBusy(false)}
 }
 async function changePassword(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,values=new FormData(form),password=String(values.get('password')||'');
  if(password!==values.get('confirm')){setMessage('Nowe hasła muszą być identyczne.');return}
  if(password.length<12){setMessage('Nowe hasło musi mieć co najmniej 12 znaków.');return}
  setBusy(true);setMessage('');
  try{
   const {error}=await db.auth.updateUser({password,current_password:String(values.get('current_password')||''),...(needsCode?{nonce:String(values.get('nonce')||'').trim()}:{})});
   if(error){if(error.code==='reauthentication_needed'||error.code==='reauthentication_not_valid')setNeedsCode(true);throw error}
   form.reset();setNeedsCode(false);setMessage('Hasło zostało zmienione. Przy kolejnym logowaniu użyj nowego hasła.');
  }catch(error){setMessage(error instanceof Error?error.message:'Nie udało się zmienić hasła.')}
  finally{setBusy(false)}
 }
 return <>
  {message&&<p role="status" className="notice">{message}</p>}
  <div className="two-col">
   <section className="panel"><h2>Zmień adres e-mail</h2><p className="muted">Aktualny login: <b>{email}</b></p><p className="muted">Zmiana wymaga potwierdzenia wiadomościami e-mail. Przypisane inwestycje pozostaną na Twoim koncie.</p>
    <form onSubmit={changeEmail}><label>Nowy adres e-mail<input type="email" name="email" autoComplete="email" required disabled={busy}/></label><button disabled={busy}>Zmień e-mail</button></form>
   </section>
   <section className="panel"><h2>Zmień hasło</h2>
    <form onSubmit={changePassword}><label>Obecne hasło<input type="password" name="current_password" autoComplete="current-password" required disabled={busy}/></label><label>Nowe hasło<input type="password" name="password" autoComplete="new-password" minLength={12} required disabled={busy}/><small>Minimum 12 znaków.</small></label><label>Powtórz nowe hasło<input type="password" name="confirm" autoComplete="new-password" minLength={12} required disabled={busy}/></label>
    {needsCode&&<><p className="muted">Potwierdź zmianę kodem z e-maila.</p><button className="secondary" type="button" disabled={busy} onClick={sendCode}>Wyślij kod potwierdzający</button><label>Kod z e-maila<input name="nonce" autoComplete="one-time-code" required disabled={busy}/></label></>}
    <button disabled={busy}>Zapisz nowe hasło</button></form>
   </section>
  </div>
 </>;
}
