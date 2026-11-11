const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Exchange a platform assertion for a short-lived, read-only Drive token. */
export async function federatedDriveToken({oidcToken, audience, serviceAccountEmail,metadataWrite=false}, request = fetch) {
  // Endpoints are fixed. Configuration cannot redirect a platform token to another server.
  if (!oidcToken || !/^\/\/iam\.googleapis\.com\/projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(audience || '') || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail || '')) throw Error('503');
  const exchange = await request('https://sts.googleapis.com/v1/token', {
    method:'POST', cache:'no-store', signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      audience, grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',
      requested_token_type:'urn:ietf:params:oauth:token-type:access_token',
      subject_token_type:'urn:ietf:params:oauth:token-type:jwt',
      subject_token:oidcToken, scope:'https://www.googleapis.com/auth/cloud-platform'
    })
  });
  if (!exchange.ok) throw Error('502');
  const identity = await exchange.json();
  if (typeof identity.access_token !== 'string' || !identity.access_token) throw Error('502');
  const result = await request('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+encodeURIComponent(serviceAccountEmail)+':generateAccessToken', {
    method:'POST', cache:'no-store', signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+identity.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({scope:[metadataWrite?'https://www.googleapis.com/auth/drive.metadata':DRIVE_SCOPE],lifetime:'3600s'})
  });
  if (!result.ok) throw Error('502');
  const token = await result.json();
  const expires = Date.parse(token.expireTime);
  if (typeof token.accessToken !== 'string' || !token.accessToken || !Number.isFinite(expires) || expires <= Date.now()+60000) throw Error('502');
  return {token:token.accessToken, expires};
}
