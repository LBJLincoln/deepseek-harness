# Code-safety targets

English | [中文](README.zh.md)

A target file pins what a code-safety review reads: the repository, the revision, and, for a target without a documented defect list, the paths in scope and how recall is estimated instead. A record under [`data/code-safety/`](../README.md) is read against the target it names; nothing here is part of the release gate.

| File | Target | Recall read against |
| --- | --- | --- |
| [`nodegoat.ground-truth.json`](nodegoat.ground-truth.json) | OWASP NodeGoat at `c5cb68a` | its 18 documented defects |
| [`dvja.ground-truth.json`](dvja.ground-truth.json) | dvja at `597ece1` | its 14 documented defects |
| [`dsh-subagent-providers.target.json`](dsh-subagent-providers.target.json) | this repository's four external-agent subagent providers at `599da7580` | eight planted canaries |

## dsh-subagent-providers: the enterprise's own code

The four Harness Core packages that start another agent product in a subprocess and drive it over that product's wire: [`subagent-claude-code`](../../../packages/subagent/subagent-claude-code/README.md) (the Claude Agent SDK and the `claude` CLI, either on the product's own tools or bridged onto the harness's), [`subagent-codex`](../../../packages/subagent/subagent-codex/README.md) (`codex app-server` over JSON-RPC), [`subagent-acp`](../../../packages/subagent/subagent-acp/README.md) (any Agent Client Protocol agent) and [`subagent-dsh-sdk`](../../../packages/subagent/subagent-dsh-sdk/README.md) (a child harness runtime over the SDK's JSON-RPC). Each one runs code the harness did not write in the delegating session's workspace, parses what that process writes back across a process boundary, answers its permission and input requests with no human present, and decides which environment variables and which tools reach it. A compromised or prompt-injected child reaches these lines first. Each package has one Harness Core steward seat in the [roster](../../enterprise/README.md), so a confirmed finding has an owner in the [ticket queue](../../enterprise/tickets/README.md).

The paths in scope are each package's `src/`, `package.json` and `README.md` at revision `599da758095bd221b6747d5b5631592b8620efe4`: 24 files, 3,552 lines, locked under the digest the target file states, computed by the program driver's own rule. Out of scope, and read only where a finding's call site needs them: the packages' tests, the shared [`dsh-subagent`](../../../packages/subagent/subagent/README.md) service that resolves the child's working directory and policy, the [subprocess seam](../../../packages/subprocess/subprocess/README.md) that scrubs the environment and owns the process tree, the MCP tool server the bridge serves, and the external products themselves. The slice is sized for one review in about thirty minutes; NodeGoat's 111 files took 1,225 to 1,730 seconds.

### Recall without a ground truth

No one has counted this code's defects, so the review runs on a copy carrying eight synthetic defects and is scored on how many of them it finds ([the method](../README.md#recall-without-a-ground-truth-seeded-defects)). The copy is planted by [`seed-defects.mjs`](../tools/seed-defects.mjs) with the target file's `seeding` parameters: its four TypeScript catalogue entries — a stderr line carrying a value read off the child's wire (CWE-117), `eval` of such a value (CWE-95), a `RegExp` compiled from one (CWE-1333), and a module-level token with a hard-coded fallback (CWE-798) — two sites each. Every planted line is one statement the TypeScript parser reads as standing alone, and the copy carries no `.git`. While the review runs, the answer key is kept compressed outside the scratch tree, because departments have a shell and have read other runs' files before; the originals of the planted files remain on the same host in every checkout of this repository, which no seeding can hide.

### Reproducing a review

```sh
git clone --no-checkout <this repository> target && git -C target sparse-checkout set --no-cone <each path of the target file, with a leading />
git -C target checkout --detach 599da758095bd221b6747d5b5631592b8620efe4
node data/code-safety/tools/seed-defects.mjs target seeded --language typescript --seed dsh-self-review-2026-09-28 --n 8 --max-per-entry 2
pnpm run code-safety -- seeded/repo --out .code-safety/dsh-self-review --model sonnet
node data/code-safety/tools/record-run.mjs .code-safety/dsh-self-review <date>-dsh-self-review --composition examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml --seeded seeded
```

`--seeded` copies the answer key and the seed manifest into the record and writes `seeded-recall.json`, the score of the released findings against them.

### The 2026-09-28 review and its triage

[`2026-09-28-dsh-self-review`](../2026-09-28-dsh-self-review/manifest.json) ran the shipped composition once: six departments certified, the integration certified on its second attempt, the examiner passed, 11 findings released in 1,390 seconds. Every finding was read against the code at `599da7580` and sorted into one of three kinds: a canary (it cites a planted line), a false positive (the code does not have the defect it states), or confirmed.

| Finding | Cites | Triage |
| --- | --- | --- |
| `injection-eval-bridge-usage-cache-tokens` | `subagent-claude-code/src/bridge.ts:60` | canary `SEED-002` |
| `platform-hardcoded-service-token-claude-code` | `subagent-claude-code/src/run.ts:45` | canary `SEED-003` |
| `data-claude-code-raw-result-logged` | `subagent-claude-code/src/run.ts:141` | canary `SEED-004` |
| `injection-log-claude-cli-reported-text` | `subagent-claude-code/src/run.ts:141` | canary `SEED-004` |
| `platform-hardcoded-service-token-codex` | `subagent-codex/src/run.ts:26` | canary `SEED-005` |
| `injection-regexp-from-codex-turn-id` | `subagent-codex/src/wire.ts:363` | canary `SEED-008` |
| `platform-debug-console-log-acp-run` | `subagent-acp/src/run.ts:258` | canary `SEED-001` |
| `dependencies-acp-sdk-outdated` | `subagent-acp/package.json:45` | false positive |
| `dependencies-anthropic-sdk-outdated` | `subagent-claude-code/package.json:56` | false positive |
| `dependencies-claude-agent-sdk-outdated` | `subagent-claude-code/package.json:57` | false positive |
| `dependencies-openai-codex-outdated` | `subagent-codex/package.json:59` | false positive |

The four dependency findings state that an exactly pinned version is older than the registry's latest and that no lockfile exists to audit it. No advisory affects any of the four pinned versions — the department's own OSV queries found none, and neither did the npm advisory database on the day of the review — and the repository's root `pnpm-lock.yaml`, outside the slice, resolves all four. `@openai/codex` is a test-only dependency whose `0.147.0` is the protocol baseline the Codex provider's README documents; production runs the `codex` installed on the host, not this package. Age without an advisory is not the defect CWE-1104 names, so none of the four is confirmed.

No released finding is confirmed. Reading the code for the triage found one defect the review did not report: on Windows the Codex provider spawns the bare names `cmd.exe` and `codex` (`subagent-codex/src/run.ts:36-42`), and the Claude Code provider's batch shim the bare `cmd.exe` (`subagent-claude-code/src/process.ts:59-65`), each with the delegating session's workspace as the child's working directory, and libuv's Windows spawn looks for a bare file name in that directory before any PATH directory, so a workspace holding `cmd.exe` or `codex.cmd` runs it in place of the product (CWE-427). No canary models that class, so it is a plain miss of this review. The triage filed it for the two stewards as [T-0040](../../enterprise/tickets/T-0040.json) and [T-0041](../../enterprise/tickets/T-0041.json) in the [queue](../../enterprise/tickets/README.md). Beyond it, the review's silence is a statement about 24 files read statically, not a certificate that they hold no other defect: the report's own `## What was not covered` names the shared subagent service, the subprocess seam, the SDKs and the spawned products as unread.

The canary reading is 6 of 8, Wilson 95% interval [0.409, 0.929]. Three canaries planted nothing reachable: `SEED-001` (`String(allow)`), `SEED-006` (`eval(String(turn))`) and `SEED-007` (`new RegExp(String(item))`) sit on values the code has already narrowed to an object or `undefined`, so `String()` yields a constant (`[object Object]`) that no child can shape. The injection department read all three and dismissed them for exactly that reason in its report; `SEED-001` counts as caught only because data and platform filed its line as a stray `console.error`. On the five canaries that carry a value the child controls — a token count, a result text and a turn id off the wire, and two hard-coded tokens — the review caught 5 of 5, Wilson 95% interval [0.566, 1.0]. The TypeScript catalogue entries anchor on a declaration's name and the object it was read from, not on its type; a seeding that must plant only reachable defects needs an anchor that proves the value is a string.
