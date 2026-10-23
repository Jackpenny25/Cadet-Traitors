# Supabase setup

## 1. Install the database foundation

Open the dedicated Cadet Traitors project in Supabase. Select SQL Editor,
then New query. Copy the whole contents of `001-foundation.sql` into the
editor and click Run. Run it once. If it reports an error, keep the exact
error message; do not delete tables to retry.

The script runs in a transaction and creates events, groups, players and
separate private roles. Row Level Security is enabled. Browser access is
read-only and limited to an event owner or a player's own records. Joining
and game actions are deliberately unavailable at this stage.

## 2. Check the connection

Run `python serve.py`, then open
http://127.0.0.1:4173/supabase-setup.html and click Check connection.
After committing and pushing these files, the published check page is
https://jackpenny25.github.io/Cadet-Traitors/dist/supabase-setup.html.

The check runs a read-only function that returns a schema version, with no
game data. A success confirms connectivity and the presence of that function;
it does not verify multiplayer or all permission rules.

## 3. Next implementation stage

The existing demo remains unchanged. Before connected play, implement host
authentication, server-enforced staff membership, player registration and
recovery, transactional game actions, private player responses and a public
projector API. Keep the four-digit PIN flow on a server with rate limits;
do not use a PIN as a Supabase Auth password. Do not upload the demo's whole
state to a shared readable table: it includes every secret role.

Test permissions using separate host, player and signed-out sessions before
testing game actions across phones. No real player records are seeded here.
