'use strict';
(()=>{
  const zipButton=document.getElementById('download-selected-files');
  if(!zipButton)return;
  const form=document.getElementById('compose-form'),dialog=document.getElementById('compose-dialog');
  const fields=[form.elements.subject,form.elements.text];
  for(const field of fields){field.lang='pl';field.spellcheck=true;}
  const status=document.getElementById('polish-spelling-status'),choices=document.getElementById('polish-spelling-words');
  const check=document.getElementById('polish-spelling-check');
  const cache=new Map();let revision=0,timer;
  function tokens(){
    const found=[];
    for(const field of fields){
      const source=field.value;
      // E-mail addresses, links and quoted replies are not Polish prose.
      const pattern=/^\s*>[^\n]*|https?:\/\/[^\s]+|[\w.%+-]+@[\w.-]+\.[\p{L}]{2,}|[\p{L}\p{M}]+/gimu;
      for(const m of source.matchAll(pattern)){
        const word=m[0];if(!/^\p{L}[\p{L}\p{M}]{1,99}$/u.test(word))continue;
        if(/^(prohouse|prohous)$/iu.test(word)||word.length<7&&word===word.toLocaleUpperCase('pl'))continue;
        found.push({field,word,offset:m.index});
      }
    }
    return found;
  }
  function show(errors){
    choices.replaceChildren();
    for(const hit of errors.slice(0,8)){
      const line=document.createElement('div'),word=document.createElement('button');
      word.type='button';word.className='text-button';word.textContent=hit.word;
      word.title='Zaznacz w wiadomości';
      word.onclick=()=>{hit.field.focus();hit.field.setSelectionRange(hit.offset,hit.offset+hit.word.length);};
      line.append(word);
      const suggestion=cache.get(hit.word)?.suggestions?.[0];
      if(suggestion){
        const replace=document.createElement('button');replace.type='button';replace.className='secondary';
        replace.textContent='Zmień na „'+suggestion+'”';
        replace.onclick=()=>{
          if(hit.field.value.slice(hit.offset,hit.offset+hit.word.length)!==hit.word)return schedule();
          hit.field.setRangeText(suggestion,hit.offset,hit.offset+hit.word.length,'end');
          hit.field.dispatchEvent(new Event('input',{bubbles:true}));hit.field.focus();
        };
        line.append(' ',replace);
      }
      choices.append(line);
    }
  }
  async function assess(stamp,manual){
    if(!dialog.open||stamp!==revision)return;
    const all=tokens(),missing=[...new Set(all.map(t=>t.word))].filter(w=>!cache.has(w));
    if(!all.length){status.textContent=manual?'Wpisz treść lub temat do sprawdzenia.':'';return;}
    try{
      if(manual)status.textContent='Sprawdzanie polskiej pisowni…';
      for(let i=0;i<missing.length;i+=120){
        if(stamp!==revision)return;
        const reply=await api('/spelling/pl',{method:'POST',body:{words:missing.slice(i,i+120)}});
        if(stamp!==revision||!dialog.open)return;
        for(const item of reply.words)cache.set(item.word,item);
      }
      if(stamp!==revision||!dialog.open)return;
      const errors=all.filter(t=>cache.get(t.word)?.ok===false);
      const unique=[...new Map(errors.map(t=>[t.word,t])).values()];
      status.textContent=unique.length?'Sprawdź pisownię. Słowa spoza polskiego słownika: '+unique.length+'.':(manual?'Słownik nie znalazł błędów pisowni.':'');
      show(unique);
    }catch{if(stamp===revision&&dialog.open)status.textContent='Nie udało się sprawdzić polskiej pisowni. Spróbuj ponownie.';}
  }
  function schedule(){
    clearTimeout(timer);const stamp=++revision;status.textContent='';choices.replaceChildren();
    if(dialog.open)timer=setTimeout(()=>assess(stamp,false),1150);
  }
  fields.forEach(f=>f.addEventListener('input',schedule));
  check.onclick=()=>{clearTimeout(timer);void assess(++revision,true);};
  new MutationObserver(()=>{cache.clear();schedule();}).observe(dialog,{attributes:true,attributeFilter:['open']});

  let building=false;
  const prior=renderSelection;
  renderSelection=function(){
    prior();const n=state.selectionAll?state.selectionCount:state.selectedIds.size;
    zipButton.disabled=!n||building||!!state.bulkBusy;
  };
  const progress=document.getElementById('attachment-export-status');
  function say(message){progress.replaceChildren(document.createTextNode(message));}
  zipButton.onclick=()=>action(async()=>{
    if(building)return;
    const ctx=mailContext(),selection=state.selectionAll,actor=state.user?.id;
    const sameContext=()=>state.user?.id===actor&&state.account===ctx.account&&state.view===ctx.folder;
    const selected=selection?{selection}:{uids:[...state.selectedIds]};
    building=true;renderSelection();say('Przygotowywanie plików…');
    try{
      const {id}=await api('/attachment-exports',{method:'POST',body:{...ctx,...selected}});
      const endpoint='/attachment-exports/'+encodeURIComponent(id);
      const query=new URLSearchParams({account:ctx.account,folder:ctx.folder}).toString();
      while(state.user?.id===actor){
        const job=await api(endpoint+'?'+query);
        if(job.state==='error')throw Error(job.error);
        if(job.state==='empty'){say(sameContext()?'Zaznaczone wiadomości nie zawierają załączników.':'');return;}
        if(job.state==='ready'){
          if(state.account!==ctx.account||state.view!==ctx.folder){say('');return;}
          const a=document.createElement('a');a.href='/api'+endpoint+'/download?'+query;a.download='Zalaczniki-ProHouse.zip';
          a.textContent='Pobierz ZIP ponownie';say('Liczba plików w ZIP: '+job.count+'. ');progress.append(a);a.click();return;
        }
        if(state.account===ctx.account&&state.view===ctx.folder)say(job.total?'Przygotowywanie plików: '+job.done+' z '+job.total+' wiadomości.':'Przygotowywanie plików…');
        await new Promise(r=>setTimeout(r,1500));
      }
    }catch(e){say(sameContext()?e.message:'');}
    finally{building=false;renderSelection();}
  });
  renderSelection();
})();
