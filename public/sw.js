/* No offline cache: customer files, auth sessions and balances remain network-only. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode!=='navigate'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="pl"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Prohouse Sp. z o.o. — brak połączenia</title><body style="font:18px system-ui;margin:48px auto;padding:24px;max-width:560px;color:#193555;background:#eef7ff"><h1>Brak połączenia z internetem</h1><p>Połącz telefon z internetem, aby otworzyć portal Prohouse Sp. z o.o. i zobaczyć aktualne dane inwestycji.</p><a href="/" style="display:inline-block;background:#ffb56b;color:#193555;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">Spróbuj ponownie</a></body></html>',{status:503,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}})));
});
