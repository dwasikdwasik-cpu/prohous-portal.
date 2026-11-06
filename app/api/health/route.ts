export async function GET(){
 const federation=Boolean(process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE&&process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
 const key=Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL&&process.env.GOOGLE_PRIVATE_KEY));
 // Configuration presence only; this is not an end-to-end Drive connectivity check.
 return Response.json({configured:Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),driveConfigured:federation||key,driveAuthMode:federation?'federation':key?'service-account-key':'unconfigured'},{headers:{'Cache-Control':'no-store'}})
}
