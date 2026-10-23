# 2427: Trust No One

A connected website for the Biggin Hill cadet evening, with one live event and a
separate rehearsal space. Players use a name and four-digit PIN. There is no
joining code, email requirement or CAPTCHA challenge.

The projector shows a locally generated QR code for the website. After signing
in, players join the single event or return to their existing dashboard. Public
player numbers are shown until the host approves a callsign.

## What is included

| Area | Connected behaviour |
| :--- | :--- |
| Main host | Empty event setup, role preparation/release, group controls, NCO assignments, reveals, private export and deletion |
| Group NCO | Assigned-group access with permissions chosen by the main host |
| Players | Private envelopes, mission instructions, server-accepted votes, target choices, help and recovery |
| Projector | Public information only, QR joining, countdowns, scores and staged published reveals |
| Rules | Three ballots, one tied runoff per ballot, two murder opportunities, supervised objective, optional shields and group victories |
| Timers | Server deadlines, pause/resume/extend, automatic resync on reconnect |
| Security | Server-side PIN hashes and lockouts, live-session binding, scoped commands, retry receipts and request limits |

## Set up this version

Start with [the deployment guide](docs/DEPLOYMENT.md). Existing projects need the
new runtime migration after their previous upgrades. Do not rerun already applied
setup scripts. Create your name/PIN account and use the administrator host-grant
script before opening joining.

Use [the organiser guide](docs/ORGANISER-GUIDE.md) for the evening,
[the rehearsal checklist](docs/REHEARSAL.md) for the venue tests and
[the paper fallback](docs/PAPER-FALLBACK.md) if connectivity fails.

## Develop locally

Run `npm ci`, `npm test`, `npm run build`, then `python serve.py`.
Open http://127.0.0.1:4173. The maintained source is in `src/event-app.js`,
`src/event-projector.js`, `src/event-api.js` and `src/event-ui.js`.
The existing lightweight JavaScript frontend was retained as a suitable
alternative to a framework rewrite.

The build produces static `dist` assets. The included GitHub Pages workflow
tests and deploys them. Repository subdirectory paths work, with compatibility
redirects for older /dist links. Cloudflare Pages can use the same output.

The versioned migration files were created with the Supabase CLI. Run
`node scripts/package-migrations.mjs` to refresh their contents while preparing
this undeployed change. Once deployed, add a new migration for future changes.
The old numbered scripts remain for upgrading earlier installations and
administrator account procedures.

## Verification status

The automated tests cover connected database workflows, access boundaries and
a simulated 50-player workload plus organisers and projector. They use real
embedded Postgres with pgcrypto and mocked Auth sessions. Two isolated browser
logins were also checked. See [test results and limits](docs/TEST-RESULTS.md).

This update has not been applied to the live Supabase project or published.
Real Supabase permission checks, multi-connection concurrency, final browser
interaction, QR scanning and the NCO venue rehearsal remain required before
calling the event ready. No live event is seeded with demonstration players.

CAPTCHA stays off as requested. Anonymous Auth signup abuse still depends on
Supabase's IP limits and monitoring; see [security setup](supabase/SECURITY.md).
Never publish a service-role key, database password or real PIN.
