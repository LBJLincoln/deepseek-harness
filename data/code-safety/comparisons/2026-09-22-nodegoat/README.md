# NodeGoat: the enterprise against its alternatives

English | [中文](README.zh.md)

A number means nothing without a floor and a ceiling beside it. This record scores three ways to review the same application against the same yardstick, so a reader can judge what the harness is worth rather than take our word for it.

Everything here is on **OWASP NodeGoat at revision `c5cb68a`**, the same revision and the same 18-issue ground truth the enterprise record `2026-09-21-nodegoat-3` was scored against. A finding counts as catching a known issue when it lands within three lines of that issue, the rule `compare.mjs` and `recall.mjs` share. The issue count and the issue locations were never shown to any tier. The single-model tier and the enterprise tier run the **same model** (sonnet); the only thing that differs between them is the harness.

## The three tiers

| Tier | What it is | Recall on 18 | Findings | Every finding verified at its line | Wall time | Cost |
| --- | --- | ---: | ---: | :---: | ---: | ---: |
| Semgrep | commodity static analysis, 96 community rules, no model | 4 / 18 (22%) | 16 | no | seconds | $0 |
| One frontier model, one pass | a single sonnet session, no departments, no verifier | 15 / 18 (83%) | 23 | no | 113 s | $0.36 |
| Daliesk enterprise | six departments, a verifier, and integration; same sonnet | 13 / 18 (72%) | 47 | yes, examiner exit 0 | 1356 s | subscription |

## How to read this honestly

**The scanner is the floor.** Semgrep catches about a quarter of the known issues and confirms none of them; a person still has to open every hit. It is fast and free and it is not a review.

**A single frontier model is strong on a small application.** On NodeGoat's 44 files one sonnet pass caught 15 of 18, two more than the enterprise. We report that plainly. But its 23 findings are unverified, so a security team must re-check all 23 by hand; the run is non-deterministic, so a second pass returns a different set; and it leaves no transcript, no per-domain depth, and no certificate. It is a fast opinion, not an auditable result.

**The enterprise trades two issues of raw recall on this small app for things a single pass cannot give.** Every one of its 47 findings is mechanically verified to exist at its cited line. It surfaces 47 real findings against the single pass's 23, more than double the attack surface examined. It leaves a full transcript — 7 agent sessions, 190 steps, 294 tool calls, 7 certificates — that a reviewer can audit. And it produces the certificate the other two tiers cannot.

**Where the enterprise pulls ahead is scale.** On 44 files a single model holds the whole application in context at once. The application this proof of concept is aimed at has thousands of files; there a single pass cannot hold the code, and domain departments running in parallel with a verifier are the only way to stay both thorough and trustworthy. This record is the small-app case, where the single model is at its strongest and the gap is at its narrowest.

## What the comparison hands the improvement loop

The comparison is not only a scorecard; it is an input to the loop that improves the harness. Scored issue by issue, it names exactly where each approach is blind:

- **Both the single model and the enterprise miss the same two** broken-authentication issues (`NG-A2-2a`, `NG-A2-2b`). A shared hard case, now a named target.
- **The single pass caught three the departments missed**: server-side request forgery (`NG-SSRF`, `app/routes/research.js`), regular-expression denial of service (`NG-REDOS`, `app/routes/profile.js`), and log injection (`NG-A1-3`). These name department scopes to widen.
- **The enterprise caught one the single pass missed**: sensitive data at rest (`NG-A6-1`), a win for a department's domain depth.

That gap list is the backlog the departments' skills should close, and the reason to run the comparison on every target rather than once.

## Files

`comparison.json` is the machine record: the three tiers, the issue-by-issue matrix, and the gaps. `t0-semgrep-findings.json` and `t1-single-model-findings.json` are the two live tiers' findings, normalized to the findings schema; `t0-semgrep-raw.json` and `t1-single-model-meta.json` keep each producer's own output. `enterprise-trajectory.json` is the enterprise record's provenance and per-finding trail. Regenerate the scorecard with:

```sh
node data/code-safety/tools/compare.mjs <findings.json> data/code-safety/targets/nodegoat.ground-truth.json
node data/code-safety/tools/assemble-comparison.mjs data/code-safety/targets/nodegoat.ground-truth.json data/code-safety/comparisons/2026-09-22-nodegoat
```
