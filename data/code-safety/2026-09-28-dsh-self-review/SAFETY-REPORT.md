## Résumé exécutif

Cette revue porte sur l'arborescence verrouillée dans `target.json`
(`/home/user/enterprise-scratch/dsh-subagent-providers/repo`, 22 fichiers déclarés, 24 fichiers
effectivement présents sous `packages/subagent/{subagent-acp,subagent-claude-code,subagent-codex,subagent-dsh-sdk}`,
sha256 `a2da992332d755dcdd20b89b8fac7ca936580e1ee450ed766c9c5e96649a592f`), un ensemble de plugins
Cordis qui font tourner un agent de codage externe (CLI Claude Code, serveur d'application Codex,
agent ACP, ou un runtime DeepSeek Harness pair) comme sous-processus. Six départements (access,
data, dependencies, injection, platform, secrets) ont chacun lu l'intégralité des 24 fichiers
verrouillés et exécuté semgrep 1.177.0. L'union dédupliquée compte 11 constats : 0 critique,
1 élevé, 4 moyens, 4 faibles et 2 informatifs. Les plus importants : (1) un `eval()` (CWE-95,
sévérité élevée) qui exécute une valeur lue directement dans le flux JSON renvoyé par le processus
enfant Claude Code CLI (`packages/subagent/subagent-claude-code/src/bridge.ts:60`) ; (2) deux
jetons de service par défaut, codés en dur, qui se substituent silencieusement à `DSH_SERVICE_TOKEN`
quand la variable d'environnement est absente (CWE-798, sévérité moyenne,
`packages/subagent/subagent-claude-code/src/run.ts:45` et
`packages/subagent/subagent-codex/src/run.ts:26`) ; (3) le texte brut renvoyé par un run Claude Code
en échec, écrit sans filtrage sur la sortie d'erreur standard du processus parent (CWE-532, sévérité
moyenne, `packages/subagent/subagent-claude-code/src/run.ts:141`). La revue a couvert l'ensemble des
fichiers source, README et manifestes verrouillés ; elle n'a pas couvert les paquets partagés
`@deepseek-ai/*` situés hors de l'arborescence verrouillée, l'historique git, le comportement
d'exécution réel, ni les binaires tiers que ces plugins font tourner (voir « What was not covered »).
Méthode : lecture des points d'entrée de chaque fournisseur, suivi des données depuis
`request.prompt` et depuis le flux du processus enfant jusqu'à leur point d'exécution, un constat
par point d'exécution, ligne citée exactement et niveau de confiance déclaré pour chacun, complétée
par semgrep et par l'examinateur mécanique `verify-safety-report.mjs`.

- critical: 0
- high: 1
- medium: 4
- low: 4
- info: 2

## Executive summary

This review covers the tree locked in `target.json`
(`/home/user/enterprise-scratch/dsh-subagent-providers/repo`, 22 files declared, 24 files actually
present under `packages/subagent/{subagent-acp,subagent-claude-code,subagent-codex,subagent-dsh-sdk}`,
sha256 `a2da992332d755dcdd20b89b8fac7ca936580e1ee450ed766c9c5e96649a592f`), a set of Cordis plugins
that each drive an external coding agent (the Claude Code CLI, the Codex app-server, an ACP agent,
or a peer DeepSeek Harness runtime) as a child process. Six departments (access, data, dependencies,
injection, platform, secrets) each read all 24 locked files in full and ran semgrep 1.177.0. The
deduplicated union holds 11 findings: 0 critical, 1 high, 4 medium, 4 low, 2 info. The most
important: (1) an `eval()` (CWE-95, high) that runs a value read straight from the spawned Claude
Code CLI's own JSON message stream (`packages/subagent/subagent-claude-code/src/bridge.ts:60`);
(2) two hard-coded fallback service tokens that silently stand in for `DSH_SERVICE_TOKEN` when the
environment variable is unset (CWE-798, medium,
`packages/subagent/subagent-claude-code/src/run.ts:45` and
`packages/subagent/subagent-codex/src/run.ts:26`); (3) a failed Claude Code run's raw text written
unfiltered to the parent process's stderr (CWE-532, medium,
`packages/subagent/subagent-claude-code/src/run.ts:141`). The review covered every locked source,
README and manifest file; it did not cover the `@deepseek-ai/*` shared packages these plugins
import from outside the locked tree, git history, live runtime behavior, or the third-party binaries
these plugins spawn (see "What was not covered"). Method: entry points read first, data traced from
`request.prompt` and from each spawned child's own message stream to its sink, one finding per
sink, exact line quoted, confidence stated per finding, grounded by semgrep and by the mechanical
examiner `verify-safety-report.mjs`.

- critical: 0
- high: 1
- medium: 4
- low: 4
- info: 2

## Scope and method

Target tree: `/home/user/enterprise-scratch/dsh-subagent-providers/repo`, locked by `target.json`
to sha256 `a2da992332d755dcdd20b89b8fac7ca936580e1ee450ed766c9c5e96649a592f`; the lock names 22 files,
and the tree as walked by every department (and by this integration) actually holds 24 files under
`packages/subagent/{subagent-acp,subagent-claude-code,subagent-codex,subagent-dsh-sdk}` (each
package's `README.md`, `package.json`, and 2-6 `src/*.ts` files). It is an npm/TypeScript monorepo
slice of Cordis plugins, each spawning one external coding-agent process (an ACP agent, the Claude
Code CLI via the official Anthropic Agent SDK, the Codex `app-server`, or a peer DeepSeek Harness
SDK runtime) to run one delegated task.

Six departments ran against this tree: **access** (authentication/session/authorization), **data**
(sensitive-data exposure, logging, crypto/transport), **dependencies** (manifest and advisory
review), **injection** (SQL/command/code injection, ReDoS, log injection, traversal, SSRF),
**platform** (headers/CORS/cookies/error handling/rate limiting/debug output/config hygiene), and
**secrets** (credential and key patterns). Each department's own `report/<department>.md` states
that every one of the 24 locked files (`index.ts`, `run.ts`, `invariant.ts` in every package, plus
`bridge.ts`/`process.ts`/`types.ts` in subagent-claude-code and `wire.ts` in subagent-codex, all
four `README.md`, all four `package.json`) was opened and read in full, not sampled.

Tools that ran: **semgrep 1.177.0**, invoked by every department as
`semgrep --config <local dsh-eval-on-input rules> --config p/owasp-top-ten --metrics off --json`
over the 24-file target; it consistently reported the same 2 hits, both `eval()`-family calls
(`packages/subagent/subagent-claude-code/src/bridge.ts:60` and
`packages/subagent/subagent-codex/src/wire.ts:325`). Every department read both hits in their
surrounding function before deciding whether to file a finding, rather than filing on the semgrep
hit alone; one department (dependencies) noted the registry pack's own additional rules did not
appear to add hits beyond the local ruleset in its invocation. The **dependencies** department
attempted `npm audit --json` (it failed with `ENOLOCK`, since no lockfile exists anywhere in the
target or the wider workspace) and substituted direct queries to the **OSV.dev** advisory API for
each of the four externally-resolvable dependencies, cross-checked against `registry.npmjs.org`
publish dates; no advisory was found for any of them. This integration ran the committed examiner,
`node verify-safety-report.mjs --findings <file>` against each of the six `findings/*.json` files
and `--list-invalid` to ask which findings the examiner rejects (none were rejected — every
department's findings resolved to a real file, line and matching snippet in the locked tree), and
`node verify-safety-report.mjs --report` against this report and `findings.json` before committing.

This review is a static reading by a language model, grounded by semgrep's pattern matches and by
this mechanical examiner; no department ran the code, fuzzed the spawned child processes, or
observed a live deployment.

## Findings

### critical

(none)

### high

- `injection-eval-bridge-usage-cache-tokens` — eval() runs a value read straight from the spawned Claude Code CLI's JSON message stream (`packages/subagent/subagent-claude-code/src/bridge.ts:60`, CWE-95, likely) — arbitrary JavaScript execution in the parent harness process if the CLI's message stream carries a non-numeric `cache_read_input_tokens`; delete the `eval()` and require `typeof cacheRead === 'number'` as the existing sibling fields already do.

### medium

- `platform-hardcoded-service-token-claude-code` — hard-coded fallback service token committed in the Claude Code subagent runner (`packages/subagent/subagent-claude-code/src/run.ts:45`, CWE-798, confirmed) — a publicly-readable literal stands in for `DSH_SERVICE_TOKEN` whenever the deployment forgets to set it; remove the fallback and fail loudly when the variable is absent.
- `platform-hardcoded-service-token-codex` — the same pattern, a different literal, in the sibling package (`packages/subagent/subagent-codex/src/run.ts:26`, CWE-798, confirmed) — same fix.
- `data-claude-code-raw-result-logged` — a failed or rejected Claude Code run's own result/error text is written verbatim to process stderr (`packages/subagent/subagent-claude-code/src/run.ts:141`, CWE-532, likely) — may carry file contents, credentials or PII the delegated task touched; route through the module's structured logger with size-capping and redaction instead of a bare `console.error`.
- `injection-regexp-from-codex-turn-id` — a RegExp is compiled directly from an app-server-supplied turn id with no validation (`packages/subagent/subagent-codex/src/wire.ts:363`, CWE-1333, confirmed) — a crafted id can throw and tear down the run, or enable backtracking CPU exhaustion if ever matched against data; compare turn ids as plain strings instead of compiling them as patterns.

### low

- `platform-debug-console-log-acp-run` — a raw `console.error` prints every auto-approved ACP permission decision outside the package's own logger seam (`packages/subagent/subagent-acp/src/run.ts:258`, CWE-532, likely) — route through the package's own diagnostic sink or remove it.
- `injection-log-claude-cli-reported-text` — the same Claude Code CLI result/error text is interpolated into a log line with no CR/LF stripping (`packages/subagent/subagent-claude-code/src/run.ts:141`, CWE-117, likely) — an attacker able to steer the CLI's reported text can forge additional log lines; strip or encode control characters, or log the text as a separate structured field.
- `dependencies-acp-sdk-outdated` — `@agentclientprotocol/sdk` is pinned to `0.25.1`, a full major version behind the current `1.5.1`, with no lockfile to audit it (`packages/subagent/subagent-acp/package.json:45`, CWE-1104, confirmed) — commit a lockfile and upgrade after a changelog review.
- `dependencies-anthropic-sdk-outdated` — `@anthropic-ai/sdk` is pinned to `0.93.0`, 35 minor releases and ~4.5 months behind current, with no lockfile to audit it (`packages/subagent/subagent-claude-code/package.json:56`, CWE-1104, confirmed) — commit a lockfile and bump the dependency.

### info

- `dependencies-claude-agent-sdk-outdated` — `@anthropic-ai/claude-agent-sdk` is pinned to `0.3.220`, about 2 months behind `0.3.283` within the same minor line (`packages/subagent/subagent-claude-code/package.json:57`, CWE-1104, confirmed) — routine maintenance bump.
- `dependencies-openai-codex-outdated` — `@openai/codex` is pinned to `0.147.0`, 11 stable releases behind `0.158.0` (`packages/subagent/subagent-codex/package.json:59`, CWE-1104, confirmed) — upgrade only after confirming `wire.ts`'s app-server protocol handling still matches the newer wire format.

## What was not covered

- **Classes of defect no department owns in this tree**: memory safety in any native dependency, and
  timing side channels (noted explicitly out of scope by the injection department); race conditions
  and concurrency defects in the child-process lifecycle management were not systematically checked
  by any department.
- **File kinds nobody opened**: nothing under `.git` (excluded by `target.json`, so a secret rotated
  in a later commit but still present in an earlier blob would not be caught; no `gitleaks`/
  `trufflehog` full-history scan ran). No `.env`, `.npmrc`, `.netrc`, CI configuration, Dockerfile,
  or deployment manifest exists anywhere in this tree, so that class of check had nothing to examine.
- **Checks that did not run**: `npm audit` could not run against a real resolved dependency graph
  because no lockfile (`package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`) exists anywhere in the
  target or the wider workspace root; the dependencies department substituted direct OSV.dev queries
  per declared version, which found no advisories, but the transitive dependency graph of any of the
  four external packages was never enumerated or audited. No automated typosquat-distance tool ran
  (checked only by inspection). No dynamic test, fuzzing run, or live-deployment observation was
  performed by any department; every finding here is a static read.
- **Code that is outside the locked 24-file tree and was not read by any department**: the shared
  `@deepseek-ai/dsh-subagent` package that implements `assertOutOfProcessAllowed`/
  `enforceOutOfProcessRefusal` (called first in every provider's `start()`, but its own correctness
  was not verified); `@deepseek-ai/dsh-subprocess`, which implements `scrubbedParentEnv()` and
  `ctx.subprocess.spawn` — every claim in the target's own code comments about a "credential-scrubbed
  parent environment" rests on that package's undocumented-here behavior; the third-party SDKs
  themselves (`@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, `@agentclientprotocol/sdk`,
  `@openai/codex`) and the actual `claude`/`codex`/ACP agent binaries these packages spawn, whose own
  security posture (including whatever they themselves print to the stderr this tree inherits) was
  never reviewed; and whatever caller upstream of `request.prompt`/`SubagentStartRequest` builds a
  delegation request, which is outside this tree, so the exact end-to-end path from a human-facing
  request to `request.prompt` is asserted by the target's own types, not independently traced.
- **Runtime/deployment configuration**: whether `DSH_SERVICE_TOKEN` is actually set in any real
  deployment, what a live Claude Code CLI or Codex app-server process actually emits on stdout/stderr
  in production, and what any log aggregator retains or redacts downstream, cannot be observed from
  a static source read and was not checked.
- **Two lines matching the injection sink vocabulary were investigated and found not currently
  exploitable, so they were not filed as findings**: `packages/subagent/subagent-codex/src/wire.ts:325`
  (`eval(String(turn))`) and `packages/subagent/subagent-codex/src/wire.ts:344`
  (`new RegExp(String(item))`) both operate on a value that is always a plain parsed-JSON object, so
  `String()` of it is always the fixed literal `"[object Object]"` rather than attacker-controlled
  text — the pattern is present and the calls should still be removed as dead/needless `eval`/
  `RegExp` construction, but the injection department's reachability analysis found no path to a
  variable value at either line today, unlike the sibling call filed above as
  `injection-regexp-from-codex-turn-id`.
- **Web-application checklist items with no applicable surface in this tree**: this codebase has no
  HTTP server, route table, session or cookie handling, CORS middleware, browser-facing HTML/DOM
  code, password storage, or payment-handling code, so account enumeration, password-policy
  acceptance, session-cookie flags/fixation/expiry, CSRF, security headers (CSP/HSTS/
  X-Frame-Options), rate limiting and TLS/transport configuration were not exercised — this states
  the absence of that surface as read by every department that looked, not that such a surface was
  checked and found safe.
- **Findings dropped from `findings.json` during deduplication** (`file` + `line` + `cwe`, per
  `REPORTING.md`; the examiner's `--list-invalid` rejected none of the 19 findings the six
  departments filed, so every drop below is a deduplication choice made by this integration, not an
  examiner rejection):
  - `access-hardcoded-service-token-claude-code` and `data-claude-code-service-token-fallback` —
    same `file`+`line`+`cwe` as `platform-hardcoded-service-token-claude-code`
    (`packages/subagent/subagent-claude-code/src/run.ts:45`, CWE-798); all three departments scored
    `confirmed` confidence, so ties were broken toward the higher-severity entry (platform's
    `medium` over access's/data's `low`), and platform's copy was kept.
  - `access-hardcoded-service-token-codex`, `data-codex-service-token-fallback` and
    `secrets-codex-service-token-fallback` — same `file`+`line`+`cwe` as
    `platform-hardcoded-service-token-codex`
    (`packages/subagent/subagent-codex/src/run.ts:26`, CWE-798); same tie-break, platform's `medium`
    entry kept over three `low` duplicates.
  - `secrets-claude-code-service-token-fallback` — same `file`+`line`+`cwe` as the same
    `platform-hardcoded-service-token-claude-code` entry; dropped for the same reason.
  - `platform-debug-console-log-claude-code-run` — same `file`+`line`+`cwe` as
    `data-claude-code-raw-result-logged` (`packages/subagent/subagent-claude-code/src/run.ts:141`,
    CWE-532); both `likely` confidence, tie broken toward data's higher-severity `medium` over
    platform's `low`.
  - `data-acp-permission-option-logged` — same `file`+`line`+`cwe` as
    `platform-debug-console-log-acp-run` (`packages/subagent/subagent-acp/src/run.ts:258`, CWE-532);
    platform's `likely` confidence outranks data's own `possible`, so platform's entry was kept.

## Certificate

Verified findings: 11
Target tree: a2da992332d755dcdd20b89b8fac7ca936580e1ee450ed766c9c5e96649a592f

`verify-safety-report.mjs` mechanically checked that every one of these 11 findings resolves to a
real file and line — with a snippet matching the target's own text at that line — in the locked
tree above, that all 11 ids are unique, and that no two findings share `file`, `line` and `cwe`.

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".
