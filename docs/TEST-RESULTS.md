# Test results and verification limits

The automated suite tests the server-controlled event runtime against embedded
Postgres with pgcrypto. Supabase Auth users, sessions and JWT claims are mocked
in an isolated test schema. No production project or real player is seeded.

The final automated run passed all 12 tests. The production build and Git
whitespace checks also passed. Packaged migration contents are checked against
the runtime source to prevent deploying a different SQL version from the one tested.

The full event scenarios exercise:

1. One empty live event, code-free joining and separate practice events.
2. Fifty stable player records across five balanced groups, with role counts
   persisted on the server and no role visibility before release.
3. Faithful, Traitor, eliminated player, group NCO, host and public-board boundaries.
4. Shared deadlines, pause/resume/extend, voting, abstentions and private tallies.
5. Fresh runoff identifiers, stale vote rejection, one runoff, explicit random draw,
   and the deliberate reopen/skip path for an empty ballot.
6. Standard murder disagreement, designated decider, shields and two-opportunity limits.
7. NCO verification, expiry of unconfirmed objectives, retained pending outcomes,
   redundant murders, early Faithful victories and final Traitor victories.
8. Recovery without rerolling roles, revoked sessions, no privilege escalation,
   retry receipts, failed-request quotas, private export and scoped deletion.
9. Escaped UI text, server-time countdowns, Europe/London timing and locally generated QR.

The load scenario concurrently submits 50 player snapshots, a host snapshot,
an NCO snapshot and a projector read against one embedded database. Representative
runs complete that 53-request batch in roughly 0.4 to 0.6 seconds on this machine.
Timing is diagnostic, not a capacity
guarantee. PGlite serialises statements, so this is not evidence of multi-connection
row-lock behaviour, Supabase quotas, mobile networks or the squadron’s reception.
The test runner prints the measured result for each run.

Two browser sessions with independent storage signed into the local QA backend,
one as host and one as a player. Both restored the same event without a code.
The backend was real embedded Postgres, but Auth was a local fixture. Chrome then
blocked further interactive clicks/reloads due to an extension UI. Remaining
browser workflows, final responsive layouts and projector scanning are not
claimed as fully verified. Use the rehearsal checklist for those checks.

The baseline compatibility test still exercises the earlier database schema so
the upgrade path is covered. Retired browser-only engine tests and assets have
been removed from the published site; they are not counted as connected evidence.

No live database migration, remote Security Advisor run, deployment or real-device
event rehearsal has been performed automatically. Do not call the event ready
until the deployment and REHEARSAL.md checks have been completed.
