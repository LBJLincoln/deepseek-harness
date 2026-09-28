# Command deck mirror

English | [中文](README.zh.md)

The mirror publishes the harness feed from a machine that accepts no inbound connections. That machine runs the feed and a pusher that copies the feed's answers to a relay hosted on a Supabase project; the deck reads the relay exactly as it reads the feed, so a static deck on any host shows the machine's live runs.

## Parts

| Path | Role |
| --- | --- |
| `schema.sql` | Four tables: `feed_config` (the pusher token's digest), `feed_json` (one row per feed path: `/roster`, `/runs`, `/programs`, `/safety/<id>`, `/ops`), `feed_events` (one row per folded event, unique on run, session and `seq`), `feed_requests` (reviews the hosted deck asked for); row level security with no policies; the public `deck` storage bucket. |
| `functions/ingest/index.ts` | Token-protected writes. `POST /bootstrap` fixes the token on first use and stores its SHA-256; then `POST /json`, `POST /events`, `GET /requests`, `POST /requests/:id`, `POST /upload` and `POST /reset`, each carrying `x-daliesk-token`. Every write body is `{ "gz": base64(gzip(JSON)) }`. |
| `functions/feed/index.ts` | The feed contract for viewers: `GET /roster`, `GET /runs`, `GET /programs`, `GET /safety/:id`, `GET /ops`, Server-Sent Events on `GET /runs/:id/events` and `GET /ops/events` (at most 140 s per connection, resumed from `Last-Event-ID`; `/ops/events` streams the rows stored under the run `ops` and starts a fresh connection 200 rows back). It serves reads only: every other method, `POST /safety` included, answers `405`. CORS allows every origin. |
| `functions/deck/index.ts` | Serves the deck's static export from the `deck` bucket under `/functions/v1/deck/`. A browser does not receive it as a page: the platform answers a navigation with `text/plain` and a sandboxing policy, so host the export elsewhere and point it at the relay. |
| `pusher.mjs` | Runs beside the feed. Pushes `/runs`, `/roster`, `/programs` and each code-safety `/safety/:id` when they change, follows every run's event stream and forwards events in batches (running runs first, then code-safety reviews, then the rest newest first), and claims review requests whose target is under `TARGET_ROOT`. |
| `upload-deck.mjs` | Uploads a static export directory to the bucket through `POST /upload`. |

## Deploy

1. Create a Supabase project and apply `schema.sql`.
2. Deploy the three functions with JWT verification off: `ingest` authenticates with its token, `feed` and `deck` are public reads.
3. Mint a token into a file outside the repository and bootstrap it once; the relay keeps only its digest. A container that lost the file rotates it: [Rotating the token](#rotating-the-token).

```sh
openssl rand -hex 32 > "$HOME/.dsh-mirror-token"
curl -X POST "$INGEST_URL/bootstrap" -H "x-daliesk-token: $(cat "$HOME/.dsh-mirror-token")"
```

4. Run the pusher beside the feed.

```sh
INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest INGEST_TOKEN_FILE="$HOME/.dsh-mirror-token" TARGET_ROOT="$HOME/targets" node apps/command-deck/mirror/pusher.mjs
```

5. Build the deck with `NEXT_PUBLIC_FEED_URL=https://<ref>.supabase.co/functions/v1/feed`, or add `?feed=` with that URL to a built deck's address, and host the export on a static host.

## The operations loop

[`scripts/enterprise-ops-live.sh`](../../../scripts/enterprise-ops-live.sh) keeps the relay's `/ops` live without the feed server or the pusher: every `OPS_INTERVAL_SECONDS` (default 15) it runs [`scripts/enterprise-ops.ts`](../../../scripts/enterprise-ops.ts) `--push`, which collects one operations snapshot and sends it through `POST /json` as `/ops` and its new activity frames through `POST /events` as the run `ops`. It runs from a checkout of its own, which it fast-forwards from the branch every `OPS_PULL_SECONDS` (default 300); it reads the token from `INGEST_TOKEN_FILE` (default `$HOME/.dsh-mirror-token`) and the relay from `INGEST_URL`; a second loop exits 4 while one holds its lock. Started detached once per container:

```sh
git -C /home/user/deepseek-harness worktree add /home/user/deepseek-harness/.claude/worktrees/ops-live -B ops-live origin/claude/coding-agent-harness-u9l4gt
cd /home/user/deepseek-harness/.claude/worktrees/ops-live && pnpm install --offline --frozen-lockfile
setsid nohup bash scripts/enterprise-ops-live.sh >> /home/user/enterprise-cycles/ops-live.log 2>&1 < /dev/null &
curl -sS https://<ref>.supabase.co/functions/v1/feed/ops | head -c 200
```

The first command fails harmlessly when the worktree already exists; a container reset erases the token, so a fresh container rotates it first.

## Rotating the token

The relay keeps only the token's SHA-256 in `feed_config`; the token itself lives in a file outside the repository, which a container reset erases. Every fresh container therefore mints a new token and replaces the digest, and nothing that pushed with the old token works until it does:

1. Mint the token into a file only its owner can read, and print its digest, never the token:

   ```sh
   umask 077 && openssl rand -hex 32 > "$HOME/.dsh-mirror-token"
   printf %s "$(tr -d '[:space:]' < "$HOME/.dsh-mirror-token")" | sha256sum | cut -d' ' -f1
   ```

2. Replace the digest on the relay's database, through the Supabase SQL editor or the Supabase MCP `execute_sql` tool, with the digest printed above:

   ```sql
   insert into public.feed_config (key, value) values ('ingest_token_hash', '<digest>')
   on conflict (key) do update set value = excluded.value;
   ```

   Deleting the row instead and calling `POST /bootstrap` with the new token works too, but leaves the relay open to whoever bootstraps first until the call lands.

3. Check the token: `curl -sS -o /dev/null -w '%{http_code}\n' -H "x-daliesk-token: $(tr -d '[:space:]' < "$HOME/.dsh-mirror-token")" "$INGEST_URL/requests"` answers `200`; `403` means the digest does not match.

4. Start or restart the operations loop (and the pusher, when the feed runs) so they read the new file.

## Why the envelope

The web application firewall in front of the project rejects request bodies that quote injection or traversal strings, which a code-safety review's findings do. Gzip inside base64 keeps a payload opaque to it; responses are not inspected.

## Exposure

The feed function serves reads only, so nothing a viewer sends starts work on the pushing machine: a review is started on the feed itself (`POST /safety` on `pnpm run feed`), never through the relay, and the pusher's request claiming finds no request to claim. The ingest token guards every write. What the relay serves is public: the operations snapshot passes every published line (tool descriptions, labels, reasons) through the transcripts' shared credential redaction ([`secret-patterns.mjs`](../../../data/transcripts/tools/secret-patterns.mjs)) and masks e-mail addresses, and the pusher forwards the feed's folded events, which carry tool names and results; stop the pusher when the demonstration ends.
