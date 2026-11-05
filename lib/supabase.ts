import {createClient} from '@supabase/supabase-js';
export const configured=Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||'https://unconfigured.supabase.co',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'unconfigured');
