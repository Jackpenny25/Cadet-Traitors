import {supabaseConfig} from './supabase-config.js';

const button = document.getElementById('check');
const result = document.getElementById('result');
button.addEventListener('click', async () => {
  button.disabled = true;
  result.textContent = 'Checking Supabase…';
  try {
    const response = await fetch(`${supabaseConfig.url}/rest/v1/rpc/tno_connection_check`, {
      method: 'POST',
      headers: {apikey: supabaseConfig.publishableKey, 'Content-Type': 'application/json'},
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const messages = {
        401: 'The project rejected the publishable key. Check the project URL and key.',
        403: 'The connection check is not permitted. Check that the SQL setup finished successfully.',
        404: 'The database setup was not found. Run supabase/001-foundation.sql in this project first.',
      };
      throw new Error(messages[response.status] || `Supabase returned HTTP ${response.status}. Check that the project is active and the SQL setup succeeded.`);
    }
    const data = await response.json();
    if (data.app !== 'trust-no-one' || data.schema_version !== 1) throw new Error('The project responded, but its database setup does not match this website.');
    result.textContent = 'Connected! The database foundation is installed. The game remains in local demo mode until multiplayer is connected.';
  } catch (error) {
    result.textContent = error.name === 'TimeoutError' ? 'The request timed out. Check your connection and that the Supabase project is active.' :
      error instanceof TypeError ? 'Could not reach Supabase. Check your internet connection and project URL.' : error.message;
  } finally {
    button.disabled = false;
  }
});
