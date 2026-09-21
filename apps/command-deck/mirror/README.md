# Command deck mirror

English | [中文](README.zh.md)

The mirror publishes the harness feed from a machine that accepts no inbound connections. That machine runs the feed and a pusher that copies the feed's answers to a relay hosted on a Supabase project; the deck reads the relay exactly as it reads the feed, so a static deck on any host shows the machine's live runs.

## Parts

| Path | Role |
| --- | --- |
| `schema.sql` | Four tables: `feed_config` (the pusher token's digest), `feed_json` (one row per feed path: `/roster`, `/runs`, `/safety/<id>`), `feed_events` (one row per folded event, unique on run, session and `seq`), `feed_requests` (reviews the hosted deck asked for); row level security with no policies; the public `deck` storage bucket. |
| `functions/ingest/index.ts` | Token-protected writes. `POST /bootstrap` fixes the token on first use and stores its SHA-256; then `POST /json`, `POST /events`, `GET /requests`, `POST /requests/:id`, `POST /upload` and `POST /reset`, each carrying `x-daliesk-token`. Every write body is `{ "gz": base64(gzip(JSON)) }`. |
| `functions/feed/index.ts` | The feed contract for viewers: `GET /roster`, `GET /runs`, `GET /safety/:id`, Server-Sent Events on `GET /runs/:id/events` (at most 140 s per connection, resumed from `Last-Event-ID`), and `POST /safety`, which waits up to 25 s for the pusher to start the review and answers with its run id. CORS allows every origin. |
| `functions/deck/index.ts` | Serves the deck's static export from the `deck` bucket under `/functions/v1/deck/`. A browser does not receive it as a page: the platform answers a navigation with `text/plain` and a sandboxing policy, so host the export elsewhere and point it at the relay. |
| `pusher.mjs` | Runs beside the feed. Pushes `/runs`, `/roster` and each code-safety `/safety/:id` when they change, follows every run's event stream and forwards events in batches (running runs first, then code-safety reviews, then the rest newest first), and claims review requests whose target is under `TARGET_ROOT`. |
| `upload-deck.mjs` | Uploads a static export directory to the bucket through `POST /upload`. |

## Deploy

1. Create a Supabase project and apply `schema.sql`.
2. Deploy the three functions with JWT verification off: `ingest` authenticates with its token, `feed` and `deck` are public reads.
3. Mint a token into a file outside the repository and bootstrap it once; the relay keeps only its digest.

```sh
openssl rand -hex 32 > "$HOME/.dsh-mirror-token"
curl -X POST "$INGEST_URL/bootstrap" -H "x-daliesk-token: $(cat "$HOME/.dsh-mirror-token")"
```

4. Run the pusher beside the feed.

```sh
INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest INGEST_TOKEN_FILE="$HOME/.dsh-mirror-token" TARGET_ROOT="$HOME/targets" node apps/command-deck/mirror/pusher.mjs
```

5. Build the deck with `NEXT_PUBLIC_FEED_URL=https://<ref>.supabase.co/functions/v1/feed`, or add `?feed=` with that URL to a built deck's address, and host the export on a static host.

## Why the envelope

The web application firewall in front of the project rejects request bodies that quote injection or traversal strings, which a code-safety review's findings do. Gzip inside base64 keeps a payload opaque to it; responses are not inspected.

## Exposure

`POST /safety` on the relay starts a review on the pushing machine for anyone who reaches the URL. The pusher accepts only targets under `TARGET_ROOT` and the models `sonnet`, `opus` and `haiku`; stop it when the demonstration ends.
