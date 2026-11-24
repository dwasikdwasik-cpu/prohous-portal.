'use client';
import {useState} from 'react';
import {db} from '../lib/supabase';

export default function EmptyDocumentTrash({id,name,disabled,onDone}:{id:string,name:string,disabled:boolean,onDone:()=>Promise<void>}) {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function empty(){
  if(busy||disabled)return;
  setBusy(true);setMessage('');
  try{
   const items:{id:string,title:string,deleted_at:string}[]=[];let cursor='';
   do{
    let query=db.from('documents').select('id,title,deleted_at').eq('investment_id',id).not('deleted_at','is',null).order('id').limit(300);
    if(cursor)query=query.gt('id',cursor);
    const {data,error}=await query;if(error)throw error;
    if(!data.length)break;
    items.push(...data);cursor=data[data.length-1].id;
   }while(true);
   if(!items.length){setMessage('Kosz tej inwestycji jest pusty.');return}
   if(!window.confirm('Opróżnić kosz inwestycji „'+name+'”? Liczba plików do bezpowrotnego usunięcia: '+items.length+'. Tej operacji nie można cofnąć.'))return;
   let done=0;const failed:string[]=[];
   for(const item of items){
    try{
     const locked=await db.rpc('lock_panel_trash_item',{inv:id,doc:item.id,removed:item.deleted_at});
     if(locked.error)throw locked.error;
     const result=await db.functions.invoke('portal-permanent-removal',{body:{action:'document',id:item.id,confirmation:locked.data}});
     if(result.error)throw result.error;
     done++;
    }catch{failed.push(item.title)}
    setMessage('Usunięto '+done+' z '+items.length+'.');
   }
   setMessage('Usunięto '+done+' z '+items.length+' plików.'+(failed.length?' Pominięte lub wymagające ponowienia: '+failed.join(', '):''));
   await onDone();
  }catch{setMessage('Nie udało się odświeżyć kosza. Sprawdź jego zawartość przed ponowieniem.')}
  finally{setBusy(false)}
 }
 return <div><button type="button" className="secondary danger" disabled={disabled||busy} onClick={empty}>Usuń wszystkie pliki z kosza</button>
 {message&&<p role="status">{message}</p>}</div>
}
