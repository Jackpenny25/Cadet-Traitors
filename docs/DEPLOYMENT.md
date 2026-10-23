# Deployment for this event

The site keeps Supabase and name/four-digit PIN accounts. There is one live
event, no joining code, and no email requirement. The QR on the projector opens
the website, not an account or a secret projector link. Rehearsals are separate.

## Upgrade the existing Supabase project

Use the dedicated game project, currently `ynysokduhlvqvfygjorg`. Never use
Flight Points or another operational database. Back up any existing event first.

In SQL Editor run `select public.tno_connection_check();` to identify the version.

| Reported version | Run next, in this order |
| :--- | :--- |
| 1 | `supabase/002-connected.sql`, `supabase/005-security.sql`, then the single-event runtime migration |
| 2 | `supabase/005-security.sql`, then the single-event runtime migration |
| 3 | Only the single-event runtime migration |
| 4 | The runtime is installed. Do not run it again. |

The runtime migration is
`supabase/migrations/20261023161553_single_event_runtime.sql`.
Copy its full contents into a new SQL Editor query and run once. If a query
fails, keep the exact error. Do not delete tables or repeatedly rerun earlier
scripts to force it through.

For a completely fresh project use both files in `supabase/migrations`, in
filename order. The first is the complete baseline; the second is the event
runtime. Do not apply the baseline to a project which already has these tables.
The earlier `001`, `002` and `005` files remain for upgrading existing installs.
`003-grant-host.sql` and `004-reset-pin.sql` are administrator procedures, not
automatic migrations. No migration creates example players or accounts.

Existing events are kept but not automatically made live. Create a fresh live
event for the actual evening. An empty earlier event can instead be selected
using “Use this as the live event”. Earlier events with legacy decisions stay
available for their recovery records and cannot be promoted to the new runtime.

## Authentication and permissions

1. Enable Anonymous Sign-Ins in Supabase Auth. These are the background device
   sessions. A separate server-side name/PIN check is still required for game data.
2. Keep CAPTCHA off for the current configuration. No widget is needed. Keep
   `private` out of the Data API’s exposed schemas.
3. Check the anonymous Auth IP limit against the expected phones sharing squadron
   Wi-Fi. Supabase documents a default of 30 anonymous sign-ins per hour per IP.
   Set an appropriate event limit and monitor it; do not make it unlimited.
4. Create your name/PIN account on the website. Replace the name placeholder in
   `supabase/003-grant-host.sql`, run it in SQL Editor and refresh the website.
   Host status can only be granted administratively. Never publish a filled-in
   script containing a PIN.
5. Main hosts assign NCO accounts to groups through Setup. NCOs must register
   their account before they are assigned, and must not join the player roster.
6. Run Supabase Security Advisor. Verify table access using separate signed-out,
   player, NCO and host sessions. Repository tests do not inspect your remote settings.

No email confirmation, SMTP or email redirects are required by this login flow.
See `supabase/SECURITY.md` for the four-digit PIN and anonymous-signup limitations.

## GitHub Pages

The included workflow builds and tests the site, then deploys `dist` as the site
root. In GitHub Settings > Pages select GitHub Actions as the source.
Commit and push all source, migration and lockfile changes to `main`.

The expected address remains https://jackpenny25.github.io/Cadet-Traitors/.
The projector’s QR derives its address from the deployed page, so repository
subdirectories work without hardcoded routing. Compatibility redirects keep
old `/Cadet-Traitors/dist/index.html` and projector links working after the
Actions deployment. Those redirects preserve the secret board fragment.

The browser configuration in `dist/supabase-config.js` contains only the public
project URL and publishable key. Alternatively set repository Actions variables
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. `.env.example` contains placeholders
only. A local `.env` file is not loaded automatically: export the variables in
your terminal before running the build. Never add a service-role key, database
password or player PIN to frontend code or GitHub variables.

To keep branch publishing temporarily, keep `main` and `/ (root)`. The existing
root redirect opens `dist`. Commit the built files. The new workflow requires
the Pages source to be switched to Actions before its deployment job can succeed.

Cloudflare Pages is optional: build with `npm ci && npm run build`, output `dist`.
The same relative assets work there. No tunnel or paid custom domain is needed.

## Local development

Run `npm ci`, `npm test`, `npm run build`, then `python serve.py`. Open
http://127.0.0.1:4173. Source entry points are `src/event-app.js` and
`src/event-projector.js`; the existing lightweight JavaScript application was
retained as a suitable alternative to a framework rewrite.

After changing SQL, run the tests, then `node scripts/package-migrations.mjs`
to update the CLI-created migration files. Do not change a migration that has
already been deployed; create the next migration with the Supabase CLI instead.

Use the rehearsal checklist before claiming the event is ready. This repository
update does not itself apply SQL, change Auth settings or publish the new site.

Sources:
https://supabase.com/docs/guides/auth/auth-anonymous
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
