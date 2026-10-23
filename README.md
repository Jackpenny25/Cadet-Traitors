# 2427: Trust No One

A simple local rehearsal for 2427 (Biggin Hill). Independent game concept; not affiliated with the BBC.

## Launch

Run `python serve.py` from this folder and visit http://127.0.0.1:4173. No installation or build step. The launcher sets JavaScript MIME types explicitly and disables caching. You can also use another static HTTP server for dist/.

## What changed

A shorter welcome page and dashboard. Joining now asks for a name and a four-digit PIN, entered twice. Existing names must supply the original PIN. Names appear on the public player board. A published banishment or murder plays a six-second reveal and leaves a large red X on that name. Pending victims stay hidden. Animation respects reduced motion; there is no autoplay sound.

## Joining and identity

This is a single-browser demo, not connected authentication. dist/identity.js validates and normalises a name, verifies matching four-digit PINs, and stores a per-player salt plus a PBKDF2 hash, never a plaintext PIN. A name maps to a stable numeric player ID. PIN data lives only in private demo state and is excluded from the projector snapshot. Existing players can return after joining closes; new names cannot. Five incorrect PINs trigger a local one-minute pause. A live database must replace this adapter and enforce credentials, permissions, rate limits and recovery on the server. Use a practice PIN for the demo. A four-digit PIN alone is not suitable protection for organiser access.

## Demonstrate to staff

Choose Show staff the demo, enter a name and matching PIN twice, then use Next. Show the envelope, mission, Traitor instruction and vote. Open Player board in a second tab of this browser. The tour publishes a fictional murder so you can see the red-cross reveal, then the eliminated-player view and winners. Reset under Settings for a fresh rehearsal.

## Full rehearsal

Host controls → close joining and release roles → advance phases → open and close group ballots → publish names and roles separately. Use Eliminations to confirm outcomes privately and release them explicitly. Score physical missions on the Players page. Corrections and proxy votes are logged. All players continue physical missions after elimination.

## Backend plan (not configured or tested)

1. Create a dedicated Supabase test project or an equivalent server and database. Keep service-role secrets on the server, never in this static client or repository.
2. Implement tables for events, groups, player public profiles, role secrets, salted per-player PIN verifiers, organiser memberships, phases, ballots, murder opportunities, private messages/objectives, scores, published results and audit entries. Keep all actual event data out of source control. Add uniqueness constraints on ballot(event, round, voter), murder(event, group, opportunity), and idempotency keys.
3. Use a name plus a four-digit PIN to create or recover a player session, with matching confirmation during registration. Match the event roster by a normalised name, handle duplicate names with organiser help, and bind sessions to stable player IDs. Store only salted PIN verifiers and enforce server-side attempt limits. Staff have separately authenticated organiser accounts. Group NCO membership is server-scoped. Implement an organiser-controlled replacement session that revokes the old credential.
4. Use deny-by-default row-level security and server RPCs. A player may read only their role, permitted active partners, own ballot, same-group authorised private messages and public event data. Eliminated players lose future secret data and write privileges. Public event endpoints must explicitly select allow-listed fields. Test API payloads, not just hidden UI.
5. Make assignment, ballot closure, tiebreaking, murder confirmation, publication and phase transitions transactional and idempotent. Validate eligibility and group membership on every action. Server timestamps are authoritative. Persist confirmed outcomes independently of the acting player's later status.
6. Add realtime subscriptions or polling, server acknowledgements, stale-state indicators, retry keys, refresh recovery and reconnect resync. Never show a success receipt until the server commits. Handle expired sessions and joining rate limits, including many cadets behind the same squadron Wi-Fi IP. Do not assume any plan's current connection limits; inspect the configured service's quotas before testing.
7. Test on at least two physical phones using both mobile data and squadron Wi-Fi. Verify role isolation, group NCO isolation, reconnect behaviour, refreshed votes, eliminated action rejection, tie handling, duplicate requests, one victim per opportunity, pending-victim privacy and a secret-free public API. Then rehearse approximately 50 player sessions plus organisers and the projector. Synthetic concurrency tests do not replace real device tests.
8. Add audited event deletion and retention controls. Review with staff, arrange physical mission materials and complete an NCO rehearsal before live use. No recruitment, extra roles or Flight Points integration is part of this version.


## Public display

projector.js imports no game engine or identity module and reads only tno-public-v1. It displays every player in group columns with a red X for published eliminations. The first page load does not replay old reveals; new publications trigger the effect. Publicly released roles can be shown, but unrevealed roles, votes, PIN hashes, private messages and pending victims are excluded. This local snapshot is not a security boundary against inspecting the same browser origin. A connected version needs a public-only API and separate server permissions.

## Validation and limits

Run `node --test tests/engine.test.js tests/identity.test.js` with modern Node.js. These check local rules and name/PIN behaviour, not real-device multiplayer or load. Connected Test Mode remains disabled. Use one organiser tab to avoid last-writer conflicts. Physical props and scoring need NCO verification. No Flight Points integration.

Settings → Reset creates a new fictional event; Delete saved data removes this browser’s progress and registrations. Source contains no actual game data.
