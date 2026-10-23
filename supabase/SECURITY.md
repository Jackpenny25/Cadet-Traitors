# Security setup without CAPTCHA

Name and four-digit PIN login remains unchanged. No CAPTCHA widget or Cloudflare connection is required by default.

## Apply the update

Run `005-security.sql` once in Supabase SQL Editor after `002-connected.sql`.
Do not rerun the earlier scripts if they are already installed. This update
preserves accounts and games, but requires existing app sessions to sign in again.
Publish the updated website files together with this SQL update. Old clients
cannot submit commands because they lack the required request identifiers.

The update adds:

1. Binding to a live Supabase Auth session, so deleting/revoking that session
   also stops its application access, even with an unexpired access token.
2. Ten join attempts per minute per app account, including unsuccessful codes.
   Other commands allow sixty attempts per minute per account across devices.
3. Server-side request receipts to prevent retrying a committed request from
   applying it twice. Conflicting reuse of a request identifier is rejected.
4. Payload size checks, private-table access restrictions and revocable public
   board links. The original five-attempt PIN lock and eight-hour session limit remain.

New frontend protections include a Content Security Policy, no-referrer policy,
restricted form submissions, hidden role envelopes when switching away from
the tab, and guards against a delayed response restoring data after logout.
The CSP is delivered as a meta tag because GitHub Pages does not let this
repository set arbitrary response headers. It does not implement frame-ancestors
or replace hosting-level security headers.

## Supabase settings still matter

Keep Anonymous Sign-Ins enabled. Keep the CAPTCHA requirement disabled for this
default build. Keep the private schema OUT of the Data API's exposed schemas.
Run Supabase Security Advisor after applying the SQL. Verify that authenticated
and anon cannot directly select or modify the game/account tables.

Supabase's anonymous signup endpoint is public. Database quotas cannot stop
requests to create Auth users before they reach our SQL. Set and monitor the
anonymous Auth IP rate limit and your project's quotas in the Supabase dashboard.
Allow enough for the event's devices sharing one Wi-Fi IP without making it
unlimited. Reusing an existing background session avoids a signup per PIN attempt.

Without a challenge, network gate or another server-side abuse control at that
endpoint, determined bots can still create anonymous Auth users within those
limits. These changes reduce abuse; they do not eliminate that risk. Rate limiting
also cannot stop distributed account creation or intentional account lockouts.
Four-digit PINs are weaker than passwords; encrypted transport, salted hashes,
account-level lockouts and admin-controlled host privileges limit the exposure.

Do not delete all anonymous users as a cleanup job: some are the canonical
identities referenced by real accounts, players, hosts and event logs. Recovery
is through `004-reset-pin.sql`, which revokes all application sessions for that
account. Never publish filled-in recovery scripts.

## Optional Turnstile support

The code includes an opt-in integration, disabled by `turnstileEnabled: false`
in `dist/supabase-config.js`. With the default setting no widget is loaded or
required. If you later choose it:

1. Create a Turnstile widget allowing `jackpenny25.github.io` and any custom
   hostname. Add localhost/127.0.0.1 only if you need local testing.
2. Put its public site key in `turnstileSiteKey`, set `turnstileEnabled: true`
   and rebuild with `npm run build`.
3. Put its matching secret only into Supabase Auth CAPTCHA settings, select
   Turnstile and enable the requirement. Never put the secret into the repository.
4. Deploy and test a fresh browser session. A token must reach Supabase and be
   validated server-side. Frontend-only checks do not provide bot protection.

Turning the frontend option off does not disable Supabase's server requirement;
both settings must agree. Turnstile protects creation of background Auth sessions;
database quotas and PIN locks protect subsequent app requests.

## Validation

Run `npm test` and `npm run build`. Tests use real embedded Postgres/pgcrypto with
a mocked Auth schema and session claims. They check table access denial, role
privacy, cross-game isolation, quotas after failed requests, request replay,
session revocation, PIN reset and board-link revocation. Optional-widget tests
cover one-use tokens, expiry and the CAPTCHA-free default.

Live project settings, shared-network limits, and phone testing remain deployment
checks; the repository cannot verify these without access to the live project.

References:
https://supabase.com/docs/guides/auth/auth-anonymous
https://supabase.com/docs/guides/auth/sessions
https://supabase.com/docs/guides/auth/auth-captcha
