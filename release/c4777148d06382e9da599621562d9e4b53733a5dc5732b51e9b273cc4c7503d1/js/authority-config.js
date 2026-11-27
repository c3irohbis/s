// This immutable release uses only the server authority path for security writes.
// While the server is disabled, writes fail visibly without a Firestore fallback.
window.__BLISS_AUTHORITY_MODE = 'supabase';
