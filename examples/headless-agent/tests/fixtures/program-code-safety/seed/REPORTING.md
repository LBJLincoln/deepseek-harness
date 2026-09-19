# How this program reports what it found

This worktree is the **report repository**. The code under review is the **target tree**, which is somewhere else on this host: `target.json` beside this file states its absolute path, the files it covers, and the SHA-256 the whole tree locks to.

The target is read-only for every session of this program. `verify-safety-report.mjs` re-hashes every locked file on every run, so a target a department edited fails the program instead of releasing a report about a tree that no longer exists.

## This file and the skills

When the deployment mounts the code-safety knowledge pack, its `review-method`, `severity-and-evidence` and `report-template` skills own the craft: how to read a codebase, how to score a severity, what evidence has to name, and how the report reads. Follow them.

This file owns what `verify-safety-report.mjs` mechanically decides, and it is binding wherever the two differ in form. There is one such place and it is stated below: the counts each summary carries are written as `- <severity>: <count>` lines so the examiner can compare them with the union, which is the machine-readable form of the skill's "counts per severity".

## What a department delivers

Two files, both committed on the department's own branch:

- `findings/<department>.json` — a JSON array of findings, `[]` when the department found nothing.
- `report/<department>.md` — the department's own prose: what it looked at, what it found, and what it did not reach.

Nothing else. Do not write `SAFETY-REPORT.md`, `findings.json`, `target.json` or `verify-safety-report.mjs`: the first two are the integration's, and the last two are the examiner.

## The evidence rule

A finding without a file and a line is not a finding. Quote the exact line you cite; `verify-safety-report.mjs` compares your `snippet` with the target's own text at that line, ignoring only whitespace, and refuses the whole file when they differ.

Prefer three findings you have read the code for over twelve a pattern matched. `confidence` is what you actually know: `confirmed` when you read the sink, the source and the path between them; `likely` when the sink is dangerous and the source is plausibly attacker-controlled; `possible` when the pattern is there and the reachability is not established.

## The finding

```json
{
  "id": "secrets-cookie-secret",
  "cwe": "CWE-798",
  "owasp": "A07:2021 Identification and Authentication Failures",
  "severity": "high",
  "confidence": "confirmed",
  "title": "Session cookie secret is hard-coded in the committed configuration",
  "file": "config/env/all.js",
  "line": 8,
  "snippet": "cookieSecret: \"session_cookie_secret_key_here\",",
  "evidence": "The value is a literal in a committed file and is the secret express-session is configured with.",
  "impact": "Anyone with the repository can forge a session cookie and authenticate as any user.",
  "fix": "Read the secret from the environment and rotate the committed value.",
  "references": ["https://cwe.mitre.org/data/definitions/798.html"]
}
```

| Field | Rule |
| --- | --- |
| `id` | letters, digits, dots, dashes or underscores, unique across the whole program; prefix it with your department or use the pack's `SEC-<n>` numbering. |
| `cwe` | `CWE-<number>`. |
| `owasp` | the OWASP Top 10 category, named. |
| `severity` | `critical`, `high`, `medium`, `low` or `info`. |
| `confidence` | `confirmed`, `likely` or `possible`. |
| `title` | one line a reader can act on. |
| `file` | path relative to the target root, exactly as `target.json` lists it. |
| `line` | 1-based line in that file. |
| `endLine` | optional last line when the finding spans several; `snippet` then quotes all of them. |
| `snippet` | the target's own text at those lines, verbatim. |
| `evidence` | why this line is the vulnerability, naming what you read. |
| `impact` | what an attacker gets. |
| `fix` | what to change. |
| `references` | array of URLs or identifiers; may be empty. |

## Checking your own work before you commit

```sh
node verify-safety-report.mjs --findings findings/<department>.json
```

That is the same command your goal is measured by. Run it, fix what it names, then commit everything — work left uncommitted is not delivered and is not measured.

## What the integration delivers

The integration merges every department branch and then writes two files of its own.

`findings.json` is the union of every `findings/<department>.json`, deduplicated by `file` + `line` + `cwe`, keeping the entry with the higher `confidence`. Before writing it, ask the examiner which findings do not hold:

```sh
for f in findings/*.json; do node verify-safety-report.mjs --findings "$f" --list-invalid; done
```

Every id that command prints is dropped from `findings.json` and named under `## What was not covered`, with the reason the examiner gave. Dropping one silently fails the report: `--report` refuses a union that omits an id no section discloses.

`SAFETY-REPORT.md` carries exactly these sections, in this order:

```markdown
## Résumé exécutif

<deux paragraphes en français : ce qui a été examiné, ce qui a été trouvé, ce que cela implique>

- critical: 0
- high: 0
- medium: 0
- low: 0
- info: 0

## Executive summary

<the same in English>

- critical: 0
- high: 0
- medium: 0
- low: 0
- info: 0

## Scope and method

<the target, its locked file count, which departments ran, which tools ran — the scanner, the advisory source — and which files were actually read>

## Findings

### critical

- `<id>` — <title> (`<file>:<line>`, <cwe>, <confidence>) — <impact, then fix>

### high

...

## What was not covered

- <a department, a file kind, a class of vulnerability, or a check that did not run, and why>
- <every dropped finding id, with the examiner's reason>

## Certificate

Verified findings: <count>
Target tree: <the sha256 from target.json>

<one sentence on what was checked mechanically: that every finding resolves to a real file and line in the locked tree, that every id is unique, and that no two findings share file, line and CWE>

This review does not certify the absence of vulnerabilities; it certifies only that each listed finding was mechanically verified to exist at the cited line, over the files listed in "Scope and method".
```

Both summary sections state a `- <severity>: <count>` line for all five severities, and the five counts must be the counts `findings.json` actually holds. Every finding id in `findings.json` is cited in `## Findings`. Every `<file>:<line>` written anywhere in the report must resolve in the target, so write a path you did not read as prose rather than as a citation.

The report is a review by a language model, grounded by a static scanner and by this examiner. Say so in `## Scope and method`. Never write that the target is secure, safe, or free of vulnerabilities: `verify-safety-report.mjs` refuses those claims, because nothing this program did could support one.

Check it before you commit:

```sh
node verify-safety-report.mjs --report
```
