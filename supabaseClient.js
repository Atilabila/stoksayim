import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-project')) {
  console.error(
    'Supabase ayarları eksik. Proje kökünde .env.local dosyasına VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY ekleyin (yeni proje için Dashboard > Settings > API).'
  );
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
