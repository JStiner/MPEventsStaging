(function () {
  const SUPABASE_URL = 'https://ugexckokribehnxfkjxu.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZXhja29rcmliZWhueGZranh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MTcxODUsImV4cCI6MjA5MDQ5MzE4NX0.t3oxhibL6e-fjX_qeFx3KW-1LwLSB9B2N-hVVO4fOKs';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('Supabase browser client is not loaded.');
    return;
  }

  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();
