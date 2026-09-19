# code-safety: a program that reviews someone else's code

English | [中文](README.zh.md)

A [program](../../../../../packages/improvement/program/README.md) whose deliverable is a report about a repository the harness did not write: six security departments read one target tree in parallel, each on its own branch and session, and an integration merges their findings into one report that an examiner committed before any of them started decides. The [csv-tools program](../program-csv-tools/README.md) builds software and is measured by a test suite; this one produces a document and is measured by whether every sentence of it resolves in the tree it claims to describe.

## The two trees

A run has a **target tree** — the customer's application, passed as a path and never written to — and a **report repository**, which the driver mints and the program delivers into. Departments read the first and commit into the second. Nothing the program does changes the target, and nothing it claims about the target is taken on trust: the base commit carries `target.json`, a SHA-256 of every file under review, and the committed examiner re-hashes all of them on every run. A department that edited the target fails the program instead of releasing a report about a tree that no longer exists.

| Department | Subject | Preset |
| --- | --- | --- |
| `secrets` | hard-coded credentials, tokens and keys, leaked `.env` and configuration | [`presets/secrets`](presets/secrets/agent.cordis.yml) |
| `injection` | SQL, NoSQL, command, template and code injection, XSS, path traversal | [`presets/injection`](presets/injection/agent.cordis.yml) |
| `access` | authentication, session handling, authorization, IDOR, CSRF | [`presets/access`](presets/access/agent.cordis.yml) |
| `data` | sensitive-data exposure, PII in logs, cleartext transport, weak crypto, password storage | [`presets/data`](presets/data/agent.cordis.yml) |
| `dependencies` | vulnerable and outdated packages, from `npm audit --json` or the manifest | [`presets/dependencies`](presets/dependencies/agent.cordis.yml) |
| `platform` | headers, CORS, cookies, error handling, rate limiting, misconfiguration, client-side code | [`presets/platform`](presets/platform/agent.cordis.yml) |
| integration | merges the six branches and writes the report | [`presets/integrating`](presets/integrating/agent.cordis.yml), the roster default |

No department depends on another, so a real run works three at a time. Each commits `findings/<department>.json` and `report/<department>.md` and nothing else; the integration writes `SAFETY-REPORT.md` and `findings.json`. [`seed/REPORTING.md`](seed/REPORTING.md) is the whole contract between them and is the first file every session reads.

Departments may run `semgrep --config semgrep/ --metrics off --json <path>` against the [local rules](semgrep/code-safety.yml) this fixture ships — eval, interpolated `child_process`, string-built SQL and `$where`, HTML sinks, weak hashes, hard-coded secrets, permissive CORS, insecure cookies, cleartext endpoints. The rules are local so a run needs no registry; a real run may name registry packs beside them. A scanner hit is a place to read, never a finding.

## What a finding has to be

```json
{ "id": "…", "cwe": "CWE-…", "owasp": "…", "severity": "critical|high|medium|low|info",
  "confidence": "confirmed|likely|possible", "title": "…", "file": "…", "line": 1,
  "endLine": 2, "snippet": "…", "evidence": "…", "impact": "…", "fix": "…", "references": [] }
```

[`seed/verify-safety-report.mjs`](seed/verify-safety-report.mjs) is in the base commit, so no department can change what measures it. It refuses a finding whose `file` is not in the locked tree, whose `line` is outside that file, or whose `snippet` is not what the target reads at those lines once whitespace is normalized; and it refuses a `cwe` that is not `CWE-<number>`, a severity or confidence outside the two enums, and an empty `title`, `evidence`, `impact` or `fix`. Each department's goal is measured by exactly that command over its own file, so a fabricated citation fails the department that made it rather than the report.

Over the merged head it decides four more things.

- **The report resolves.** Every id in `findings.json` is cited under `## Findings`, and every `<file>:<line>` written anywhere in the report resolves in the target.
- **The summaries state what the union holds.** `## Résumé exécutif` and `## Executive summary` each carry a `- <severity>: <count>` line for all five severities, and the counts must be the counts `findings.json` actually has.
- **Nothing is dropped silently.** Every id any `findings/<department>.json` carries and `findings.json` does not must be named under `## What was not covered`. The integration learns which ones those are by asking the examiner: `verify-safety-report.mjs --findings <file> --list-invalid` prints the failing ids and exits 0.
- **The report claims no more than the review supports.** The certificate states the verified count and the target digest and carries, verbatim, the sentence that this review does not certify the absence of vulnerabilities. `no vulnerabilities`, `free of vulnerabilities`, `is secure`, `safe to deploy` and `fully audited` are refused wherever they appear, and so is leftover template text.

A department that found nothing writes `[]` and says so in its section. Requiring a finding would buy one by inventing it.

## What certifies a release

The three rules the [csv-tools program](../program-csv-tools/README.md#what-certifies-a-release) runs under hold here too. The examiner is committed before any department starts and re-run by the integration over the merged head; a department is never measured over a worktree carrying work no commit carries, which the scripted `platform` department demonstrates by leaving its first attempt uncommitted; and each `program/goal { status: certified }` states the commit and `HEAD^{tree}` its certificate covers, which the integration merges only while the branch still points there. The integration session runs denied the program's whole worktrees root, so it cannot read a department worktree while it writes the report.

## The two compositions

[`cordis.yml`](cordis.yml) is the keyless half: every session runs on the `cli-mock` route registered by [`code-safety-llm.ts`](code-safety-llm.ts), against the committed [`sample-target/`](sample-target) — a small application with a string-built query, a `$where`, an `eval`, a hard-coded secret, an innerHTML sink, unauthenticated routes, MD5 passwords and a wildcard CORS header. The scripted findings state a file and a line and nothing else: each `snippet` is read out of the target at stream time, from the bytes the examiner will compare it against, so the route cannot pass by carrying a copy of the tree and a sample target edited without its findings being updated fails the run.

[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) is the real one: the same composition with the scripted route disabled, the operator's Claude Code installation in its place, three departments at a time, and `data/knowledge/code-safety/` mounted as a skill root when the repository carries one. `implementer` stays `route`, so the program drives each department turn by turn and the department's own session holds every step it took.

One model serves every session of a run. The frozen spec carries no per-goal model and `agent-default-model` is process-wide, so a run cannot staff its departments and its integration differently; `--model` picks the one both use.

## Running it keyless

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-code-safety.e2e.ts
```

The e2e is [`examples/headless-agent/tests/program-code-safety.e2e.ts`](../../program-code-safety.e2e.ts). It asserts the ledger and the two signatures, the six certificates and their caps, the directive the `platform` department earned, the integration's failed-then-passed attempts and its three checks, the exact file list of the released tree, the sixteen finding ids, the per-severity counts the report states, and — as a negative case over the same committed examiner — that a finding whose line moved is refused and named by `--list-invalid`.

## Running it for real

```sh
pnpm run code-safety -- /path/to/target [--out <dir>] [--model sonnet|opus]
```

That seeds the report repository under `<out>` (by default `.code-safety/<target>-<timestamp>/`, which the repository ignores), boots the overlay, and prints the department ledger, the examiner's verdict and the paths of the released `SAFETY-REPORT.md` and `findings.json`. It needs the `claude` CLI installed and logged in, and no `DEEPSEEK_API_KEY`. It runs the driver from TypeScript source under tsx, so no build is needed; only a `DSH_EXAMPLE_MODE=lib` launch, which is CI's, requires `pnpm run build:lib:host` first.

While it runs, `<out>/.sessions/` fills with one log per session — the ledger, the six departments and the integration — and the driver writes its single result line to `<out>/stdout.jsonl` when the program ends. Record it under `data/code-safety/` the way [the run table](../../../../../data/code-safety/README.md) states.

## What this program does not do

It reads. No route is called, no payload is sent, and no finding it reports is a demonstrated exploit: `confidence` is the analyst's own claim about how far they traced the path, and the examiner checks the citation rather than the reasoning. It covers the files the departments opened, which is what `## Scope and method` has to state and what `## What was not covered` has to bound.

The target's read-only claim is enforced by detection, not by the kernel: nothing in this composition mounts the target read-only, so a department could write into it, and what stops that from reaching a release is the committed lock the examiner re-checks. `MAX_TARGET_FILES` in [`driver.ts`](driver.ts) bounds what can be locked at all — a tree above it is refused rather than sampled, because a sampled lock would report a target unchanged that a department had edited outside the sample.
