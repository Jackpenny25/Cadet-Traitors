# Trust No One

A connected group game on GitHub Pages with name and four-digit PIN accounts, backed by Supabase.

## Activate this version

1. Keep the existing foundation (supabase/001-foundation.sql). Do not run it again.
2. Run supabase/002-connected.sql once in Supabase SQL Editor. It adds accounts, private game storage and server commands without deleting existing records.
3. In Supabase Authentication settings, enable Anonymous Sign-Ins. No email provider, SMTP or email redirect is needed. These anonymous sessions are just the transport: a successful server-side name/PIN login is also required to access games.
4. Check Authentication rate limits for anonymous sign-ins. Supabase documents a default limit of 30 per hour per IP. For around 50 devices on squadron Wi-Fi, configure an appropriate higher limit before the event, for example 100 per hour, and rehearse on that network. Do not enable a CAPTCHA requirement without also adding its verification widget and passing the token to signInAnonymously.
5. Commit and push all updated files to main. Keep GitHub Pages on main, / (root).
6. Open the new website, choose Create an account, and enter your name and a four-digit PIN twice.
7. Replace the name placeholder in supabase/003-grant-host.sql with your registered account name. Run that script in SQL Editor, then refresh the website. Create game now appears.
8. Create a game and share the joining code. Each player creates a name/PIN account, signs in, enters the code and chooses their game callsign.
9. Open the player board from host controls. Its unguessable link grants access to player names and published results. Share it with the intended audience.

Accounts appear in Table Editor by selecting the private schema and accounts table. PINs are stored as salted bcrypt verifiers, never plaintext. Supabase Authentication > Users contains background anonymous device identities. A public.players row appears only after an account joins a game. The host is separate from the playing roster.

Do not publish PINs, database passwords, secret keys or service role keys. Hosting comes only from private.hosts, never from a user-editable profile or an option on the signup form.

## Running and building

Run npm ci then npm run build after source changes. The bundled dist/app.js is committed, so GitHub Pages needs no build service. Run python serve.py for http://127.0.0.1:4173.

Run npm test for database lifecycle and security tests plus retained rule-engine tests. The database tests use an isolated embedded Postgres with pgcrypto and a mocked Supabase Auth context, not your remote project.

## Accounts and recovery

Names are unique across the website after whitespace and Unicode normalization. Users may sign back into their account on another device with the same name and PIN.

Five incorrect PINs lock that account for 15 minutes. There is also a limit of ten account attempts per background Auth identity per 15 minutes. Database rate limits are persisted even when a login fails. PIN checks never happen in browser storage. Application sessions expire after eight hours. Signing out removes the application's session binding.

If a PIN is forgotten, an administrator can use supabase/004-reset-pin.sql in SQL Editor. This resets the PIN and revokes every application session for that account. Verify the person's identity before doing so. Do not commit filled-in recovery scripts.

A four-digit PIN has lower entropy than a strong password; attempt limits reduce online guessing risk but cannot make it equivalent to a password or MFA. Host access follows the user's requested name/PIN login too.

## Connected gameplay

All game data is stored in Supabase. No previous local PIN registration is migrated. The website polls for updates every five seconds while visible and never queues offline actions as successful.

Commands serialize changes on the event row, enforce ownership and membership, and store votes/results transactionally. Public display responses exclude unrevealed roles, objectives, votes, private target choices and credentials. Eliminated players cannot vote or propose future targets.

Games support 1 to 5 balanced groups, up to 100 players and 1 to 5 Traitors per group. Every group needs more players than Traitors before assignment. Roles cannot be reassigned. Stages are Mission, Round table and Night.

Ties can be decided by the host among the top candidates or published as no banishment. Zero votes means no banishment. Hosts choose among differing Traitor proposals and verify physical objectives. There is one confirmed murder per group per Night stage. Hosts choose the number of rounds, record mission scores with reasons, publish eliminations and reveal banished roles separately. Ending a game publishes all roles and group winners.

NCOs deliver physical tasks; host controls record outcomes. Delegated NCO accounts and automated timers are not part of this implementation.

## Before using at an event

Local database tests and a browser layout check are complete. The remote upgrade, anonymous Auth setting, real-device logins and event-network capacity still need verification. A connection-check success alone does not verify all of these.

Test with a host account and separate player accounts across phones: registration, returning on another device, private roles, changed votes, ties, elimination, reconnect and the public board. Review Supabase Security Advisor after installation. Rehearse with the expected number of devices before adding real event data.

This update has not automatically changed your live Supabase project or pushed files to GitHub.
