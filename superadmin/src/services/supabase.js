import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://txdrsrswzkcarpjywniq.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4ZHJzcnN3emtjYXJwanl3bmlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NDYxMDUsImV4cCI6MjEwNzAyMjEwNX0.9jbNMN-Y-BlfVYSUy8oQg0g1l7jBE_SrsLlronLTSec'

// This key bypasses RLS. Never use this in normal client apps. We use it here ONLY for the private superadmin dashboard.
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

// To prevent "Multiple GoTrueClient instances" warnings during Vite HMR reloads
export const supabase = globalThis.__supabaseClient || createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'sb-superadmin-auth-token',
    persistSession: true,
    autoRefreshToken: true
  }
})

if (import.meta.env.DEV) {
  globalThis.__supabaseClient = supabase
}

export const supabaseAdmin = globalThis.__supabaseAdmin || (serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
    storage: {
      getItem: () => null,
      setItem: () => { },
      removeItem: () => { }
    }
  }
}) : null)

if (import.meta.env.DEV) {
  globalThis.__supabaseAdmin = supabaseAdmin
}
