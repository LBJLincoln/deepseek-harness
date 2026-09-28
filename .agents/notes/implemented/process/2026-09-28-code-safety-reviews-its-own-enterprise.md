# Agent Note: The Code Safety division reviews its own enterprise's code

Status: implemented

English | [中文](2026-09-28-code-safety-reviews-its-own-enterprise.zh.md)

## Problem

The Code Safety division holds 43 of the enterprise's 147 seats, and every review it had run read a deliberately vulnerable public application — [OWASP NodeGoat and dvja](../../../../data/code-safety/README.md) — scored against that application's documented defect list. None of those reviews could change anything in this repository: the findings describe someone else's code, and the division's work ended at a report. An enterprise whose seats do their real functions on this repository needs its security division to read the code the enterprise itself ships, and a finding it confirms there to become work that one of the enterprise's own seats fixes and the [ticket engine](../../../../data/enterprise/tickets/README.md) verifies.

This repository raises three problems the public targets never did. It has no ground truth, so a finding count has nothing to be read against. It is far too large for one review: the program driver refuses a target above 5,000 files, and a slice has to be chosen and pinned the way the public targets are pinned. And a confirmed finding needs an owner the queue accepts — for package code, a Harness Core steward seat whose `source` covers the file.

## Decision

The division's first engagement on its own enterprise reviews one bounded slice of the repository's attack surface, pinned as a target, on a copy carrying seeded canaries; every finding is triaged against the code, and every confirmed one becomes a ticket for the steward that owns the file.

- **The target is the four external-agent subagent providers.** [`targets/dsh-subagent-providers.target.json`](../../../../data/code-safety/targets/dsh-subagent-providers.target.json) pins `subagent-claude-code`, `subagent-codex`, `subagent-acp` and `subagent-dsh-sdk` — each package's `src/`, `package.json` and `README.md`, 24 files at `599da7580` — with the lock digest the program driver's own rule gives that tree. The slice was chosen by three tests together: the code runs code the harness did not write and parses what that process writes back across a process boundary; every file has a Harness Core steward seat in the roster; and one review of it fits in about thirty minutes. [The targets README](../../../../data/code-safety/targets/README.md) states the scope, what it leaves out, and how to reproduce the run.
- **Recall is read from canaries.** [`seed-defects.mjs`](../../../../data/code-safety/tools/seed-defects.mjs) plants into TypeScript: four catalogue entries anchored on a value read off an external process's wire message or on a module-level constant (log injection, `eval`, `RegExp` construction, a hard-coded fallback token), each inserted line checked by the TypeScript parser as one statement of its own, and a copy that leaves out `.git` so no department can read the planted lines from `git diff`. Eight canaries, two per class, were planted with the target file's seed; the answer key was held compressed outside the scratch tree for the whole run. The same work fixed the seeder's answer key, which named a site's original line whenever an insertion accepted later landed above it in the same file.
- **The run is the shipped composition, once.** `pnpm run code-safety` on the seeded copy with the Claude Code overlay, `sonnet`, the six default departments and the knowledge pack at digest `0ec2cc9b…` (the checklists iteration 3 kept), from this branch at a clean head. [`record-run.mjs`](../../../../data/code-safety/tools/record-run.mjs) `--seeded` records it like the NodeGoat runs and adds the answer key, the seed manifest and the scored reading to the record, digested with the rest.
- **Every finding is triaged against the code at the pinned revision** as confirmed, false positive, or canary; the table is in the targets README.
- **Every confirmed finding becomes one ticket** in the schema [`scripts/enterprise-tickets.ts`](../../../../scripts/enterprise-tickets.ts) validates, owned by the steward whose `source` README sits in the file's package, citing the finding's `path:line`, scoped to that package, and accepted by a focused spec the steward adds, which reproduces the flaw and therefore fails until the fix lands, plus the package's coverage run and the typecheck. A fix larger than one ticket becomes a ticket for its first step and says so.
- **The ledger records each seat's function.** `data/enterprise/ledger.jsonl` carries one `function` line per seat the [roster-evidence attribution](../../../../scripts/roster-evidence.ts) places the record's sessions on: each department's integrator seat and the program lead.

## Alternatives considered

**A whole-repository review.** Refused by construction: the driver locks every file under the target and refuses a tree above 5,000, and a sampled lock would report unchanged a file a department had edited outside the sample. Even under the limit, a review of the whole tree would run for hours and read most of it shallowly.

**The harness feed server, the MCP tool server or the ACP server.** Each parses or serves untrusted input, but no Harness Core steward's `source` covers `scripts/harness-feed.ts`, `packages/mcp/` or `packages/acp/`, so a confirmed finding there would have no seat to own its fix in the queue as it stands. They are the next targets once a seat owns them.

**Reviewing the unseeded tree and reading recall from the triage alone.** The triage says how many findings are real, not how many real defects the review missed; without canaries a clean report and a blind review read the same. The canaries cost the findings they draw — seven of the eleven here — and give the one number a client can read without a ground truth.

**Seeding with the JavaScript catalogue.** The target has no `.js` file and no `req.*` read; the JavaScript entries find no site. The TypeScript entries mirror the JavaScript classes on the inputs this code actually has: values an external process writes back.

**Committing each reproduction as a failing test.** A failing test on the shared branch breaks every check that runs the suite until the fix lands. The ticket carries the reproduction in its task and its acceptance runs the spec file the steward adds, so the check fails before the change and passes after it without the tree ever holding a red test.

## Consequences

**The division has read code its enterprise ships, with a reading that stands without a ground truth.** The run certified all six departments and the integration, the examiner passed, and 11 findings were released in 1,390 seconds. The triage confirmed none of them: seven cite planted lines and four state that an exactly pinned dependency is older than the registry's latest, with no advisory against any pinned version and the repository's lockfile outside the slice. The queue therefore gains no ticket from this target at this revision — a statement about 24 files read statically, bounded by what the report lists as not covered, not a certificate that the slice is free of defects.

**Canaries make every finding list noisier and one number readable.** A canary finding must never become a ticket, so the triage strips them first; seven of the eleven findings were canaries. In exchange the review has a recall reading: 6 of 8, 95% interval [0.409, 0.929].

**Three of the eight TypeScript canaries planted nothing reachable.** The TypeScript wire entries anchor on a declaration and the object it was read from, not on the value's type, and three sites held a value the code had already narrowed to an object, where `String()` yields the constant `[object Object]`. The injection department read all three and dismissed them for exactly that reason, so the raw reading understates the review: on the five canaries that carry a child-controlled value it read 5 of 5, 95% interval [0.566, 1.0]. A TypeScript seeding whose reading is taken at face value needs an anchor that proves the value is a string; until the catalogue has one, a TypeScript reading states both numbers.

**A slice without the lockfile turns version age into findings.** The dependencies department could not run `npm audit` on 24 files and reported four pinned versions as outdated; all four were false positives. A target that pins a slice of this repository should put the lockfile's entries for the slice's dependencies in scope, or tell the department where the lockfile is.

**Ownership decides what can be reviewed usefully.** Only package code a Harness Core steward owns can become a ticket today, so the surfaces with the most exposure outside `packages/` — the feed server, the MCP tool server, the ACP server — wait for a seat that owns them.

**The run kept to its target.** No department read another run's findings, the original of a planted file, or the answer key; the data department's `find /` for its reporting contract listed paths across the host and it read only its own worktree's copies, and the dependencies department's search for a lockfile in the target's parent directory found only the seeded copy.

## Verification

- `node data/code-safety/tools/seed-defects.cases.mjs` and `pnpm exec vitest run scripts/code-safety-seeding.spec.ts scripts/code-safety-redaction.spec.ts` pass; the case that places a later-accepted site above an earlier one fails against the seeder before its line fix.
- `pnpm run code-safety -- /home/user/enterprise-scratch/dsh-subagent-providers/repo --out .code-safety/dsh-self-review --model sonnet` ran once, from `0e9b0cb26` with a clean tree: program `program-cc53a346…`, 24 files locked under `a2da9923…`, outcome `released`, examiner exit 0, 1,390 seconds.
- `node data/code-safety/tools/record-run.mjs .code-safety/dsh-self-review 2026-09-28-dsh-self-review --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml --seeded /home/user/enterprise-scratch/dsh-subagent-providers` wrote the record: 15 files, 8 session logs, one example cloud key redacted from the secrets session, knowledge digest `0ec2cc9b…`, and a seeded reading of 6 of 8.
- `node data/code-safety/tools/seeded-recall.mjs data/code-safety/2026-09-28-dsh-self-review data/code-safety/2026-09-28-dsh-self-review/seeded.ground-truth.json` prints 6 of 8, [0.409, 0.929], with `SEED-006` and `SEED-007` missed.
- The seven `function` lines in `data/enterprise/ledger.jsonl` name the seats `attributeRun` from `scripts/roster-evidence.ts` gives the record's eight sessions, each with outcome `pass` and a path in the record as evidence.
- `pnpm exec vitest run scripts/enterprise-tickets.spec.ts` passes over the unchanged queue.
