# Agent Note: The program workflow reviews code it did not write

Status: implemented

English | [中文](2026-09-19-code-safety-program.zh.md)

## Problem

Both programs the workflow had run delivered something the harness itself produced. The [self-assessment run](../../../../data/proving-ground/README.md) of 2026-09-08 wrote a document about this repository, and the [csv-tools program](2026-09-19-program-workflow-builds-software.md) built a command line against a committed test suite. In both, the thing being certified and the thing doing the work were in one tree: a check ran the delivered code, and passing it meant the deliverable behaved.

A customer's first question is different. They hand over a repository and ask what is wrong with it, and the deliverable is a claim about a tree the program must not touch. A test suite cannot settle that claim, because there is nothing to run: the output is prose, and prose about code is exactly where a language model is cheapest to believe and hardest to check. The failure mode is not a department that writes nothing — it is a department that writes a plausible finding at a line that does not say what it claims, or a report whose executive summary counts differently from its own findings, or a review that concludes the code is fine.

## Decision

[`examples/headless-agent/tests/fixtures/program-code-safety/`](../../../../examples/headless-agent/tests/fixtures/program-code-safety/README.md) is a program whose deliverable is a report about a **target tree** passed as a path. Six departments — `secrets`, `injection`, `access`, `data`, `dependencies`, `platform` — read that tree from their own worktree of a separate **report repository** and each commit `findings/<department>.json` and `report/<department>.md`. The integration merges the six branches and writes `SAFETY-REPORT.md` and `findings.json`.

Every finding is a JSON object carrying `file`, `line`, an optional `endLine`, and `snippet` — the target's own text at those lines. `seed/verify-safety-report.mjs` is in the base commit, so no department can change what measures it, and it is each department's own goal check: it resolves the file in the locked tree, checks the line is inside it, and compares the snippet with the target's text once whitespace is normalized. A finding whose citation does not hold fails the department that made it, before any report exists.

Over the merged head the same examiner decides four more things: every finding id in `findings.json` is cited under `## Findings` and every `<file>:<line>` in the report resolves; both the French and the English summary state a `- <severity>: <count>` line for all five severities and those counts are the union's; every id a department reported and the union dropped is named under `## What was not covered`; and the certificate states the verified count, the target digest, and verbatim the sentence that the review does not certify the absence of vulnerabilities. `no vulnerabilities`, `free of vulnerabilities`, `is secure`, `safe to deploy` and `fully audited` are refused wherever they appear.

### The target is locked, not mounted read-only

The driver walks the target before the composition loads and commits `target.json` — the absolute root, the excluded directories, a SHA-256 per file and one over all of them — into the base commit. The examiner re-hashes every locked file on every run, so a department that wrote into the target fails the program rather than releasing a report about a tree that no longer exists.

That is enforcement by detection. Nothing in this composition mounts the target read-only: the read barrier denies reads and the fs provider's `cwd` is a resolution default rather than containment, so the capability that would refuse the write does not exist here. Saying so is part of the design, not an omission: the report states what the review covered, and the record states what enforced it.

### The dropped finding is disclosed by the examiner, not by good intentions

`verify-safety-report.mjs --findings <file> --list-invalid` prints the failing ids and exits 0. The integration runs it over every department's file, drops what it names, and discloses each one under `## What was not covered`; the `--report` mode then refuses a union that omits an id no section names. The disclosure rule is therefore mechanical on both sides — the integration cannot quietly drop a department's finding, and it cannot quietly keep one that does not hold.

### Two compositions, one spec

`cordis.yml` scripts every session on a `cli-mock` route against the fixture's own `sample-target/`, and `overlays/claude-code.cordis.yml` replaces that route with the operator's Claude Code installation, raises concurrency to three departments, and mounts `data/knowledge/code-safety/` as a skill root when the repository carries one. The scripted findings state a file and a line and nothing else: each snippet is read out of the target at stream time, from the bytes the examiner will compare it against, so the keyless half cannot pass by carrying a copy of the tree.

## Alternatives considered

**Let the departments deliver into the target repository.** The natural shape for a workflow that certifies a commit, and wrong here: the deliverable is a claim about the customer's tree as it stands, and a program that commits into it certifies its own edit. Two trees also make the read-only rule statable at all.

**Verify findings with a static analyser instead of a committed examiner.** A scanner decides whether a pattern is present, not whether a sentence about line 73 is true. Semgrep is composed the other way round here — its hits are places to read, and the examiner is what every finding must survive.

**Require each department to report at least one finding.** It makes the keyless fixture tidy and buys a finding by inventing it. A department that found nothing writes `[]` and says so in its section; the examiner checks citations, and the only defence against a fabricated one is that fabricating is not rewarded.

**Give the integration the union as a program-computed artefact.** The program could merge the six findings files itself and hand the integration a finished `findings.json`. That would move the deduplication and the drop decision out of a session and into the driver, where no log records the judgement, and it would make the integration a formatter. The union is work, and work that is not in a session log is not reviewable.

**Score the report against a known-vulnerability list.** A recall number against a ground truth is the obvious measure for a review, and it measures the review rather than the workflow. It also cannot be run on a customer's own repository, which is the case this program exists for. The ground truth belongs beside the record as a separate reading, not inside the release gate.

## Consequences

A report this program releases carries one claim and states it: every listed finding was verified to exist at the cited line, over the files the departments read. It is not an audit, nothing was executed, and `confidence` is the analyst's own account of how far they traced a path — the examiner checks the citation, never the reasoning behind it.

The examiner's failure text is the only instruction a session receives between attempts, so `evidenceMaxChars` is raised to the verification domain's own `maxTextChars` and every failure message names the exact expected string. A run therefore spends rounds on report structure that a looser gate would not; the integration's first attempt always fails, because its checks run before its first turn and the merge carries no report yet.

`MAX_TARGET_FILES` in the driver bounds what can be locked. A tree above it is refused rather than sampled: a sampled lock would report a target unchanged that a department had edited outside the sample, which is worse than refusing to run.

One model serves every session of a run. The frozen spec carries no per-goal model and `agent-default-model` is process-wide, so a run cannot staff its departments on one model and its integration on another; the [program README](../../../../packages/improvement/program/README.md#known-limitations-and-deferred-work) already records that gap, and this fixture is now a consumer that wants it closed.
