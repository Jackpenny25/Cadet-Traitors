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
    if (data.app !== 'trust-no-one' || ![1,2,3,4].includes(data.schema_version)) throw new Error('The project responded, but its database setup does not match this website.');
    result.textContent = data.schema_version === 4 ? 'Connected! The full event runtime is installed. Open Trust No One to sign in.' : data.schema_version === 3 ? 'Connected. Install the single-event runtime migration to enable the event controls.' : data.schema_version === 2 ? 'Connected. Install 005-security.sql and the event runtime.' : 'Connected to the foundation. Complete the database upgrades in the deployment guide.';
  } catch (error) {
    result.textContent = error.name === 'TimeoutError' ? 'The request timed out. Check your connection and that the Supabase project is active.' :
      error instanceof TypeError ? 'Could not reach Supabase. Check your internet connection and project URL.' : error.message;
  } finally {
    button.disabled = false;
  }
});
