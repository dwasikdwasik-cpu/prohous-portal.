from pathlib import Path

HERE = Path(__file__).resolve().parent

def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Nierozpoznana wersja przy: ' + old[:75])
    return text.replace(old, new, 1)

def frontend(text):
    start = text.index('function ProhousePersonnel(')
    end = text.index('\n}', text.index('preview&&h(', start)) + 2
    panel = text[start:end]
    helpers = (HERE / 'dialog.js').read_text()
    panel = once(panel, "async function changeState(e){"+panel.split("async function changeState(e){",1)[1].split('\n',1)[0], """async function changeState(e){
  e.preventDefault();
  if(!admin||busy||!pending)return;
  const x=pending.doc;
  const messages={document_archive:'Dokument przeniesiono do archiwum.',document_restore:'Przywrócono dokument.',document_delete:'Dokument został trwale usunięty.'};
  if(await execute({action:pending.op,id:x.id},messages[pending.op])){
   setPending(null);
   if(preview?.id===x.id)setPreview(null);
  }
 }
 function confirmAction(doc,op){setError('');setNotice('');setPending({doc,op});}
 function closeAction(){setError('');setPending(null);}""")
    panel = once(panel, "onClick:()=>setPending(x)},x.state==='archived'?'Przywróć':'Archiwizuj')",
                 """onClick:()=>confirmAction(x,x.state==='archived'?'document_restore':'document_archive')},x.state==='archived'?'Przywróć':'Archiwizuj'),
     admin&&h('button',{type:'button',className:'secondary phDelete',disabled:busy,onClick:()=>confirmAction(x,'document_delete')},'Usuń bezpowrotnie')""")
    panel = once(panel, "if(!r.ok||b.error)throw Error", "if(!r.ok||b.error||(payload.action==='document_delete'&&b.ok!==true))throw Error")
    k = panel.index("  pending&&h('form'")
    panel = panel[:k] + """  pending&&h(PersonnelDialog,{
   title:pending.op==='document_delete'?'Usunąć dokument bezpowrotnie?':pending.op==='document_restore'?'Przywrócić dokument?':'Przenieść dokument do archiwum?',
   onClose:closeAction,busy},
   h('p',null,h('strong',null,pending.doc.title)),h('p',null,pending.doc.filename),
   h('p',null,employees.find(e=>e.id===pending.doc.employee_id)?.name||''),
   h('p',null,pending.op==='document_delete'?'Usuniesz plik i wpis w kartotece. Tej operacji nie można cofnąć.':pending.op==='document_archive'?'Dokument będzie dostępny w archiwum administratora. Pracownik straci do niego dostęp.':pending.doc.visible?'Pracownik ponownie zobaczy dokument.':'Dokument wróci do listy aktywnych, widoczny wyłącznie dla administratora.'),
   error&&h('p',{role:'alert'},error),
   h('form',{onSubmit:changeState,className:'phDocumentControls'},
    h('button',{type:'button',className:'secondary',autoFocus:true,disabled:busy,onClick:closeAction},'Anuluj'),
    h('button',{type:'submit',className:pending.op==='document_delete'?'primary phDeleteConfirm':'primary',disabled:busy},busy?'Zapisywanie…':pending.op==='document_delete'?'Usuń bezpowrotnie':pending.op==='document_restore'?'Przywróć':'Archiwizuj'))),
  preview&&h(PersonnelFilePreview,{key:preview.id,file:preview,url:fileURL(preview),onClose:()=>setPreview(null)})
 );
}"""
    panel = panel.replace('PDF i zdjęcia mają podgląd w aplikacji; pliki Office można pobrać.', 'PDF, zdjęcia i TXT mają podgląd w aplikacji. Pliki Office można pobrać.')
    return text[:start] + helpers + '\n' + panel + text[end:]

def backend(proxy, edge):
    actions = "'document_upload','document_archive','document_restore']"
    proxy = once(proxy, actions, actions[:-1]+",'document_delete']")
    edge = once(edge, actions, actions[:-1]+",'document_delete']")
    edge = once(edge, '/rest/v1/rpc/prohouse_personnel_api', '/rest/v1/rpc/prohouse_personnel_files_api')
    hook = '  const data=await rpc({action:body.action,id:body.id,session},actor);'
    edge = once(edge, hook, (HERE/'delete.ts').read_text() + hook)
    return proxy, edge
