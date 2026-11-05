/** Authorization and download policy. Dependencies are request-scoped. */
export async function serveDocument(request, id, services) {
  const json = (error, status) => Response.json({error}, {status, headers:{'Cache-Control':'private, no-store'}});
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json('Nie znaleziono dokumentu.',404);
  const match = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i);
  if (!match) return json('Zaloguj się, aby pobrać plik.',401);
  try {
    const access = await services.authorize(match[1],id);
    if (!access.user) return json('Sesja wygasła. Zaloguj się ponownie.',401);
    // RLS excludes other clients, pending accounts, and unpublished client documents.
    if (!access.document || !access.folderId) return json('Nie znaleziono dokumentu lub folderu inwestycji.',404);
    const file = await services.metadata(access.document.drive_file_id);
    if (file.trashed || !file.parents?.includes(access.folderId) || file.mimeType === 'application/vnd.google-apps.folder') return json('Plik nie należy do folderu inwestycji.',404);
    if (Number(file.size || 0) > 25 * 1024 * 1024) return json('Plik przekracza limit pobierania 25 MB.',413);
    const content = await services.content(access.document.drive_file_id,file.mimeType);
    if (content.bytes.byteLength > 25 * 1024 * 1024) return json('Plik przekracza limit pobierania 25 MB.',413);
    // Fail closed if the required audit record cannot be saved.
    await services.audit(access.user.id,id);
    const name=(file.name || access.document.title || 'dokument').replace(/[\r\n\x00-\x1f]/g,'')+(content.exported?'.pdf':'');
    return new Response(content.bytes,{headers:{
      'Content-Type':content.exported?'application/pdf':'application/octet-stream',
      'Content-Disposition':"attachment; filename=\"dokument\"; filename*=UTF-8''"+encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),
      'X-Download-Name':encodeURIComponent(name),
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox"
    }});
  } catch {
    return json('Nie udało się pobrać dokumentu. Sprawdź konfigurację i dostęp Google Drive.',503);
  }
}
