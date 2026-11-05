import {createClient,type SupabaseClient} from '@supabase/supabase-js';
export const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
// A lazy client lets the configuration screen build without service credentials.
let instance: SupabaseClient | undefined;
export const db = new Proxy({} as SupabaseClient, {
  get(_target, key) {
    if (!configured) throw new Error('Brak konfiguracji Supabase.');
    instance ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    return Reflect.get(instance, key);
  }
});
