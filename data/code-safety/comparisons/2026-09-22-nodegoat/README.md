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

## The loop's first iteration

The gap list was acted on the same day. The injection department's transcript showed it had read `research.js`, `profile.js`, and `session.js` and held a server-side request forgery section, yet flagged none of the three; log injection and regular-expression denial of service were absent from every skill. [The injection skill](../../../knowledge/code-safety/injection/SKILL.md) gained an enumeration directive for server-side request call sites and the two missing defect classes, with no NodeGoat file, route, or line named, and the program ran again on the same target, revision, model, and composition ([the record](../../2026-09-22-nodegoat-4-improved/manifest.json)).

| Iteration | Change | Recall on 18 | Targets caught | Gained | Lost | Decision |
| --- | --- | ---: | --- | --- | --- | --- |
| 1 | injection skill: SSRF enumeration, log injection, ReDoS | 13 / 18 | 1 of 3 (`NG-SSRF`) | `NG-SSRF` | `NG-A5` | keep the knowledge; effect not established |

Read it as the ledger reads a one-run pair: the four NodeGoat enterprise runs on record score 14, 14, 13, and 13 of 18, so a one-issue move in either direction is inside the program's own run-to-run variation, and the lost issue (`NG-A5`, security misconfiguration) is in a department the change never touched. The knowledge stays because it is general and costs nothing measurable; whether it caused the SSRF catch is not established by one run, which is why the next step for this loop is the same instrument the bench uses — a frozen pair with the change as the only difference and enough repetitions to read a one-issue effect — rather than another single run. `iterations.json` holds the authored proposal and decision; the reading in the table is scored from the record by the assembler.

## The loop's second iteration: the generalist department, read as a pair

The first iteration widened a skill; this one changes the roster. The six departments each hold a fixed scope (secrets, injection, access, data, dependencies, platform), so a defect that falls between those scopes has no owner. The `with-generalist` overlay adds a seventh department with no scope of its own: it reads the whole tree for anything the specialists leave uncovered, and its findings pass the same examiner. The question is whether that seventh reader catches issues the six miss — the standing gaps are log injection (`NG-A1-3`) and the two broken-authentication issues (`NG-A2-2a`, `NG-A2-2b`), which no enterprise run has ever caught.

Rather than one run each way, the change ran as a pair: the with-generalist arm and the specialists-only arm, twice each, interleaved on the same target, revision, model (`sonnet`), and knowledge pack, so the only difference within a pair is the seventh department.

| Iteration | Arm | Recall on 18 | Targets caught | Gained vs enterprise | Lost vs enterprise |
| --- | --- | ---: | :---: | --- | --- |
| 2 | with generalist | 15 / 18 | 0 of 3 | `NG-SSRF`, `NG-REDOS` | none |
| 3 | specialists only | 14 / 18 | 0 of 3 | `NG-SSRF` | none |
| 4 | with generalist | 13 / 18 | 0 of 3 | `NG-SSRF` | `NG-A5` |
| 5 | specialists only | 15 / 18 | 0 of 3 | `NG-SSRF`, `NG-REDOS` | none |

The generalist adds no recall. The with-generalist arm means 14.0 of 18 (15, 13); the specialists-only arm means 14.5 (14, 15) — the control arm is a hair higher, and both means sit inside the 12-to-15 band the untouched enterprise reads on this target. Neither arm caught any of the three targets: the broken-authentication and log-injection issues are still missed with the seventh department as without it. What does move — `NG-REDOS`, caught in one run of each arm and missed in the other — moves independently of the generalist, which is the run-to-run noise the pair exists to expose. The seventh department is not free: it read the tree and released findings beyond the ground truth in every run without converting one into a caught known issue. On this evidence the generalist is not adopted; the overlay stays available for a target whose defects genuinely fall outside the six scopes, where this small, well-partitioned application does not test it. `iterations.json` holds the four runs' authored side; the recall, the gains and losses, and the targets caught are scored from each record by the assembler.

## The loop's third iteration: the diagnosed checklists, read as a pair

The second iteration changed the roster and read no gain; this one changes what the owning departments are told. [The misses diagnosis](../../../../.agents/notes/proposed/process/2026-09-27-code-safety-misses-diagnosis.md) read the six enterprise records for each miss and found one pattern: the department that owned the file had opened it in every run, and its instruction, persona or skill did not name the class. The change sits in those places and nowhere else — the injection department's instruction and persona own server-side HTTP clients, log sinks and regular-expression tests, and its skill enumerates log calls and regex tests the way it already enumerated request call sites; the access skill, persona and instruction hold account enumeration through authentication responses and the password-policy acceptance rule; the platform persona cites a disabled control's own line when the code carries one. Nothing names a target file, route or line.

The pair ran the way the generalist pair did: the with arm from a checkout of the diagnosis commit (`679eca6bd`), the without arm from a checkout of the commit before it (`745d904b1`), twice each, interleaved on the same target, revision and model (`sonnet`), with every earlier run directory moved out of reach first, so the only difference inside the pair is the diagnosis's changes; the manifests show it, `knowledge.sha256` reading `0ec2cc9b…` in the with arm and `cfea561b…`, the digest records 5 through 8 carry, in the without arm. Each checkout mints its own program id, because the goal objective carries the checkout's own semgrep rules path, so the records compare by target, revision and ground truth, not by id. Two attempts are not records: the without arm run right after the first with arm was recorded and lost with the session's scratch disk before it was copied out, and the second with arm's first attempt ended after 1069 s when the route returned the account's session limit to one department, five departments certified and nothing released; the recorded without arm therefore ran six hours after the first with arm, and both second attempts ran the same evening in the pair's order. No department in any of the four runs read another run's findings or report; other runs' paths appear in their logs in the listings of `find /`, and the one file of another run that any department opened is in the second without run, where the injection department, looking for its own `REPORTING.md`, read the reporting instructions and the target lock of an old dvja run's report repository — files that carry no finding and describe another target.

| Iteration | Arm | Recall on 18 | Targets caught | Gained vs enterprise | Lost vs enterprise |
| --- | --- | ---: | :---: | --- | --- |
| 6 | with the diagnosed checklists | 18 / 18 | 5 of 5 | `NG-A1-3`, `NG-A2-2a`, `NG-A2-2b`, `NG-SSRF`, `NG-REDOS` | none |
| 7 | without | 14 / 18 | 1 of 5 | `NG-SSRF` | none |
| 8 | with the diagnosed checklists | 18 / 18 | 5 of 5 | `NG-A1-3`, `NG-A2-2a`, `NG-A2-2b`, `NG-SSRF`, `NG-REDOS` | none |
| 9 | without | 15 / 18 | 2 of 5 | `NG-SSRF`, `NG-REDOS` | none |

The diagnosed checklists add recall, and they add it where the diagnosis said the gap was. The with arm reads 18 of 18 in both runs; the without arm 14 and 15 — means 18.0 against 14.5, the control inside the 12-to-15 band the untouched enterprise reads on this target and the change three issues above its top. The three issues no enterprise run had caught in six records — the log injection (`NG-A1-3`), the account enumeration (`NG-A2-2a`) and the password policy (`NG-A2-2b`) — are caught in both with runs, by the departments the diagnosis gave them and at the lines the ground truth lists (injection at `app/routes/session.js:64`, access at `:85` and `:144`), and missed in both without runs. `NG-REDOS`, caught in two of the six earlier runs, is caught in both with runs and in one without run, the run-to-run noise it showed before; `NG-SSRF` is caught in all four; `NG-A5` is cited inside the ground truth's windows in all four (`server.js:38`, `:38`, `:10`, `:10`), so the citation placement that lost it in two of the six earlier runs did not recur in either arm. Nothing the without arm caught is lost, and the finding counts do not thin: 70 and 49 in the with arm against 45 and 49 in the without arm, with 13 and 15 findings beyond the ground truth against 14 and 18. The without arm's own report restates the cause the diagnosis found: record 10's `## What was not covered` says the `bankRouting` regular expression "was seen during review but never filed by any department, since each treated it as another department's responsibility", and that log injection "was not examined by any department as its own class". Every line of the diagnosis's acceptance criteria holds — both with runs read at least 16 of 18, the three never-caught issues are caught in both and missed in both controls, nothing is lost — except its wording of the program ids, which each checkout mints for itself; the decision is `keep`. What the pair does not establish: the two authentication entries describe exactly the classes of this target's tutorial items, so whether they generalize is a question for a second target with its own ground truth or for [seeded-defect recall](../../README.md#recall-without-a-ground-truth-seeded-defects) on one without, and two runs per arm read a three-issue gap, not a one-issue one. `iterations.json` holds the four runs' authored side; the recall, the gains and losses, and the targets caught are scored from each record by the assembler.

## Files

`comparison.json` is the machine record: the three tiers, the issue-by-issue matrix, the gaps, and the loop's iterations. `iterations.json` is the authored side of each iteration: its record, the change, the targeted issues, and the decision. `t0-semgrep-findings.json` and `t1-single-model-findings.json` are the two live tiers' findings, normalized to the findings schema; `t0-semgrep-raw.json` and `t1-single-model-meta.json` keep each producer's own output. `enterprise-trajectory.json` is the enterprise record's provenance and per-finding trail. Regenerate the scorecard with:

```sh
node data/code-safety/tools/compare.mjs <findings.json> data/code-safety/targets/nodegoat.ground-truth.json
node data/code-safety/tools/assemble-comparison.mjs data/code-safety/targets/nodegoat.ground-truth.json data/code-safety/comparisons/2026-09-22-nodegoat
```
