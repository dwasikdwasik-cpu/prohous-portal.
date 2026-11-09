/** Validate a browser playback address. Camera credentials belong on the gateway. */
export function validateCamera(values, portalOrigin = '') {
 const name = String(values.name || '').trim();
 const playbackType = String(values.playback_type || 'hls');
 const raw = String(values.playback_url || '').trim();
 const clientVisible = values.client_visible === true;
 if (!name || name.length > 120) throw Error('Podaj nazwę kamery (do 120 znaków).');
 if (!['hls', 'embed'].includes(playbackType)) throw Error('Wybierz rodzaj podglądu.');
 if (!raw && clientVisible) throw Error('Uzupełnij adres podglądu przed udostępnieniem klientowi.');
 if (raw) {
  let url;
  try { url = new URL(raw); } catch { throw Error('Podaj pełny adres HTTPS podglądu.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || /\s/.test(raw) || raw.length > 2048)
   throw Error('Podaj adres HTTPS bez loginu, hasła i fragmentu #. Adres RTSP wymaga bramki transmisji.');
  if (portalOrigin && url.origin === portalOrigin) throw Error('Podaj adres usługi transmisji, a nie adres portalu klienta.');
  if (playbackType === 'hls' && !url.pathname.toLowerCase().endsWith('.m3u8'))
   throw Error('Podgląd HLS wymaga adresu listy odtwarzania kończącego się na .m3u8.');
 }
 return {name, playback_type: playbackType, playback_url: raw || null, client_visible: clientVisible};
}
