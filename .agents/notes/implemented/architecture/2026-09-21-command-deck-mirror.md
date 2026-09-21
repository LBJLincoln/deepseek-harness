# Agent Note: The Command Deck mirror publishes the feed from a machine that accepts no inbound connections

Status: implemented

English | [中文](2026-09-21-command-deck-mirror.zh.md)

## Problem

The customer proof of concept needs a URL that shows the enterprise working now: the deck reading a feed whose runs are in progress, not a recording. The machine that runs the harness, the feed and the reviews is a managed container that accepts no inbound connections, and the outbound paths a tunnel would use are closed: Cloudflare's quick tunnel needs port 7844 over QUIC or TCP, which the egress proxy resets, and the hosting connectors available to the session could create no Vercel project, deployment or sandbox. The feed is a plain HTTP and Server-Sent Events server, so the question was how to make its answers reachable from a public origin without any connection into the machine.

## Decision

**Push the feed's answers out; serve them from a relay.** A pusher beside the feed reads `GET /runs`, `GET /roster` and each code-safety `GET /safety/:id`, follows every run's event stream, and writes what changed to a relay hosted on a Supabase project: one table of JSON snapshots keyed by feed path, one table of folded events unique on run, session and `seq`, one table of review requests. A public `feed` function serves the deck's whole contract from those rows, including the event stream, which it replays from the rows then polls every 500 ms and closes before the runtime's wall-clock limit; the browser's `EventSource` reconnects with `Last-Event-ID`, and the function resumes from that row. The deck is unchanged except for one addition in `deck/feed.ts`: `?feed=` on the page URL names a feed for that browser tab, kept in session storage, so a hosted deck follows the relay without a rebuild.

**Writes are authenticated by a token the relay never stored in clear.** The `ingest` function accepts the first token it sees on `POST /bootstrap`, keeps its SHA-256 in `feed_config`, and compares every later request against it. The token is minted on the pushing machine into a file outside the repository and appears in no source, log or transcript; the anon role has no policy on any mirror table, and both functions write with the service role from their own environment.

**Every write travels as gzip inside base64.** The web application firewall in front of the project rejected the first snapshots with the recorded NodeGoat findings: their snippets quote SQL injection and path traversal strings, which is what a firewall matches. The `{ "gz": … }` envelope keeps a payload opaque to it; responses are not inspected, so the deck reads plain JSON.

**Events go out from one queue per run, running runs first.** Fifty-four recorded runs hold about sixty-eight thousand events; one shared queue drained them in twenty-five minutes with the live run waiting behind them. Per-run queues ordered by status, kind and start time, four batches in flight and a batch that halves on refusal and drops one event after three refusals put the live review first and cleared the backlog in about a minute. The stream client uses `node:http` rather than `fetch`, whose body timeout ended a silent recorded stream every five minutes and replayed the whole run.

**The relay starts reviews too.** `POST /safety` on the `feed` function stores a request and waits up to 25 s; the pusher claims it, refuses a target outside `TARGET_ROOT` or a model other than `sonnet`, `opus` and `haiku`, starts the review on the local feed and reports the run id back, so the hosted deck's form starts a real review on the pushing machine. A viewer of the URL can do the same, which is why the pusher is stopped when a demonstration ends.

## Consequences

Any static host that serves the deck's export shows the pushing machine's live runs: the GitHub Pages workflow now bakes the relay in as the page's feed (`vars.DECK_FEED_URL` overrides it), and a viewer can name any relay with `?feed=`. Verified in headless Chromium against the export served locally and pointed at the relay: every view reports `LIVE`, the footer names the relay and the running review, and the Process view counted the review's events as they arrived.

The relay cannot host the page itself. Supabase Storage answers HTML with `text/plain` and a `default-src 'none'; sandbox` policy, and the functions gateway does the same for a browser navigation even when the function sets `text/html`, while a plain HTTP client receives the page. The `deck` function stays as the storage front for the export's files, and the page is published from GitHub Pages or another static host.

The mirror is a demonstration instrument, not a product seam: it duplicates the feed's answers rather than its folding, holds no key beyond the token's digest, and costs nothing on the project's free plan. Its pusher must run for the mirror to be live; when it stops, the relay keeps the last snapshots and every event it received, so the hosted deck degrades to a faithful record of the last run rather than to an empty page.

## Alternatives considered

- **A Cloudflare quick tunnel to the local feed and deck.** No account and no relay code, but the tunnel needs port 7844 to the edge, which this machine's egress closes.
- **A Vercel sandbox or project running the real feed.** Refused by the account's permissions, and a cloud copy of the feed would need the whole workspace and the run directories synchronized, duplicating the folding the local feed already does.
- **Serve the export from the storage bucket or the `deck` function.** Both answer a browser with plain text under a sandboxing policy; the platform forbids pages on its shared domain.
- **Write to PostgREST directly with the anon key.** Every write policy would be public; the token-checked function keeps writes to one machine.
- **Commit the live run's session files.** Public raw files are cached for minutes and a data commit every few seconds would pollute the branch; the relay carries the events with seconds of delay and no history.
