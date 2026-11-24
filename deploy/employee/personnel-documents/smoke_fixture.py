"""Generate a short-lived synthetic upload for browser testing with the normal admin session."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import secrets
import tempfile
import uuid


def test_pdf():
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    ]
    for page, stream in ((1,4),(2,6)):
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 600] /Resources << /Font << /F1 7 0 R >> >> /Contents {stream} 0 R >>'.encode())
        text = f'BT /F1 24 Tf 32 480 Td (ProHouse - TEST {page}/2) Tj ET'.encode()
        objects.append(f'<< /Length {len(text)} >>\nstream\n'.encode()+text+b'\nendstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    data=bytearray(b'%PDF-1.4\n');offset=[0]
    for n,obj in enumerate(objects,1):
        offset.append(len(data))
        data.extend(f'{n} 0 obj\n'.encode()+obj+b'\nendobj\n')
    xref=len(data)
    data.extend(f'xref\n0 {len(offset)}\n0000000000 65535 f \n'.encode())
    for n in offset[1:]:data.extend(f'{n:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(offset)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(data)


PAGE = """<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Test kartoteki</title><main><h1>Test kartoteki pracownika</h1>
<form><label>Numer pracownika <input name="number" required></label>
<button>Dodaj próbny PDF widoczny tylko dla administratora</button></form>
<p role="status"></p></main>
<script>
const form=document.querySelector('form'), statusLine=document.querySelector('[role="status"]');
form.onsubmit=async event=>{
 event.preventDefault();form.querySelector('button').disabled=true;
 try{
  const response=await fetch('/api/attendance',{cache:'no-store'});
  const info=await response.json();
  if(!response.ok||!info.admin)throw Error('Zaloguj się jako administrator.');
  const row=info.employees.find(e=>String(e.number)===form.elements.number.value.trim());
  if(!row)throw Error('Brak pracownika o podanym numerze.');
  const payload=Object.assign(PAYLOAD,{employee_id:row.id,document_date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw'}).format(new Date())});
  const result=await fetch('/api/personnel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const body=await result.json();if(!result.ok||body.error)throw Error(body.error||'Błąd zapisu.');
  statusLine.textContent='Dodano: '+payload.title;
 }catch(e){statusLine.textContent=e.message;form.querySelector('button').disabled=false;}
};
</script></html>"""


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['create','clean'])
    args=parser.parse_args()
    public=Path('/opt/prohouse-employee/public')
    marker=Path.cwd()/'personnel-fixture-path'
    if args.action=='clean':
        name=marker.read_text().strip()
        if not name.startswith('qa-personnel-') or Path(name).name!=name:raise ValueError('Nieoczekiwany plik testowy.')
        (public/name).unlink(missing_ok=True);marker.unlink()
        return
    if marker.exists():raise ValueError('Usuń poprzednią stronę testową poleceniem clean.')
    token=secrets.token_hex(5)
    payload={'id':str(uuid.uuid4()),'action':'document_upload','title':'TEST KARTOTEKI '+token,'filename':'Test_kartoteki_ProHouse.pdf',
             'visible':False,'category':'other','note':'Próba techniczna. Plik syntetyczny.','base64':base64.b64encode(test_pdf()).decode()}
    with tempfile.NamedTemporaryFile(mode='w',dir=public,prefix='qa-personnel-',suffix='.html',delete=False) as page:
        page.write(PAGE.replace('PAYLOAD',json.dumps(payload)))
    path=Path(page.name);marker.write_text(path.name);path.chmod(0o644)
    print('https://praca.prohous.pl/'+path.name)
    print(payload['title'],'SHA-256',hashlib.sha256(test_pdf()).hexdigest())


if __name__=='__main__':main()
