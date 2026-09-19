# Agent Note: The Command Deck reads one feed and replays committed fixtures when it does not answer

Status: implemented

English | [中文](2026-09-19-command-deck.zh.md)

## Problem

A customer proof of concept has to show the Daliesk enterprise working — 147 defined agents, the workflows between them, live activity from harness runs, and a code-safety review placed on a target repository's code — on a laptop, in a meeting room, tomorrow. The repository could show the same facts as logs and generated catalogues, but a room full of executives reads a scene, not a JSONL file. Nothing in the repository rendered an agent roster, a program pipeline, or a code-safety result at all.

Three constraints shaped the design and pull against each other. The feed server that supplies this data is written by a different agent, in parallel, so the front end could not wait for it and could not discover its behaviour by running it. The demo must survive a room with no network and no API key, because a proof of concept that shows an empty screen is worse than no proof of concept. And nothing on screen may be mistaken for a live result when it is not, because a claim a client repeats is a claim the repository has to stand behind.

## Decision

**One contract file, two sources behind it.** `lib/contract.ts` is the only place the feed's paths and payloads are written down. `resolveFeed()` sends one `GET /roster` to `NEXT_PUBLIC_FEED_URL` with a 1.5-second timeout and returns a base URL: the configured feed when it answers, and the deck's own `/api/fixtures` routes otherwise. Those routes serve the same paths with the same payloads, so every reader downstream — the store, the three scenes, the panels — is written once against one contract and never learns which source it is reading. A failed probe is not an error state to recover from; it is the other half of a two-valued choice the status bar reports.

**Replay is paced, not dumped.** The fixture event route delivers the first 60% of a recording immediately as history, then releases the rest a frame at a time, then holds the connection open with heartbeats — the behaviour the live endpoint's own contract describes. Interleaving the recorded phases (department sweeps, findings, the verifier's re-read, judging, integration) rather than laying them down in sequence is what keeps all four pipeline stages populated from the opening seconds. A keyless demo therefore shows an enterprise at work.

**Example data says so, on every view.** In replay mode the header badge reads `REPLAY`, the status footer names the feed it could not reach, and each view carries a standing notice. The notice sits inside the panel rather than once in the shell so that a screenshot of any single view carries the claim with it.

**Findings are borrowed, not invented.** Eighteen of the twenty-six code-safety findings are generated from `data/code-safety/targets/nodegoat.ground-truth.json`, this repository's own OWASP NodeGoat ground truth, keeping the real CWE, file and line. The remaining eight are departmental output beyond it and carry lower confidence. A fabricated finding on a real, well-known target is the one thing in this demo a security-literate reader could catch, and the repository already held the material that makes it unnecessary.

**Frame state never goes through React.** The store keeps `activity` and `bursts` as objects mutated in place and read from `useFrame`; only roster, runs, events and selection are React state. Each scene draws in a handful of calls — instanced meshes for nodes and file blocks, one additive point layer per glow, one line-segment layer per edge set — so 147 pulsing agents, 424 curved edges and a code city hold 60 fps on a laptop with the whole grade (bloom, vignette, chromatic aberration) on.

**The deck is a standalone Next.js program.** Its `tsconfig.json` is its own; it joins neither the host nor the client project-reference aggregate, because it is a browser application built by `next build` rather than a package the repository's `tsc -b` emits.

## Consequences

`pnpm run deck` and `pnpm --dir apps/command-deck build` work from a clean checkout with no key and no feed. `pnpm --dir apps/command-deck fixtures` regenerates every fixture deterministically from one seeded PRNG, so a reviewer can diff the data instead of trusting it.

Two facts the feed does not carry are derived deck-side and documented as such in the README: a finding's owning department, from its CWE through the table in `lib/departments.ts`, and its verification state, from whether the certificate's `unverified` list names it. If the feed later places a department on the finding, that table becomes dead code and should go.

`pnpm run constraints` reports four violations for this package that cannot be fixed from inside it. `scripts/check-workspace-constraints.ts` treats every `apps/*` directory as a release member — it must not be `private`, it must set `publishConfig.access`, its repository field must name its directory, and its name must appear in that script's `appPackageFiles` policy. A customer proof of concept is not a published package, so the manifest stays `private: true` and the gate stays red until the script grows a case for an app that is not published.

The scenes need WebGL 2 and have no 2D fallback. `prefers-reduced-motion: reduce` turns off the auto-orbit, the pulsing and the chromatic aberration, which is the accessibility floor, not a full alternative rendering.

## Alternatives considered

- **Wait for the feed server, then build against it.** The two halves are written in parallel against one written contract precisely so neither blocks the other; a front end that cannot start without its server also cannot demo without it.
- **Bundle the fixtures as imported JSON.** Simpler, and it would lose the thing that makes the replay convincing: a paced Server-Sent Events stream with reconnection, exercised by the same client code the live feed drives. Files on disk also stay reviewable as data.
- **A separate "demo mode" switch.** Two code paths through every view, one of which is only ever exercised in a meeting room. The fallback is instead a base URL, so the demo path is the production path.
- **Invent the code-safety findings.** Faster to write and indefensible in the room. The repository's NodeGoat ground truth already pins eighteen real issues to their lines at a named revision.
- **A 2D graph (SVG or canvas) for the enterprise.** It would carry the roster and the edges, and none of the reason a client believes the enterprise is real. The 3D scene is the deliverable, not decoration.
